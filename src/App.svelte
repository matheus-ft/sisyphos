<script lang="ts">
  import { onMount } from 'svelte';
  import type { Exercise, IsoDate, Session, Template } from './model';
  import { startStorage, type AppStorage } from './storage/app';
  import type { SetupInput, SetupResult } from './storage/setup';
  import type { StatusSnapshot } from './storage/status';
  import Home from './ui/Home.svelte';
  import SessionView from './ui/SessionView.svelte';
  import Setup from './ui/Setup.svelte';
  import TemplateView from './ui/TemplateView.svelte';
  import { finish, fromTemplate, localDate, newSession, setDate, templateFrom } from './ui/session';
  import { newTemplate } from './ui/template';
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

  const inSession = $derived(session !== null && session.ended_at === null);
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
        const open = await s.log.listOpenSessions();
        session = open.at(-1) ?? null;
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

  async function start(from: Template | null, date?: IsoDate): Promise<void> {
    const s = storage;
    if (!s) return;
    const at = new Date();
    const id = await s.log.newSessionId(date ?? localDate(at));
    let fresh = newSession({
      id,
      at,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      deviceId: s.log.options.deviceId,
    });
    if (date) fresh = setDate(fresh, date);
    if (from) fresh = fromTemplate(fresh, from, () => crypto.randomUUID());
    template = null;
    await save(fresh);
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
    if (!s || !session || !confirm('Delete this session? It is deleted from the log too.')) return;
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

  /** The status line leads to what fixes it: setup, or a sync now. */
  function onStatusTap(): void {
    if (!status) return;
    if (['not_set_up', 'needs_token', 'repo_problem'].includes(status.status)) showSetup = true;
    else void storage?.scheduler.trigger('manual');
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
    />
  {:else if template}
    <TemplateView
      {template}
      {library}
      onchange={saveTemplate}
      onstart={() => template && start(template)}
      onclose={() => (template = null)}
      ondelete={deleteTemplate}
    />
  {:else}
    <Home
      {sessions}
      {templates}
      {library}
      onstart={start}
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
