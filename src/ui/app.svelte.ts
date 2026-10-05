import type {
  BodyweightEntry,
  Exercise,
  Id,
  IsoDate,
  ManualRecord,
  OneRmEntry,
  Session,
  Template,
} from '../model';
import { submissionUrl } from '../library/submission';
import { recordBook } from '../metrics/records';
import { startStorage, type AppStorage } from '../storage/app';
import type { RecordOf } from '../storage/formats';
import type { TableKind } from '../storage/paths';
import { DEFAULT_PREFS, readPrefs, type Prefs } from './prefs';
import type { SetupInput, SetupResult } from '../storage/setup';
import type { StatusSnapshot } from '../storage/status';
import { confirmDialog, promptDialog, showToast } from './overlays.svelte';
import { liveSession } from './status';
import { HOME, parseRoute, routeHash, sameRoute, type Route } from './route';
import {
  addExercise,
  start as begin,
  finish,
  fromTemplate,
  localDate,
  newSession,
  setDate,
  templateFrom,
} from './session';
import { addTemplateExercise, newTemplate } from './template';

/**
 * The app's state and what can be done to it, for every screen to import:
 * the storage, the data it holds, where the lifter is (the route) and the
 * actions that change any of it. Screens read `app.*` and call its methods;
 * the shell (App.svelte) only boots it and switches screens on `app.route`.
 *
 * Every write shows its result at once and resolves only once the write
 * has; a failed write leaves `failure` saying so. An action that confirms
 * something to the lifter (a toast) does it after the write resolved.
 */

/** Set once the lifter chose to go without sync, so setup stops greeting them. */
const SKIPPED = 'sisyphos.setup-skipped';

/** The history entry's position in the app's own back stack. */
interface NavState {
  sisyphos: number;
}

class App {
  storage = $state.raw<AppStorage | null>(null);
  status = $state.raw<StatusSnapshot | null>(null);
  /** What last went wrong, in words, until the next write succeeds. */
  failure = $state<string | null>(null);
  /** The first-launch greeting: set up sync, or go without. */
  showSetup = $state(false);
  /** The full-screen conflict notice (at launch, and when a sync brings one). */
  conflictNotice = $state(false);
  /** Every session, newest last, as last loaded or saved. */
  sessions = $state.raw<Session[]>([]);
  templates = $state.raw<Template[]>([]);
  library = $state.raw<Exercise[]>([]);
  /** The session on screen (`session/<id>` or its finish), as it is now. */
  session = $state.raw<Session | null>(null);
  /** The template on screen (`template/<id>`). */
  template = $state.raw<Template | null>(null);
  /** A new exercise being created, named from what was typed; shown over the screen. */
  creating = $state<string | null>(null);
  route = $state.raw<Route>(HOME);

  /** Every session, with the one on screen as it is now rather than as last loaded. */
  current = $derived.by(() => {
    const open = this.session;
    return open ? [...this.sessions.filter((s) => s.id !== open.id), open] : this.sessions;
  });

  /** The session started and not finished, wherever the lifter is in the app. */
  running = $derived(
    this.current.findLast((s) => s.started_at !== null && s.ended_at === null) ?? null,
  );

  /** The clock the live rule ages by; moves with the minute timer and with every write. */
  now = $state.raw(new Date());
  #wroteAt = new Map<Id, number>();

