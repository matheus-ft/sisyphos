<script lang="ts">
  import { onMount } from 'svelte';
  import type { Exercise, IsoDate, Session, Template } from './model';
  import { startStorage, type AppStorage } from './storage/app';
  import type { SetupInput, SetupResult } from './storage/setup';
  import type { StatusSnapshot } from './storage/status';
  import { submissionUrl } from './library/submission';
  import ExerciseHistory from './ui/ExerciseHistory.svelte';
  import Home from './ui/Home.svelte';
  import NewExercise from './ui/NewExercise.svelte';
  import SessionView from './ui/SessionView.svelte';
  import Setup from './ui/Setup.svelte';
  import SyncView from './ui/SyncView.svelte';
  import TemplateView from './ui/TemplateView.svelte';
  import {
    addExercise,
    start as begin,
    finish,
    fromTemplate,
    localDate,
    newSession,
    setDate,
    templateFrom,
  } from './ui/session';
  import { addTemplateExercise, newTemplate } from './ui/template';
  import { statusLine } from './ui/status';

  /** Set once the lifter chose to go without sync, so setup stops greeting them. */
  const SKIPPED = 'sisyphos.setup-skipped';

  let storage = $state<AppStorage | null>(null);
  let status = $state<StatusSnapshot | null>(null);
  let failure = $state<string | null>(null);
  let showSetup = $state(false);
  /** The session on screen: the one in progress, or a past one being read or edited. */
  let session = $state<Session | null>(null);
  /** The template being edited, when no session is on screen. */
  let template = $state<Template | null>(null);
  let sessions = $state<Session[]>([]);
  let templates = $state<Template[]>([]);
  let library = $state<Exercise[]>([]);
  /** Screens over the others: an exercise's history, sync, a new exercise's form. */
  let history = $state<Exercise | null>(null);
  let showSync = $state(false);
  let creating = $state<string | null>(null);

  /** Every session, with the one on screen as it is now rather than as last loaded. */
  const current = $derived(
    session ? [...sessions.filter((s) => s.id !== session?.id), session] : sessions,
  );

  const inSession = $derived(
    session !== null && session.started_at !== null && session.ended_at === null,
  );
  const line = $derived(status ? statusLine(status, inSession) : null);

  onMount(() => {
    let disposed = false;
    let started: AppStorage | null = null;
    // Exposure ages with the clock, not only with writes.
    const timer = setInterval(() => void started?.scheduler.status(), 60_000);

    startStorage({
      target: window,
      onStatus: (next) => {
        status = next;
        // A finished sync may have brought sessions from another device.
        if (started) void load(started);
      },
    }).then(
      async (s) => {
        if (disposed) return s.dispose();
        started = s;
        storage = s;
        await load(s);
        // A session left running reopens; a planned one waits on the home screen.
        const open = await s.log.listOpenSessions();
        session = open.filter((o) => o.started_at !== null).at(-1) ?? null;
        const settings = await s.store.settings();
        showSetup = settings.owner === null && !skipped();
        await s.scheduler.status();
      },
      (error: unknown) =>
        (failure = `This phone's storage could not be opened: ${messageOf(error)}`),
    );

    return () => {
      disposed = true;
      clearInterval(timer);
      started?.dispose();
    };
  });

  async function load(s: AppStorage): Promise<void> {
    const [all, saved, assembled] = await Promise.all([
      s.log.listSessions('0000-01-01', '9999-12-31'),
      s.log.getTemplates(),
      s.log.library(),
    ]);
    sessions = all;
    templates = saved;
    library = assembled.exercises;
  }

  function skipped(): boolean {
    try {
      return localStorage.getItem(SKIPPED) === 'yes';
    } catch {
      return false;
    }
  }

  function skipSetup(): void {
    try {
      localStorage.setItem(SKIPPED, 'yes');
    } catch {
      // Without storage the form simply greets them again next launch.
    }
    showSetup = false;
  }

  function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /** Shows the change at once and writes it; the write is what makes it saved. */
  async function save(next: Session): Promise<void> {
    session = next;
    if (!storage) return;
    try {
      await storage.log.putSession(next);
      failure = null;
    } catch (error) {
      failure = `Not saved: ${messageOf(error)}`;
    }
  }

  /**
   * A new session: started now, or `planned` to fill in ahead; on `date` for one
   * logged after the fact; with a template's targets, or a past session's sets
   * as targets for doing it again.
   */
  async function create(
    from: Template | Session | null,
    options: { planned?: boolean; date?: IsoDate } = {},
  ): Promise<void> {
    const s = storage;
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
    template = null;
    await save(fresh);
  }

  async function startPlanned(): Promise<void> {
    if (session) await save(begin(session, new Date()));
  }

  /** Saves a new exercise, adds it where it was asked for, and opens its proposal. */
  async function createExercise(exercise: Exercise): Promise<void> {
    const s = storage;
    if (!s) return;
    // Opened within the tap, as Safari requires, and pointed at the proposal after.
    const tab = window.open('', '_blank');
    const kind = await s.log.saveExercise(exercise);
    if (tab && kind) tab.location.href = submissionUrl(exercise, kind);
    else tab?.close();
    creating = null;
    await load(s);
    if (session) await save(addExercise(session, exercise, () => crypto.randomUUID()));
    else if (template) await saveTemplate(addTemplateExercise(template, exercise));
  }

  async function finishSession(): Promise<void> {
    const s = storage;
    if (!s || !session) return;
    await save(finish(session, new Date()));
    // Not awaited: the status line follows the sync.
    void s.scheduler.trigger('session_ended');
    await close();
  }

  async function close(): Promise<void> {
    session = null;
    if (storage) await load(storage);
  }

  async function remove(): Promise<void> {
    const s = storage;
    const question =
      session?.started_at === null
        ? 'Discard this plan?'
        : 'Delete this session? It is deleted from the log too.';
    if (!s || !session || !confirm(question)) return;
    await s.log.deleteSession(session.id);
    await close();
  }

  async function saveAsTemplate(name: string): Promise<void> {
    const s = storage;
    if (!s || !session) return;
    const template = templateFrom(session, {
      id: await s.log.newTemplateId(name),
      name,
      at: new Date(),
    });
    await s.log.putTemplate(template);
    templates = await s.log.getTemplates();
  }

  async function createTemplate(): Promise<void> {
    const s = storage;
    const name = prompt('Name the template', '')?.trim();
    if (!s || !name) return;
    await saveTemplate(newTemplate({ id: await s.log.newTemplateId(name), name, at: new Date() }));
  }

  /** Shows the change at once and writes it, like `save` for sessions. */
  async function saveTemplate(next: Template): Promise<void> {
    template = next;
    if (!storage) return;
    try {
      await storage.log.putTemplate(next);
      templates = await storage.log.getTemplates();
      failure = null;
    } catch (error) {
      failure = `Not saved: ${messageOf(error)}`;
    }
  }

  async function deleteTemplate(): Promise<void> {
    const s = storage;
    if (!s || !template || !confirm(`Delete the template ${template.name}?`)) return;
    await s.log.deleteTemplate(template.id);
    template = null;
    templates = await s.log.getTemplates();
  }

  async function connect(input: SetupInput): Promise<SetupResult> {
    if (!storage) throw new Error('storage is not open');
    const result = await storage.connect(input);
    if (result.ok) showSetup = false;
    return result;
  }

  /** The status line leads to setup until there is a repo, and to the sync screen after. */
  function onStatusTap(): void {
    if (!status) return;
    if (status.status === 'not_set_up') showSetup = true;
    else showSync = true;
  }
