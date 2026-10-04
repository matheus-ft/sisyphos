<script lang="ts">
  import { onMount } from 'svelte';
  import type { LibraryConflict } from '../library/assemble';
  import { submissionUrl } from '../library/submission';
  import type { ConflictRecord, Exercise, Session, TableRow, Template } from '../model';
  import { maskToken, type AppStorage } from '../storage/app';
  import { TABLES } from '../storage/formats';
  import type { ConflictChoice } from '../storage/log';
  import { classify } from '../storage/paths';
  import type { StatusSnapshot } from '../storage/status';
  import { describeConflict, exerciseNames, type ConflictView } from './conflicts';
  import { statusLine } from './status';

  interface Props {
    storage: AppStorage;
    status: StatusSnapshot | null;
    library: Exercise[];
    onsetup: () => void;
    onclose: () => void;
  }
  let { storage, status, library, onsetup, onclose }: Props = $props();

  let repo = $state('');
  let token = $state('');
  let conflicts = $state<(ConflictView & { device: string })[]>([]);
  let libraryConflicts = $state<LibraryConflict[]>([]);
  let syncing = $state(false);

  const line = $derived(status ? statusLine(status, false) : null);

  onMount(() => void load());

  async function load(): Promise<void> {
    const settings = await storage.store.settings();
    repo = settings.owner ? `${settings.owner}/${settings.repo}` : '';
    token = maskToken(settings.token);
    const names = exerciseNames(library);
    const records = await storage.log.getConflicts();
    conflicts = await Promise.all(
      records.map(async (record) => ({
        ...describeConflict(record, await currentOf(record), names),
        device: record.device_id === storage.log.options.deviceId ? 'this phone' : 'another device',
      })),
    );
    libraryConflicts = (await storage.log.library()).conflicts;
  }

  /** What the data holds now for the record a conflict is about. */
  async function currentOf(record: ConflictRecord): Promise<Session | Template | TableRow | null> {
    const kind = classify(record.path);
    if (kind.kind === 'session') return storage.log.getSession(kind.id);
    if (kind.kind === 'template') {
      return (await storage.log.getTemplates()).find((t) => t.id === kind.id) ?? null;
    }
    if (kind.kind === 'table' && record.key) {
      const schema = TABLES[kind.table] as unknown as { toRow: (r: unknown) => TableRow };
      const rows = (await storage.log.getRows(kind.table)).map((r) => schema.toRow(r));
      const key = record.key;
      return rows.find((row) => Object.entries(key).every(([k, v]) => row[k] === v)) ?? null;
    }
    return null;
  }

  async function syncNow(): Promise<void> {
    syncing = true;
    try {
      await storage.scheduler.trigger('manual');
    } finally {
      syncing = false;
    }
    await load();
  }

  async function resolve(id: string, choice: ConflictChoice): Promise<void> {
    await storage.log.resolveConflict(id, choice);
    await storage.scheduler.status();
    await load();
  }

  async function resolveLibrary(conflict: LibraryConflict, keepMine: boolean): Promise<void> {
    // Opened within the tap, as Safari requires, and pointed at the submission after.
    const tab = keepMine ? window.open('', '_blank') : null;
    const kind = await storage.log.resolveLibraryConflict(
      conflict.id,
      keepMine ? 'keep_mine' : 'use_shipped',
    );
    if (tab && kind) tab.location.href = submissionUrl(conflict.addition, kind);
    else tab?.close();
    await storage.scheduler.status();
    await load();
  }

  const muscles = (e: Exercise) =>
    `${e.tier}, ${e.base_lift ?? 'no lift'}; ${e.muscles.primary.join('/')}${e.muscles.aux.length ? ` + ${e.muscles.aux.join('/')}` : ''}`;
</script>

<article>
  <button class="link" onclick={onclose}>‹ back</button>
  <h1>Sync</h1>

  {#if line}<p class:alarm={line.alarm}>{line.text}</p>{/if}
  {#if status}<p class="muted">{status.exposure.message}</p>{/if}

  <dl>
    <dt>log repo</dt>
    <dd>{repo || 'none'}</dd>
    <dt>token</dt>
    <dd class="tabular">{token}</dd>
  </dl>
  <div class="actions">
    <button class="link" disabled={syncing || !repo} onclick={syncNow}
      >{syncing ? 'syncing…' : 'sync now'}</button
    >
    <button class="link" onclick={onsetup}>change repo or token</button>
  </div>

  {#if status?.unreadable.length}
    <h2>Left alone</h2>
    <p class="muted">
      These files in the log repo do not read as the app writes them, so sync leaves them as they
      are. Fix or remove them on github.com.
    </p>
    <ul>
      {#each status.unreadable as path (path)}<li class="tabular">{path}</li>{/each}
    </ul>
  {/if}

  {#if conflicts.length || libraryConflicts.length}
    <h2>Conflicts</h2>
    <p class="muted">
      Two devices changed the same thing. Nothing was lost: pick which version to keep.
    </p>
  {/if}
  {#each conflicts as conflict (conflict.id)}
    <section>
      <h3>{conflict.what}</h3>
      <div class="versions">
        <div>
          <h4>in the log</h4>
          {#each conflict.current as l, i (i)}<p>{l}</p>{/each}
        </div>
        <div>
          <h4>saved from {conflict.device}</h4>
          {#each conflict.saved as l, i (i)}<p>{l}</p>{/each}
        </div>
      </div>
      <div class="actions">
        <button class="link" onclick={() => resolve(conflict.id, 'keep_log')}>keep the log's</button
        >
        <button class="link" onclick={() => resolve(conflict.id, 'use_saved')}>use the saved</button
        >
      </div>
    </section>
  {/each}
  {#each libraryConflicts as conflict (conflict.id)}
    <section>
      <h3>exercise: {conflict.shipped.name}</h3>
      <div class="versions">
        <div>
          <h4>in the app</h4>
          <p>{conflict.shipped.name}</p>
          <p>{muscles(conflict.shipped)}</p>
        </div>
        <div>
          <h4>yours</h4>
          <p>{conflict.addition.name}</p>
          <p>{muscles(conflict.addition)}</p>
        </div>
      </div>
      <div class="actions">
        <button class="link" onclick={() => resolveLibrary(conflict, false)}>use the app's</button>
        <button class="link" onclick={() => resolveLibrary(conflict, true)}>keep mine</button>
      </div>
    </section>
  {/each}
</article>

<style>
  h1 {
    font-size: 1.4rem;
  }

  h2 {
    margin: 2rem 0 0.25rem;
    font-size: 0.8rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  h3 {
    margin: 0;
    font-size: 1rem;
  }

  h4 {
    margin: 0.5rem 0 0.25rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--muted);
  }

  .alarm {
    color: var(--accent);
  }

  .muted {
    color: var(--muted);
    font-size: 0.9rem;
  }

  dl {
    display: grid;
    grid-template-columns: 6rem 1fr;
    gap: 0.25rem;
  }

  dt {
    color: var(--muted);
  }

  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    gap: 1.5rem;
  }

  section {
    padding: 0.75rem 0;
    border-bottom: 1px solid var(--line);
  }

  .versions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  .versions p {
    margin: 0;
    font-size: 0.9rem;
    overflow-wrap: anywhere;
  }

  ul {
    padding-left: 1rem;
  }
</style>