  /**
   * A session is being lifted: what holds the notices back. Narrower than
   * `running`, which Train keeps showing so a forgotten session can be finished.
   */
  inSession = $derived(liveSession(this.current, this.now, this.#wroteAt));

  /** Where in the app's own history the lifter is, so back never leaves the app. */
  #index = 0;

  // --- start and stop -----------------------------------------------------------------

  /** Opens storage, loads the data and follows the hash. Returns the teardown. */
  boot = (): (() => void) => {
    let disposed = false;
    let started: AppStorage | null = null;
    // Exposure ages with the clock, not only with writes.
    const timer = setInterval(() => {
      this.now = new Date();
      void started?.scheduler.status();
    }, 60_000);

    const state = history.state as Partial<NavState> | null;
    if (typeof state?.sisyphos === 'number') this.#index = state.sisyphos;
    else history.replaceState({ sisyphos: 0 } satisfies NavState, '');
    const launchedAt = parseRoute(location.hash);
    this.route = launchedAt;
    window.addEventListener('popstate', this.#follow);
    window.addEventListener('hashchange', this.#follow);

    startStorage({
      target: window,
      onStatus: (next) => {
        this.status = next;
        // A finished sync may have brought sessions from another device.
        if (started) void this.load();
      },
      onConflicts: () => this.#announceConflicts(),
      onLibraryConflicts: () => this.#announceConflicts(),
    }).then(
      async (s) => {
        if (disposed) return s.dispose();
        started = s;
        this.storage = s;
        await this.load();
        // A session left running reopens; a planned one waits on Train.
        const open = await s.log.listOpenSessions();
        const running = open.filter((o) => o.started_at !== null).at(-1);
        if (running && launchedAt.name === 'train') {
          this.session = running;
          this.replace({ name: 'session', id: running.id });
        } else {
          this.#resolve();
        }
        const settings = await s.store.settings();
        this.showSetup = settings.owner === null && !skipped();
        await s.scheduler.status();
        // Conflicts are announced again at every launch until settled.
        const waiting = (this.status?.conflicts ?? 0) + (this.status?.libraryConflicts ?? 0);
        if (waiting > 0) this.#announceConflicts();
      },
      (error: unknown) =>
        (this.failure = `This phone's storage could not be opened: ${messageOf(error)}`),
    );

    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener('popstate', this.#follow);
      window.removeEventListener('hashchange', this.#follow);
      started?.dispose();
    };
  };

  /**
   * Records shown before their write resolved. A read can start before a queued
   * write lands, so `load` keeps these over what storage returns: otherwise the
   * lists, and the next edit made from them, would go back a step.
   */
  #unsavedSessions = new Map<Id, Session>();
  #unsavedTemplates = new Map<Id, Template>();

  /**
   * Rereads sessions, templates and the library from storage. Runs after every
   * sync, so the session or template on screen is replaced by what the sync
   * brought, unless the lifter's own write of it is still on its way.
   */
  load = async (): Promise<void> => {
    const s = this.storage;
    if (!s) return;
    const [all, saved, assembled] = await Promise.all([
      s.log.listSessions('0000-01-01', '9999-12-31'),
      s.log.getTemplates(),
      s.log.library(),
    ]);
    this.sessions = overlay(all, this.#unsavedSessions);
    this.templates = overlay(saved, this.#unsavedTemplates);
    this.library = assembled.exercises;
    const open = this.session;
    if (open && !this.#unsavedSessions.has(open.id)) {
      const stored = this.sessions.find((x) => x.id === open.id);
      if (stored && stored.updated_at !== open.updated_at) this.session = stored;
    }
    const template = this.template;
    if (template && !this.#unsavedTemplates.has(template.id)) {
      const stored = this.templates.find((x) => x.id === template.id);
      if (stored && stored.updated_at !== template.updated_at) this.template = stored;
    }
    await this.#loadLifter(s);
  };

  // --- where the lifter is ------------------------------------------------------------

  /** Opens a screen, as a new step back can return from. */
  go = (route: Route): void => {
    if (sameRoute(route, this.route)) return;
    this.#index += 1;
    history.pushState({ sisyphos: this.#index } satisfies NavState, '', routeHash(route));
    this.#show(route);
  };

  /** Opens a screen in place of this one, as after finishing or deleting. */
  replace = (route: Route): void => {
    history.replaceState({ sisyphos: this.#index } satisfies NavState, '', routeHash(route));
    this.#show(route);
  };

  /** Back to the screen before, or to `fallback` when this one was opened first. */
  back = (fallback: Route = HOME): void => {
    if (this.#index > 0) history.back();
    else this.replace(fallback);
  };

  /** Follows a change of hash: back, forward, a tab, or a link. */
  #follow = (): void => {
    const state = history.state as Partial<NavState> | null;
    if (typeof state?.sisyphos === 'number') {
      this.#index = state.sisyphos;
    } else {
      // A link (a tab) made this entry; number it so back can tell it is ours.
      this.#index += 1;
      history.replaceState({ sisyphos: this.#index } satisfies NavState, '');
    }
    const route = parseRoute(location.hash);
    if (!sameRoute(route, this.route)) this.#show(route);
  };

  #show(route: Route): void {
    const leaving = this.route;
    this.route = route;
    const onSession = route.name === 'session' || route.name === 'finish';
    const wasOnSession = leaving.name === 'session' || leaving.name === 'finish';
    if (wasOnSession && !onSession && this.session) {
      // Back to the lists: what was on screen joins them as saved.
      this.session = null;
      void this.load();
    }
    if (route.name !== 'template') this.template = null;
    this.#resolve();
  }

  /** Finds what the route names; a route naming nothing that exists goes home. */
  #resolve(): void {
    const route = this.route;
    if (!this.storage) return;
    if (route.name === 'session' || route.name === 'finish') {
      if (this.session?.id !== route.id) {
        this.session = this.current.find((s) => s.id === route.id) ?? null;
      }
      if (!this.session) this.replace(HOME);
    } else if (route.name === 'template') {
      if (this.template?.id !== route.id) {
        this.template = this.templates.find((t) => t.id === route.id) ?? null;
      }
      if (!this.template) this.replace(HOME);
    }
  }

  // --- sessions -----------------------------------------------------------------------

  /** Shows the change at once and writes it; the write is what makes it saved. */
  save = async (next: Session): Promise<boolean> => {
    if (this.session?.id === next.id) this.session = next;
    this.sessions = upsert(this.sessions, next);
    this.#wroteAt.set(next.id, Date.now());
    this.now = new Date();
    if (!this.storage) return false;
    this.#unsavedSessions.set(next.id, next);
    try {
      await this.storage.log.putSession(next);
      this.failure = null;
      return true;
    } catch (error) {
      this.failure = `Not saved: ${messageOf(error)}`;
      return false;
    } finally {
      // A later edit of the same session may be on its way; only this one has landed.
      if (this.#unsavedSessions.get(next.id) === next) this.#unsavedSessions.delete(next.id);
    }
  };

  /**
   * A new session, opened: started now, or `planned` to fill in ahead; on
   * `date` for one logged after the fact; with a template's targets, or a past
   * session's sets as targets for doing it again.
   */
  create = (
    from: Template | Session | null,
    options: { planned?: boolean; date?: IsoDate } = {},
  ): Promise<void> => {
    // A second tap while the first is still writing would make a second session.
    this.#creating ??= this.#create(from, options).finally(() => (this.#creating = null));
    return this.#creating;
  };

  #creating: Promise<void> | null = null;

  async #create(
    from: Template | Session | null,
    options: { planned?: boolean; date?: IsoDate },
  ): Promise<void> {
    const s = this.storage;
    if (!s) return;
    const at = new Date();
    let fresh = newSession({
      id: await s.log.newSessionId(options.date ?? localDate(at)),
      at,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      deviceId: s.log.options.deviceId,
      planned: options.planned,
    });
    if (options.date) fresh = setDate(fresh, options.date);
    const plan = from && 'started_at' in from ? templateFrom(from, { id: '', name: '', at }) : from;
    if (plan) fresh = fromTemplate(fresh, plan, () => crypto.randomUUID());
    this.session = fresh;
    await this.save(fresh);
    this.go({ name: 'session', id: fresh.id });
  }

  openSession = (session: Session): void => {
    this.session = session;
    this.go({ name: 'session', id: session.id });
  };

  /** Starts a planned session (the one on screen by default), and opens it. */
  startPlanned = async (session: Session | null = this.session): Promise<void> => {
    if (!session) return;
    this.session = session;
    await this.save(begin(session, new Date()));
    this.go({ name: 'session', id: session.id });
  };

  /** Ends the session on screen and shows its finish; the sync it triggers runs on behind. */
  finishSession = async (): Promise<void> => {
    const s = this.storage;
    const session = this.session;
    if (!s || !session) return;
    await this.save(finish(session, new Date()));
    // Not awaited: the banner follows the sync.
    void s.scheduler.trigger('session_ended');
    this.replace({ name: 'finish', id: session.id });
  };

  /** Leaves the finish screen for Train. */
  closeFinish = (): void => {
    this.replace(HOME);
  };

  /** Deletes the session on screen, or discards a plan, once the lifter confirms. */
  removeSession = async (): Promise<void> => {
    const s = this.storage;
    const session = this.session;
    if (!s || !session) return;
    const planned = session.started_at === null;
    const sets = session.exercises.reduce(
      (n, e) => n + e.performed.filter((p) => p.state === 'done').length,
      0,
    );
    const ok = await confirmDialog(
      planned
        ? {
            title: 'Discard this plan?',
            body: 'It is deleted from this device and, at the next sync, from the log.',
            confirmLabel: 'Discard plan',
            cancelLabel: 'Keep it',
            danger: true,
          }
        : {
            title: 'Delete this session?',
            body:
              sets === 0
                ? 'It is deleted from this device and, at the next sync, from the log.'
                : `Its ${sets} ${sets === 1 ? 'set is' : 'sets are'} deleted from this device and, at the next sync, from the log.`,
            confirmLabel: 'Delete session',
            cancelLabel: 'Keep it',
            danger: true,
          },
    );
    if (!ok) return;
    await s.log.deleteSession(session.id);
    this.sessions = this.sessions.filter((x) => x.id !== session.id);
    this.session = null;
    this.back(HOME);
  };

  /** Saves the session on screen as a template named `name`. */
  saveAsTemplate = async (name: string): Promise<void> => {
    const s = this.storage;
    const session = this.session;
    if (!s || !session) return;
    const template = templateFrom(session, {
      id: await s.log.newTemplateId(name),
      name,
      at: new Date(),
    });
    await s.log.putTemplate(template);
    this.templates = await s.log.getTemplates();
    showToast({ message: `Saved as the template ${name}` });
  };

  // --- templates ----------------------------------------------------------------------

  /** Asks for a name, then opens a new, empty template. */
  createTemplate = async (): Promise<void> => {
    const s = this.storage;
    if (!s) return;
    const name = await promptDialog({
      title: 'Name the template',
      label: 'Name',
      placeholder: 'Squat and bench',
      confirmLabel: 'Create template',
    });
    if (!name) return;
    const fresh = newTemplate({ id: await s.log.newTemplateId(name), name, at: new Date() });
    await this.saveTemplate(fresh);
    this.go({ name: 'template', id: fresh.id });
  };

  openTemplate = (template: Template): void => {
    this.template = template;
    this.go({ name: 'template', id: template.id });
  };

  /** Shows the change at once and writes it, like `save` for sessions. */
  saveTemplate = async (next: Template): Promise<boolean> => {
    this.template = next;
    this.templates = upsert(this.templates, next);
    if (!this.storage) return false;
    this.#unsavedTemplates.set(next.id, next);
    try {
      await this.storage.log.putTemplate(next);
      if (this.#unsavedTemplates.get(next.id) === next) this.#unsavedTemplates.delete(next.id);
      this.templates = overlay(await this.storage.log.getTemplates(), this.#unsavedTemplates);
      this.failure = null;
      return true;
    } catch (error) {
      this.failure = `Not saved: ${messageOf(error)}`;
      return false;
    } finally {
      if (this.#unsavedTemplates.get(next.id) === next) this.#unsavedTemplates.delete(next.id);
    }
  };

  /** Deletes the template on screen once the lifter confirms. */
  deleteTemplate = async (): Promise<void> => {
    const s = this.storage;
    const template = this.template;
    if (!s || !template) return;
    const ok = await confirmDialog({
      title: `Delete the template ${template.name}?`,
      body: 'Sessions started from it keep their sets.',
      confirmLabel: 'Delete template',
      cancelLabel: 'Keep it',
      danger: true,
    });
    if (!ok) return;
    await s.log.deleteTemplate(template.id);
    this.template = null;
    this.templates = await s.log.getTemplates();
    this.back({ name: 'more', page: 'templates' });
  };

  // --- the library --------------------------------------------------------------------

  /** Opens the form for a new exercise, named from what was typed. */
  startCreating = (name: string): void => {
    this.creating = name;
  };

  /**
   * Saves a new exercise, adds it to the session or template on screen, and
   * opens its proposal to the shared library.
   */
  createExercise = async (exercise: Exercise): Promise<void> => {
    const s = this.storage;
    if (!s) return;
    // Opened within the tap, as Safari requires, and pointed at the proposal after.
    const tab = window.open('', '_blank');
    const kind = await s.log.saveExercise(exercise);
    if (tab && kind) tab.location.href = submissionUrl(exercise, kind);
    else tab?.close();
    this.creating = null;
    await this.load();
    const route = this.route;
    if (route.name === 'session' && this.session) {
      await this.save(addExercise(this.session, exercise, () => crypto.randomUUID()));
    } else if (route.name === 'template' && this.template) {
      await this.saveTemplate(addTemplateExercise(this.template, exercise));
    }
  };

  openExercise = (exercise: Exercise | Id): void => {
    this.go({ name: 'exercise', id: typeof exercise === 'string' ? exercise : exercise.id });
  };

  // --- sync ---------------------------------------------------------------------------

  connect = async (input: SetupInput): Promise<SetupResult> => {
    if (!this.storage) throw new Error('storage is not open');
    const result = await this.storage.connect(input);
    if (result.ok) this.showSetup = false;
    return result;
  };

  skipSetup = (): void => {
    try {
      localStorage.setItem(SKIPPED, 'yes');
    } catch {
      // Without storage the form simply greets them again next launch.
    }
    this.showSetup = false;
  };

  /**
   * Always asked for: the shell's own gate (conflicts.ts, noticeShown) holds the
   * notice back during a session and on the finish screen, so one announced
   * meanwhile still comes after.
   */
  #announceConflicts(): void {
    this.conflictNotice = true;
  }

  // --- the lifter and this device -----------------------------------------------------

  /** Weigh-ins, reference maxes and records entered by hand: the log's lifter tables. */
  bodyweights = $state.raw<BodyweightEntry[]>([]);
  oneRms = $state.raw<OneRmEntry[]>([]);
  manualRecords = $state.raw<ManualRecord[]>([]);
  /** This device's preferences; they stay on the device and never sync. */
  prefs = $state.raw<Prefs>(DEFAULT_PREFS);

  /**
   * The best weight at each rep count per exercise, from sessions and by hand
   * together, as it stands with the session on screen. Derived, never saved.
   */
  records = $derived(recordBook(this.current, this.library, this.manualRecords));

  async #loadLifter(s: AppStorage): Promise<void> {
    const [bodyweights, oneRms, manualRecords, settings] = await Promise.all([
      s.log.getRows('bodyweight'),
      s.log.getRows('oneRm'),
      s.log.getRows('manualRecords'),
      s.store.settings(),
    ]);
    this.bodyweights = bodyweights;
    this.oneRms = oneRms;
    this.manualRecords = manualRecords;
    this.prefs = readPrefs(settings);
  }

  /** Adds or replaces a lifter row (same key), then rereads the tables. */
  saveRow = async <K extends Exclude<TableKind, 'additions'>>(
    kind: K,
    record: RecordOf<K>,
  ): Promise<boolean> => {
    const s = this.storage;
    if (!s) return false;
    try {
      await s.log.putRow(kind, record);
      this.failure = null;
    } catch (error) {
      this.failure = `Not saved: ${messageOf(error)}`;
      return false;
    }
    await this.#loadLifter(s);
    return true;
  };

  removeRow = async <K extends Exclude<TableKind, 'additions'>>(
    kind: K,
    record: RecordOf<K>,
  ): Promise<boolean> => {
    const s = this.storage;
    if (!s) return false;
    try {
      await s.log.deleteRow(kind, record);
      this.failure = null;
    } catch (error) {
      this.failure = `Not deleted: ${messageOf(error)}`;
      return false;
    }
    await this.#loadLifter(s);
    return true;
  };

  /** Changes this device's preferences; shown at once, kept once the write resolves. */
  setPrefs = async (patch: Partial<Prefs>): Promise<void> => {
    this.prefs = readPrefs({ ...this.prefs, ...patch });
    try {
      await this.storage?.store.saveSettings(patch);
    } catch (error) {
      this.failure = `This phone's settings were not saved: ${messageOf(error)}`;
    }
  };

  // --- agora ----------------------------------------------------------------------------

  /** An exercise of the library being changed, shown over the screen in the new-exercise form. */
  editing = $state.raw<Exercise | null>(null);

  /**
   * Saves a changed exercise (its id stays) and opens its proposal to the shared
   * library, as `createExercise` does for a new one, but touches no session or
   * template: the lifter is in the library, not building a session.
   */
  changeExercise = async (exercise: Exercise): Promise<void> => {
    const s = this.storage;
    if (!s) return;
    // Opened within the tap, as Safari requires, and pointed at the proposal after.
    const tab = window.open('', '_blank');
    try {
      const kind = await s.log.saveExercise(exercise);
      if (tab && kind) tab.location.href = submissionUrl(exercise, kind);
      else tab?.close();
      this.failure = null;
    } catch (error) {
      tab?.close();
      this.failure = `Not saved: ${messageOf(error)}`;
      return;
    }
    this.editing = null;
    await this.load();
    showToast({ message: 'Saved on this phone', strong: exercise.name });
  };
}

export const app = new App();

function skipped(): boolean {
  try {
    return localStorage.getItem(SKIPPED) === 'yes';
  } catch {
    return false;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What storage returned, with each record still being written shown as it will be. */
function overlay<T extends { id: Id }>(stored: T[], unsaved: ReadonlyMap<Id, T>): T[] {
  let out = stored;
  for (const item of unsaved.values()) out = upsert(out, item);
  return out;
}

/** The list with `item` in place of the one with its id, or added at the end. */
function upsert<T extends { id: Id }>(list: T[], item: T): T[] {
  const at = list.findIndex((x) => x.id === item.id);
  if (at === -1) return [...list, item];
  const next = [...list];
  next[at] = item;
  return next;
}