</script>

<main>
  {#if line}
    <button class="status" class:alarm={line.alarm} onclick={onStatusTap}>{line.text}</button>
  {/if}
  {#if failure}
    <p class="failure" role="alert">{failure}</p>
  {/if}

  {#if !storage}
    {#if !failure}<p class="opening">Opening…</p>{/if}
  {:else if showSetup}
    <Setup onconnect={connect} onskip={skipSetup} onclose={() => (showSetup = false)} />
  {:else if creating !== null}
    <NewExercise
      name={creating}
      {library}
      onsave={createExercise}
      onclose={() => (creating = null)}
    />
  {:else if history}
    <ExerciseHistory exercise={history} sessions={current} onclose={() => (history = null)} />
  {:else if showSync}
    <SyncView
      {storage}
      {status}
      {library}
      onsetup={() => {
        showSync = false;
        showSetup = true;
      }}
      onclose={() => (showSync = false)}
    />
  {:else if session}
    <SessionView
      {session}
      {library}
      {sessions}
      onchange={save}
      onfinish={finishSession}
      onclose={close}
      ondelete={remove}
      onsavetemplate={saveAsTemplate}
      onstart={startPlanned}
      ondoagain={() => session && create(session, { planned: true })}
      onhistory={(e: Exercise) => (history = e)}
      oncreate={(name: string) => (creating = name)}
    />
  {:else if template}
    <TemplateView
      {template}
      {library}
      onchange={saveTemplate}
      onstart={() => template && create(template)}
      onclose={() => (template = null)}
      ondelete={deleteTemplate}
      oncreate={(name: string) => (creating = name)}
    />
  {:else}
    <Home
      {sessions}
      {templates}
      {library}
      onstart={(t: Template | null, date?: IsoDate) => create(t, { date })}
      onplan={(t: Template | null) => create(t, { planned: true })}
      onopen={(s: Session) => (session = s)}
      onopentemplate={(t: Template) => (template = t)}
      onnewtemplate={createTemplate}
    />
  {/if}
</main>

<style>
  main {
    max-width: 40rem;
    margin: 0 auto;
    padding: 0 1rem 4rem;
    font-family: var(--sans);
  }

  .status {
    display: block;
    width: 100%;
    margin: 0 0 1rem;
    padding: 0.6rem 0;
    border: 0;
    border-bottom: 1px solid var(--line);
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 0.85rem;
    text-align: left;
  }

  .status.alarm {
    color: var(--accent);
  }

  .failure {
    color: var(--accent);
  }

  .opening {
    color: var(--muted);
  }
</style>
