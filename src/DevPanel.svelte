<script lang="ts">
  import { onMount } from 'svelte';
  import type { LibraryConflict } from './library/assemble';
  import { submissionUrl, type SubmissionKind } from './library/submission';
  import type {
    BodyweightEntry,
    ConflictRecord,
    Exercise,
    ExerciseAddition,
    PerformedSet,
    Session,
  } from './model';
  import { maskToken, parseRepo, startStorage, type AppStorage } from './storage/app';
  import { TABLES, type TableSchema } from './storage/formats';
  import type { ConflictChoice, LibraryConflictChoice, Log } from './storage/log';
  import { classify } from './storage/paths';
  import type { SetupFailure, SetupResult } from './storage/setup';
  import type { StatusSnapshot } from './storage/status';
  import type { Settings } from './storage/store/store';

  // A plain developer panel over the storage layer, so it can be exercised end
  // to end on a phone before the real UI exists: setup, the live status, test
  // data to sync, and the conflict notice, banner and resolution (STORAGE.md 5.2).

  /** One version of a record in conflict, as the lifter is shown it. */
  interface Side {
    label: string;
    /** Its device and time, where known. */
    meta: string;
    /** The record, the row or the exercise; null when that version deleted it. */
    value: unknown;
  }

  /** An unresolved conflict: a sync conflict record, or a library conflict (9.1). */
  type Pending =
    | { kind: 'sync'; id: string; title: string; standing: Side; other: Side }
    | {
        kind: 'library';
        id: string;
        title: string;
        standing: Side;
        other: Side;
        conflict: LibraryConflict;
      };

  interface Outcome {
    ok: boolean;
    title: string;
    message: string;
  }

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

  /** Every setup failure, in words (STORAGE.md section 8). */
  const REFUSED: Record<SetupFailure, string> = {
    not_found: 'Repository not found',
    public: 'The repository is public',
    not_a_log: 'Not a Sisyphos log',
    token: 'The token was refused',
    needs_update: 'This app is too old for that log',
    network: 'Could not finish: try again',
  };

  let storage = $state.raw<AppStorage | null>(null);
  let startError = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  let busy = $state<string | null>(null);
  let syncRequested = $state(false);

  let status = $state.raw<StatusSnapshot | null>(null);
  let persisted = $state<boolean | null>(null);
  let settings = $state.raw<Settings | null>(null);
  let deviceId = $state('');

  let sessions = $state.raw<Session[]>([]);
  let openSession = $state.raw<Session | null>(null);
  let bodyweight = $state.raw<BodyweightEntry[]>([]);
  let additions = $state.raw<ExerciseAddition[]>([]);
  let syncConflicts = $state.raw<Pending[]>([]);
  let libraryConflicts = $state.raw<Pending[]>([]);
  const pending = $derived([...syncConflicts, ...libraryConflicts]);

  /** The conflict notice: closed, the full-screen notice, or the resolution list. */
  let view = $state<'closed' | 'notice' | 'resolve'>('closed');

  let repoText = $state('');
  let tokenText = $state('');
  let connecting = $state(false);
  let setupOutcome = $state.raw<Outcome | null>(null);

  let weightDate = $state(localDate(new Date()));
  let weightKg = $state<number | null>(80);

  let exerciseId = $state('');
  let exerciseName = $state('');
  let submission = $state.raw<{
    kind: SubmissionKind | null;
    name: string;
    url: string | null;
  } | null>(null);

  onMount(() => {
    let disposed = false;
    let started: AppStorage | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;

    startStorage({
      target: window,
      onStatus: (next) => {
        const previous = status;
        status = next;
        // Library conflicts are announced like sync ones (5.2); they only show here.
        if (previous !== null && next.libraryConflicts > previous.libraryConflicts) openNotice();
        // A sync that finished may have taken changes from other devices.
        if (started) void loadData(started);
      },
      onConflicts: () => {
        openNotice();
        if (started) void loadData(started);
      },
    }).then(
      async (s) => {
        if (disposed) {
          s.dispose();
          return;
        }
        started = s;
        storage = s;
        deviceId = s.log.options.deviceId;
        pickExercise((s.shipped.find((e) => e.id === 'low_bar_squat') ?? s.shipped[0])?.id ?? '');
        void s.persisted.then((granted) => (persisted = granted));
        await loadData(s);
        // Every launch shows the notice again while any conflict is unresolved (5.2).
        if (syncConflicts.length + libraryConflicts.length > 0) view = 'notice';
        await refreshStatus(s);
        // Exposure ages with the clock, not only with writes.
        timer = setInterval(() => void refreshStatus(s), 30_000);
      },
      (error) => {
        startError = `Could not open the device store: ${messageOf(error)}`;
      },
    );

    return () => {
      disposed = true;
      clearInterval(timer);
      started?.dispose();
    };
  });

  function openNotice(): void {
    if (view === 'closed') view = 'notice';
  }

  async function refreshStatus(s: AppStorage): Promise<void> {
    // `status()` passes a changed snapshot to `onStatus`, which sets it here.
    await s.scheduler.status().catch((error: unknown) => {
      actionError = `Reading the status failed: ${messageOf(error)}`;
    });
  }

  let loads = 0;

  /** Everything the panel lists, read afresh. Only the latest read is shown. */
  async function loadData(s: AppStorage): Promise<void> {
    const seq = ++loads;
    try {
      const [all, open, rows, adds, records, library, current] = await Promise.all([
        s.log.listSessions('0000-01-01', '9999-12-31'),
        s.log.listOpenSessions(),
        s.log.getRows('bodyweight'),
        s.log.getRows('additions'),
        s.log.getConflicts(),
        s.log.library(),
        s.store.settings(),
      ]);
      const views = await Promise.all(records.map((record) => describeConflict(s.log, record)));
      if (seq !== loads) return;
      sessions = [...all].reverse();
      openSession = open.at(-1) ?? null;
      bodyweight = [...rows].reverse();
      additions = adds;
      settings = current;
      syncConflicts = views;
      libraryConflicts = library.conflicts.map(describeLibrary);
      if (views.length + library.conflicts.length === 0) view = 'closed';
    } catch (error) {
      if (seq === loads) actionError = `Reading the device failed: ${messageOf(error)}`;
    }
  }

  /** Runs one change, one at a time, then shows what it left behind. */
  async function act(label: string, fn: (s: AppStorage) => Promise<void>): Promise<void> {
    const s = storage;
    if (!s || busy) return;
    busy = label;
    actionError = null;
    try {
      await fn(s);
    } catch (error) {
      actionError = `${label} failed: ${messageOf(error)}`;
    } finally {
      busy = null;
    }
    await loadData(s);
    await refreshStatus(s);
  }

  // --- sync and setup ----------------------------------------------------------------

  async function syncNow(): Promise<void> {
    const s = storage;
    if (!s) return;
    syncRequested = true;
    try {
      await s.scheduler.trigger('manual');
    } finally {
      syncRequested = false;
    }
    await loadData(s);
  }

  async function connect(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const s = storage;
    if (!s || connecting) return;
    const name = parseRepo(repoText);
    const token = tokenText.trim();
    if (!name) {
      setupOutcome = {
        ok: false,
        title: 'No repository',
        message: 'Enter it as owner/name, for example me/sisyphos-log, or paste its address.',
      };
      return;
    }
    if (!token) {
      setupOutcome = { ok: false, title: 'No token', message: 'Paste the token you created.' };
      return;
    }
    connecting = true;
    setupOutcome = null;
    try {
      const result = await s.connect({ ...name, token });
      setupOutcome = describeSetup(result, `${name.owner}/${name.repo}`);
      if (result.ok) tokenText = '';
    } catch (error) {
      setupOutcome = { ok: false, title: 'Setup failed unexpectedly', message: messageOf(error) };
    } finally {
      connecting = false;
    }
    await loadData(s);
  }

  function describeSetup(result: SetupResult, name: string): Outcome {
    if (!result.ok) return { ok: false, title: REFUSED[result.reason], message: result.message };
    return {
      ok: true,
      title: result.initialised
        ? `Started a new log in ${name}`
        : `Connected to the log in ${name}`,
      message: 'The first sync is running now; the status above follows it.',
    };
  }

  // --- test data ---------------------------------------------------------------------

  function testSet(n: number): PerformedSet {
    return {
      id: crypto.randomUUID(),
      prescribed_id: null,
      state: 'done',
      reps: 5,
      rpe: 8,
      load: { kind: 'weight', value: 100 + 2.5 * n, unit: 'kg' },
      is_warmup: false,
      notes: null,
    };
  }

  function startSession(): Promise<void> {
    return act('Starting a session', async (s) => {
      const date = localDate(new Date());
      const now = new Date().toISOString();
      const exercise = s.shipped.find((e) => e.id === 'low_bar_squat') ?? s.shipped[0];
      await s.log.putSession({
        id: await s.log.newSessionId(date),
        date,
        started_at: now,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        time_precision: 'instant',
        ended_at: null,
        label: { name: null, block: null, week: null, day: null, weekday: null },
        bodyweight_kg: null,
        notes: 'Dev panel test session',
        exercises: [
          {
            id: crypto.randomUUID(),
            exercise_id: exercise.id,
            prescribed: [],
            performed: [testSet(0)],
            notes: null,
          },
        ],
        created_at: now,
        updated_at: now,
        device_id: s.log.options.deviceId,
      });
    });
  }

  function addSet(id: string): Promise<void> {
    return act('Adding a set', async (s) => {
      // Read afresh: a sync may have changed it since the list was drawn.
      const session = await s.log.getSession(id);
      if (!session) throw new Error(`session ${id} is gone`);
      const [first, ...rest] = session.exercises;
      if (!first) throw new Error(`session ${id} has no exercise`);
      const performed = [...first.performed, testSet(first.performed.length)];
      await s.log.putSession({ ...session, exercises: [{ ...first, performed }, ...rest] });
    });
  }

  function endSession(id: string): Promise<void> {
    return act('Ending the session', async (s) => {
      const session = await s.log.getSession(id);
      if (!session) throw new Error(`session ${id} is gone`);
      await s.log.putSession({ ...session, ended_at: new Date().toISOString() });
      // Not awaited: the status follows the sync.
      void s.scheduler.trigger('session_ended');
    });
  }

  function deleteSession(id: string): Promise<void> {
    return act('Deleting the session', (s) => s.log.deleteSession(id));
  }

  function saveWeight(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const date = weightDate;
    const kg = weightKg;
    return act('Saving the weigh-in', async (s) => {
      if (!ISO_DATE.test(date)) throw new Error('pick a date');
      if (kg === null || !Number.isFinite(kg) || kg <= 0) throw new Error('enter a weight above 0');
      await s.log.putRow('bodyweight', { date, weight_kg: kg, source: 'manual' });
    });
  }

  function deleteWeight(date: string): Promise<void> {
    // Rows are replaced and deleted by key (2.3); the weight is not read.
    return act('Deleting the weigh-in', (s) =>
      s.log.deleteRow('bodyweight', { date, weight_kg: 0, source: 'manual' }),
    );
  }

  function pickExercise(id: string): void {
    exerciseId = id;
    const shipped = storage?.shipped.find((e) => e.id === id);
    exerciseName = shipped ? `${shipped.name} (edited)` : '';
  }

  function saveExercise(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    return act('Saving the exercise', async (s) => {
      const shipped = s.shipped.find((e) => e.id === exerciseId);
      if (!shipped) throw new Error('pick an exercise');
      const exercise: Exercise = { ...shipped, name: exerciseName.trim() || shipped.name };
      const kind = await s.log.saveExercise(exercise);
      submission = {
        kind,
        name: exercise.name,
        url: kind === null ? null : submissionUrl(exercise, kind),
      };
    });
  }

  // --- conflicts ---------------------------------------------------------------------

  function resolveSync(id: string, choice: ConflictChoice): Promise<void> {
    return act('Resolving the conflict', (s) => s.log.resolveConflict(id, choice));
  }

  function resolveLibrary(conflict: LibraryConflict, choice: LibraryConflictChoice): Promise<void> {
    return act('Resolving the library conflict', async (s) => {
      const kind = await s.log.resolveLibraryConflict(conflict.id, choice);
      // Keeping mine opens a new submission (9.1).
      if (kind !== null) {
        submission = {
          kind,
          name: conflict.addition.name,
          url: submissionUrl(conflict.addition, kind),
        };
      }
    });
  }

  /** A conflict record beside the version that stands in the data now (5.2). */
  async function describeConflict(log: Log, record: ConflictRecord): Promise<Pending> {
    const target = classify(record.path);
    const written = (record.version as { updated_at?: unknown } | null)?.updated_at;
    const other: Side = {
      label: 'Saved version',
      meta: [
        who(record.device_id),
        typeof written === 'string' ? `written ${when(written)}` : null,
        `found ${when(record.found_at)}`,
      ]
        .filter(Boolean)
        .join(' · '),
      value: record.version,
    };
    const standing: Side = {
      label: 'In the log (stands now)',
      meta: 'device and time not recorded',
      value: null,
    };
    let title = record.path;

    if (target.kind === 'session') {
      const session = await log.getSession(target.id);
      title = `Session ${target.id}`;
      standing.value = session;
      if (session)
        standing.meta = `${who(session.device_id)} · written ${when(session.updated_at)}`;
    } else if (target.kind === 'template') {
      const template = (await log.getTemplates()).find((t) => t.id === target.id) ?? null;
      title = `Template ${target.id}`;
      standing.value = template;
      if (template) standing.meta = `device not recorded · written ${when(template.updated_at)}`;
    } else if (target.kind === 'table') {
      const schema = TABLES[target.table] as unknown as TableSchema<unknown>;
      const key = record.key ?? {};
      const rows = ((await log.getRows(target.table)) as unknown[]).map((r) => schema.toRow(r));
      standing.value = rows.find((row) => schema.key.every((c) => row[c] === key[c])) ?? null;
      title = `${schema.path}, row ${schema.key.map((c) => key[c]).join(', ')}`;
    }
    return { kind: 'sync', id: record.id, title, standing, other };
  }

  function describeLibrary(conflict: LibraryConflict): Pending {
    const { based_on, ...addition } = conflict.addition;
    return {
      kind: 'library',
      id: conflict.id,
      title: `Exercise ${conflict.id}`,
      standing: {
        label: 'Shipped with the app (used now)',
        meta: 'changed in the app since your addition was made',
        value: conflict.shipped,
      },
      other: {
        label: 'Your addition',
        meta: `made against shipped row ${based_on ?? '(none)'}`,
        value: addition,
      },
      conflict,
    };
  }

  /** A version's lines, each marked when the other version has no such line. */
  function diffLines(value: unknown, against: unknown): Array<{ text: string; changed: boolean }> {
    const theirs = new Set(lines(against));
    return lines(value).map((text) => ({ text, changed: !theirs.has(text) }));
  }

  function lines(value: unknown): string[] {
    return value === null || value === undefined
      ? ['(deleted)']
      : JSON.stringify(value, null, 2).split('\n');
  }

  function focusOnMount(node: HTMLElement): void {
    node.focus();
  }

  // --- words -------------------------------------------------------------------------

  function who(device: string): string {
    return device === deviceId ? 'this device' : `device ${device.slice(0, 8)}`;
  }

  function when(instant: string | Date): string {
    const date = typeof instant === 'string' ? new Date(instant) : instant;
    return Number.isNaN(date.getTime()) ? String(instant) : date.toLocaleString();
  }

  function localDate(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function setCount(session: Session): number {
    return session.exercises.reduce((sum, e) => sum + e.performed.length, 0);
  }

  /** An error's message, with any token it might carry masked. */
  function messageOf(error: unknown): string {
    let text = error instanceof Error ? error.message : String(error);
    for (const secret of [settings?.token, tokenText.trim()]) {
      if (secret) text = text.split(secret).join(maskToken(secret));
    }
    return text;
  }

  function plural(n: number, one: string, many = `${one}s`): string {
    return `${n} ${n === 1 ? one : many}`;
  }

  function unsynced({ exposure }: StatusSnapshot): string {
    const files = plural(exposure.unsyncedDocuments, 'file');
    const oldest = exposure.oldestUnsyncedMinutes;
    return oldest === null ? files : `${files}, the oldest changed ${oldest} min ago`;
  }
</script>

{#if pending.length > 0}
  <div class="banner" role="alert">
    <span>
      <strong>{plural(pending.length, 'unresolved conflict')}.</strong> Nothing is lost; pick which version
      to keep.
    </span>
    <button type="button" class="btn" onclick={() => (view = 'resolve')}>Resolve</button>
  </div>
{/if}

{#if view !== 'closed' && pending.length > 0}
  <div class="overlay" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
    <div class="overlay-inner">
      {#if view === 'notice'}
        <h2 id="conflict-title" class="overlay-title">
          {pending.length === 1
            ? 'A conflict needs your choice'
            : `${pending.length} conflicts need your choice`}
        </h2>
        <p>
          The same thing was changed in two places. One version is in use for now and the other is
          kept, so nothing is lost until you pick.
        </p>
        <ul class="summary">
          {#each pending as item (item.kind + item.id)}
            <li>
              <strong>{item.title}</strong>
              <span class="muted"
                >{item.kind === 'sync' ? item.other.meta : 'exercise library'}</span
              >
            </li>
          {/each}
        </ul>
        <div class="choices">
          <button
            type="button"
            class="btn primary"
            use:focusOnMount
            onclick={() => (view = 'resolve')}
          >
            Resolve now
          </button>
          <button type="button" class="btn" onclick={() => (view = 'closed')}>Later</button>
        </div>
      {:else}
        <div class="overlay-head">
          <h2 id="conflict-title" class="overlay-title">
            Resolve {plural(pending.length, 'conflict')}
          </h2>
          <button type="button" class="btn" onclick={() => (view = 'closed')}>Later</button>
        </div>
        {#if actionError}<p class="error">{actionError}</p>{/if}
        {#each pending as item (item.kind + item.id)}
          <article class="conflict">
            <h3>{item.title}</h3>
            <div class="versions">
              {#each [[item.standing, item.other], [item.other, item.standing]] as [side, against] (side.label)}
                <div class="version">
                  <h4>{side.label}</h4>
                  <p class="muted">{side.meta}</p>
                  <div class="code">
                    {#each diffLines(side.value, against.value) as line, i (i)}
                      <span class:changed={line.changed}>{line.text}</span>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
            <div class="choices">
              {#if item.kind === 'sync'}
                <button
                  type="button"
                  class="btn primary"
                  disabled={busy !== null}
                  onclick={() => resolveSync(item.id, 'keep_log')}
                >
                  Keep the log's version <code>keep_log</code>
                </button>
                <button
                  type="button"
                  class="btn"
                  disabled={busy !== null}
                  onclick={() => resolveSync(item.id, 'use_saved')}
                >
                  Use the saved version <code>use_saved</code>
                </button>
              {:else}
                {@const conflict = item.conflict}
                <button
                  type="button"
                  class="btn primary"
                  disabled={busy !== null}
                  onclick={() => resolveLibrary(conflict, 'use_shipped')}
                >
                  Use the official one <code>use_shipped</code>
                </button>
                <button
                  type="button"
                  class="btn"
                  disabled={busy !== null}
                  onclick={() => resolveLibrary(conflict, 'keep_mine')}
                >
                  Keep mine <code>keep_mine</code>
                </button>
              {/if}
            </div>
          </article>
        {/each}
      {/if}
    </div>
  </div>
{/if}

<section class="devpanel">
  <h2>Developer panel</h2>
  <p class="lede">
    The storage layer, end to end: this device's store, sync with your log repo, and conflicts.
    Throwaway; the real screens come later.
  </p>

  {#if startError}<p class="error">{startError}</p>{/if}
  {#if actionError && view !== 'resolve'}<p class="error">{actionError}</p>{/if}

  <div class="card">
    <h3>Sync</h3>
    {#if status}
      <dl class="facts">
        <dt>Status</dt>
        <dd>
          <code>{status.status}</code>{#if status.message}&nbsp;{status.message}{/if}
        </dd>
        <dt>Next retry</dt>
        <dd>{status.nextRetryAt ? when(status.nextRetryAt) : '—'}</dd>
        <dt>Exposure</dt>
        <dd><code>{status.exposure.level}</code>&nbsp;{status.exposure.message}</dd>
        <dt>Unsynced</dt>
        <dd>{unsynced(status)}</dd>
        <dt>Conflicts</dt>
        <dd>{status.conflicts} in the log, {status.libraryConflicts} in the library</dd>
        <dt>Unreadable</dt>
        <dd>
          {#if status.unreadable.length > 0}
            {#each status.unreadable as path (path)}<code class="path">{path}</code>
            {/each}
          {:else}none{/if}
        </dd>
        <dt>Storage</dt>
        <dd>
          {persisted === null
            ? '…'
            : persisted
              ? 'persistent'
              : 'not persistent: the browser may evict it (install the app to fix)'}
        </dd>
      </dl>
    {:else if !startError}
      <p class="muted">Opening the device store…</p>
    {/if}
    <button
      type="button"
      class="btn primary"
      disabled={!storage || syncRequested}
      onclick={syncNow}
    >
      {syncRequested ? 'Syncing…' : 'Sync now'}
    </button>
  </div>

  <div class="card">
    <h3>Setup</h3>
    {#if settings?.owner && settings.repo && settings.branch}
      <p>
        Syncing with <code>{settings.owner}/{settings.repo}</code> on
        <code>{settings.branch}</code>, token <code>{maskToken(settings.token)}</code>.
      </p>
    {:else}
      <p>Not set up: this phone is the only copy.</p>
    {/if}
    <p class="muted">This device: <code>{deviceId || '…'}</code></p>
    <ol class="checklist">
      <li>
        On github.com, <a href="https://github.com/new" target="_blank" rel="noopener noreferrer"
          >create a private repository</a
        >, any name (<code>sisyphos-log</code> is suggested), with <em>Add a README</em> ticked.
      </li>
      <li>
        <a
          href="https://github.com/settings/personal-access-tokens/new"
          target="_blank"
          rel="noopener noreferrer">Create a fine-grained token</a
        >: resource owner yourself; repository access <em>only that repository</em>; permissions
        <em>Contents: read and write</em> (Metadata: read is added for you). Expiry is your choice.
      </li>
      <li>
        Enter <code>owner/repo</code> and paste the token here. The app checks the repo is private, starts
        the log in it, then runs the first sync.
      </li>
    </ol>
    <form class="setup" onsubmit={connect}>
      <label>
        <span>Repository</span>
        <input
          bind:value={repoText}
          placeholder="owner/sisyphos-log"
          autocapitalize="none"
          autocomplete="off"
          spellcheck="false"
        />
      </label>
      <label>
        <span>Token</span>
        <input
          type="password"
          bind:value={tokenText}
          placeholder="github_pat_…"
          autocomplete="off"
          spellcheck="false"
        />
      </label>
      <button type="submit" class="btn primary" disabled={!storage || connecting}>
        {connecting ? 'Checking…' : 'Set up and sync'}
      </button>
    </form>
    {#if setupOutcome}
      <p class={setupOutcome.ok ? 'ok' : 'error'}>
        <strong>{setupOutcome.title}.</strong>
        {setupOutcome.message}
      </p>
    {/if}
  </div>

  <div class="card">
    <h3>Test data</h3>
    {#if busy}<p class="muted">{busy}…</p>{/if}

    <h4>Sessions</h4>
    <div class="row">
      <button type="button" class="btn" disabled={!storage || busy !== null} onclick={startSession}>
        Start a test session
      </button>
      {#if openSession}
        {@const id = openSession.id}
        <button type="button" class="btn" disabled={busy !== null} onclick={() => addSet(id)}>
          Add a set
        </button>
        <button type="button" class="btn" disabled={busy !== null} onclick={() => endSession(id)}>
          End it (syncs)
        </button>
      {/if}
    </div>
    <p class="muted">
      {openSession
        ? `In progress: ${openSession.id}. Leaving the app does not sync until it ends.`
        : 'No session in progress.'}
    </p>
    <ul class="list">
      {#each sessions as session (session.id)}
        <li>
          <span>
            <code>{session.id}</code>
            {session.ended_at ? 'ended' : 'open'} · {plural(setCount(session), 'set')} ·
            {who(session.device_id)}{#if session.notes}&nbsp;· {session.notes}{/if}
          </span>
          <button
            type="button"
            class="btn small"
            disabled={busy !== null}
            onclick={() => deleteSession(session.id)}>Delete</button
          >
        </li>
      {:else}
        <li class="muted">No sessions on this device.</li>
      {/each}
    </ul>

    <h4>Bodyweight</h4>
    <form class="row" onsubmit={saveWeight}>
      <input type="date" bind:value={weightDate} aria-label="Date" />
      <input
        type="number"
        step="0.1"
        min="0"
        inputmode="decimal"
        bind:value={weightKg}
        aria-label="Weight in kg"
      />
      <button type="submit" class="btn" disabled={!storage || busy !== null}>Save</button>
      <button
        type="button"
        class="btn"
        disabled={!storage || busy !== null}
        onclick={() => deleteWeight(weightDate)}>Delete this date</button
      >
    </form>
    <ul class="list">
      {#each bodyweight as row (row.date)}
        <li>
          <span><code>{row.date}</code> {row.weight_kg} kg</span>
          <button
            type="button"
            class="btn small"
            disabled={busy !== null}
            onclick={() => deleteWeight(row.date)}>Delete</button
          >
        </li>
      {:else}
        <li class="muted">No weigh-ins on this device.</li>
      {/each}
    </ul>

    <h4>Exercise library</h4>
    <form class="row" onsubmit={saveExercise}>
      <select
        value={exerciseId}
        onchange={(event) => pickExercise(event.currentTarget.value)}
        aria-label="Shipped exercise"
      >
        {#each storage?.shipped ?? [] as exercise (exercise.id)}
          <option value={exercise.id}>{exercise.name}</option>
        {/each}
      </select>
      <input bind:value={exerciseName} aria-label="Name for the changed copy" />
      <button type="submit" class="btn" disabled={!storage || busy !== null}>
        Save changed copy
      </button>
    </form>
    {#if submission}
      <p>
        Saved <strong>{submission.name}</strong>: submission
        <code>{submission.kind ?? 'none'}</code>.
        {#if submission.url}
          <a href={submission.url} target="_blank" rel="noopener noreferrer"
            >Open the prefilled issue</a
          >
        {:else}
          It equals the shipped row, so there is nothing to submit.
        {/if}
      </p>
    {/if}
    <ul class="list">
      {#each additions as addition (addition.id)}
        <li>
          <span
            ><code>{addition.id}</code>
            {addition.name} · based on
            <code>{addition.based_on ?? 'nothing'}</code></span
          >
        </li>
      {:else}
        <li class="muted">No additions.</li>
      {/each}
    </ul>

    <p class="note">
      To see a sync conflict: sync, change a session's notes in the log repo on github.com, add a
      set to the same session here, then sync. For a library conflict: save a changed copy, sync,
      then on github.com set that row's <code>based_on</code> in <code>library/additions.csv</code> to
      any other 12 hex characters, and sync.
    </p>
  </div>
</section>

<style>
  .devpanel {
    margin-bottom: 2.5rem;
  }
  h2 {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--muted);
    border-bottom: 1px solid var(--line);
    padding-bottom: 0.4rem;
    margin: 0 0 0.9rem;
  }
  h3 {
    font-size: 1rem;
    margin: 0 0 0.6rem;
  }
  h4 {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    margin: 1.2rem 0 0.5rem;
  }
  p {
    margin: 0 0 0.8rem;
  }
  .lede {
    color: var(--ink-2);
    font-size: 0.92rem;
  }
  .muted {
    color: var(--muted);
    font-size: 0.85rem;
  }
  .note {
    font-size: 0.8rem;
    color: var(--muted);
    margin: 1rem 0 0;
  }
  .ok {
    color: var(--ink);
    border-left: 3px solid var(--ink-2);
    padding-left: 0.6rem;
  }
  .error {
    color: var(--accent);
    border-left: 3px solid var(--accent);
    padding-left: 0.6rem;
    overflow-wrap: anywhere;
  }
  code {
    font-family: var(--mono);
    font-size: 0.85em;
    background: var(--ground);
    border: 1px solid var(--line);
    padding: 0 0.25em;
    overflow-wrap: anywhere;
  }
  a {
    color: var(--accent);
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 1rem;
    margin-bottom: 1rem;
  }

  .facts {
    display: grid;
    grid-template-columns: 7rem 1fr;
    gap: 0.35rem 0.8rem;
    margin: 0 0 1rem;
    font-size: 0.9rem;
  }
  .facts dt {
    color: var(--muted);
  }
  .facts dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .path {
    display: inline-block;
    margin: 0 0.3rem 0.2rem 0;
  }

  .checklist {
    padding-left: 1.2rem;
    font-size: 0.9rem;
    color: var(--ink-2);
  }
  .checklist li {
    margin-bottom: 0.4rem;
  }

  .setup {
    display: grid;
    gap: 0.6rem;
    margin-bottom: 0.8rem;
  }
  .setup label {
    display: grid;
    gap: 0.2rem;
    font-size: 0.85rem;
    color: var(--ink-2);
  }

  /* 16px or more, or iOS zooms the page when a field is focused. */
  input,
  select {
    font: inherit;
    font-size: 1rem;
    min-width: 0;
    padding: 0.45rem 0.55rem;
    border: 1px solid var(--line);
    border-radius: 4px;
    background: var(--ground);
    color: var(--ink);
  }
  input:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.6rem;
  }
  .row input,
  .row select {
    flex: 1 1 9rem;
  }

  .btn {
    font: inherit;
    font-size: 0.9rem;
    min-height: 2.5rem;
    padding: 0.4rem 0.9rem;
    border: 1px solid var(--line);
    border-radius: 4px;
    background: var(--surface);
    color: var(--ink);
    cursor: pointer;
  }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--ground);
    font-weight: 600;
  }
  .btn.small {
    min-height: 2rem;
    padding: 0.2rem 0.6rem;
    font-size: 0.8rem;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .btn code {
    background: none;
    border: none;
    font-size: 0.75em;
    opacity: 0.8;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 0.85rem;
  }
  .list li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.6rem;
    padding: 0.35rem 0;
    border-bottom: 1px solid var(--line);
    overflow-wrap: anywhere;
  }
  .list .btn {
    flex: none;
  }

  /* Cannot be dismissed: it stays while any conflict is unresolved (5.2). */
  .banner {
    position: sticky;
    top: env(safe-area-inset-top, 0px);
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    margin: 0 0 1rem;
    padding: 0.6rem 0.8rem;
    border-radius: 6px;
    background: var(--accent);
    color: var(--ground);
    font-size: 0.9rem;
  }
  .banner .btn {
    flex: none;
    background: var(--ground);
    border-color: var(--ground);
    color: var(--accent);
    font-weight: 600;
  }

  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    overflow-y: auto;
    /* Scrolling the notice does not scroll the page behind it. */
    overscroll-behavior: contain;
    background: var(--ground);
    padding: max(1.25rem, env(safe-area-inset-top)) 1.25rem max(1.5rem, env(safe-area-inset-bottom));
  }
  .overlay-inner {
    max-width: 60rem;
    margin: 0 auto;
  }
  .overlay-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  .overlay-title {
    font-size: 1.3rem;
    text-transform: none;
    letter-spacing: -0.01em;
    color: var(--ink);
    border: none;
    padding: 0;
    margin: 0 0 0.6rem;
  }
  .overlay-head .overlay-title {
    margin: 0;
  }
  .summary {
    padding-left: 1.2rem;
    margin: 0 0 1.2rem;
  }
  .summary li {
    margin-bottom: 0.4rem;
    overflow-wrap: anywhere;
  }
  .summary .muted {
    display: block;
  }
  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .conflict {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 1rem;
    margin-bottom: 1rem;
  }
  .versions {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 0.8rem;
    margin-bottom: 0.8rem;
  }
  .version h4 {
    margin-top: 0;
  }
  .code {
    font-family: var(--mono);
    font-size: 0.72rem;
    line-height: 1.45;
    background: var(--ground);
    border: 1px solid var(--line);
    padding: 0.5rem;
    max-height: 24rem;
    overflow: auto;
  }
  .code span {
    display: block;
    white-space: pre;
  }
  .code .changed {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
  }

  @media (max-width: 40rem) {
    .versions {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: 30rem) {
    .facts {
      grid-template-columns: 1fr;
      gap: 0.1rem;
    }
    .facts dd {
      margin-bottom: 0.4rem;
    }
  }
</style>
