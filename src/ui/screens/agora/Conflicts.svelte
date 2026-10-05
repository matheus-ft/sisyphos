<script lang="ts">
  import type { LibraryConflict } from '../../../library/assemble';
  import { submissionUrl } from '../../../library/submission';
  import type { ConflictRecord, Exercise, Session, TableRow, Template } from '../../../model';
  import { TABLES } from '../../../storage/formats';
  import type { ConflictChoice } from '../../../storage/log';
  import { classify } from '../../../storage/paths';
  import { app } from '../../app.svelte';
  import { describeConflict, exerciseNames, type ConflictView } from '../../conflicts';
  import Button from '../../kit/Button.svelte';
  import ScreenHeader from '../../kit/ScreenHeader.svelte';
  import { routeHash } from '../../route';

  /**
   * Two devices changed the same thing: each conflict with both versions side
   * by side, to keep one. Nothing was lost. Shown as Agora's Conflicts page,
   * and as the full-screen notice at launch (`notice`), with "Later".
   */
  interface Props {
    notice?: boolean;
    onlater?: () => void;
  }
  let { notice = false, onlater }: Props = $props();

  let conflicts = $state<(ConflictView & { device: string })[]>([]);
  let libraryConflicts = $state<LibraryConflict[]>([]);

  $effect(() => {
    // Reread when a sync changes the count, or a resolution lands.
    void app.status;
    void load();
  });

  async function load(): Promise<void> {
    const storage = app.storage;
    if (!storage) return;
    const names = exerciseNames(app.library);
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
    const storage = app.storage!;
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

  async function resolve(id: string, choice: ConflictChoice): Promise<void> {
    const storage = app.storage;
    if (!storage) return;
    await storage.log.resolveConflict(id, choice);
    await storage.scheduler.status();
    await app.load();
    await load();
  }

  async function resolveLibrary(conflict: LibraryConflict, keepMine: boolean): Promise<void> {
    const storage = app.storage;
    if (!storage) return;
    // Opened within the tap, as Safari requires, and pointed at the submission after.
    const tab = keepMine ? window.open('', '_blank') : null;
    const kind = await storage.log.resolveLibraryConflict(
      conflict.id,
      keepMine ? 'keep_mine' : 'use_shipped',
    );
    if (tab && kind) tab.location.href = submissionUrl(conflict.addition, kind);
    else tab?.close();
    await storage.scheduler.status();
    await app.load();
    await load();
  }

  const muscles = (e: Exercise) =>
    `${e.tier}, ${e.base_lift ?? 'no lift'}; ${e.muscles.primary.join('/')}${e.muscles.aux.length ? ` + ${e.muscles.aux.join('/')}` : ''}`;
</script>

<ScreenHeader
  title={notice ? 'Conflicts to settle' : 'Conflicts'}
  back={notice ? undefined : { href: routeHash({ name: 'more', page: null }) }}
/>

<p class="intro">
  Two devices changed the same thing. Nothing was lost: pick which version to keep.
</p>

{#if conflicts.length === 0 && libraryConflicts.length === 0}
  <p class="meta none">No conflicts are waiting.</p>
{/if}

{#each conflicts as conflict (conflict.id)}
  <section class="card">
    <h3>{conflict.what}</h3>
    <div class="versions">
      <div>
        <p class="caps">In the log</p>
        {#each conflict.current as l, i (i)}<p class="l">{l}</p>{/each}
      </div>
      <div>
        <p class="caps">Saved from {conflict.device}</p>
        {#each conflict.saved as l, i (i)}<p class="l">{l}</p>{/each}
      </div>
    </div>
    <div class="acts">
      <Button full onclick={() => resolve(conflict.id, 'keep_log')}>Keep the log's</Button>
      <Button full onclick={() => resolve(conflict.id, 'use_saved')}>Use the saved</Button>
    </div>
  </section>
{/each}

{#each libraryConflicts as conflict (conflict.id)}
  <section class="card">
    <h3>Exercise: {conflict.shipped.name}</h3>
    <div class="versions">
      <div>
        <p class="caps">In the app</p>
        <p class="l">{conflict.shipped.name}</p>
        <p class="l">{muscles(conflict.shipped)}</p>
      </div>
      <div>
        <p class="caps">Yours</p>
        <p class="l">{conflict.addition.name}</p>
        <p class="l">{muscles(conflict.addition)}</p>
      </div>
    </div>
    <div class="acts">
      <Button full onclick={() => resolveLibrary(conflict, false)}>Use the app's</Button>
      <Button full onclick={() => resolveLibrary(conflict, true)}>Keep mine</Button>
    </div>
  </section>
{/each}

{#if notice}
  <div class="later"><Button variant="link" onclick={onlater}>Later</Button></div>
{/if}

<style>
  .intro,
  .none {
    margin: 0 var(--gutter) var(--space-3);
    color: var(--ink-2);
  }

  .card {
    margin: 0 12px var(--space-2);
  }

  .versions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);
    margin-top: var(--space-2);
  }

  .caps {
    margin-bottom: var(--space-1);
    color: var(--ink-2);
  }

  .l {
    font-size: var(--fs-meta);
    overflow-wrap: anywhere;
  }

  .acts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .later {
    display: flex;
    justify-content: center;
    margin-top: var(--space-2);
  }
</style>
