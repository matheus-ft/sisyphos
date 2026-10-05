<script lang="ts">
  import type { LibraryConflict } from '../../../library/assemble';
  import { submissionUrl } from '../../../library/submission';
  import type { ConflictRecord, Session, TableRow, Template } from '../../../model';
  import { TABLES } from '../../../storage/formats';
  import { classify } from '../../../storage/paths';
  import { app } from '../../app.svelte';
  import {
    describeConflict,
    describeLibraryConflict,
    exerciseNames,
    keptMessage,
    whenLabel,
    type ConflictSide,
    type ConflictView,
    type LibraryConflictView,
    type Span,
  } from '../../conflicts';
  import Button from '../../kit/Button.svelte';
  import EmptyState from '../../kit/EmptyState.svelte';
  import ScreenHeader from '../../kit/ScreenHeader.svelte';
  import { showToast } from '../../overlays.svelte';
  import { routeHash } from '../../route';

  /**
   * Agora › Conflicts: two devices changed the same thing, so each conflict
   * sets both versions out, with only what differs marked, to keep one.
   * Nothing is lost until then.
   */

  let conflicts = $state<ConflictView[]>([]);
  let libraryConflicts = $state<{ view: LibraryConflictView; conflict: LibraryConflict }[]>([]);
  let loaded = $state(false);
  /** A resolution in flight: a second tap must not resolve it twice. */
  let busy = $state(false);

  const total = $derived(conflicts.length + libraryConflicts.length);

  $effect(() => {
    // Reread when a sync changes the count, or a resolution lands.
    void app.status;
    void load();
  });

  async function load(): Promise<void> {
    const storage = app.storage;
    if (!storage) return;
    const names = exerciseNames(app.library);
    const device = { id: storage.log.options.deviceId, name: app.prefs.deviceName };
    const records = await storage.log.getConflicts();
    conflicts = await Promise.all(
      records.map(async (record) =>
        describeConflict(record, await currentOf(record), names, device),
      ),
    );
    libraryConflicts = (await storage.log.library()).conflicts.map((conflict) => ({
      conflict,
      view: describeLibraryConflict(conflict),
    }));
    loaded = true;
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

  async function settled(message: string): Promise<void> {
    await app.storage!.scheduler.status();
    await app.load();
    await load();
    showToast({ message });
  }

  async function resolve(id: string, side: ConflictSide): Promise<void> {
    const storage = app.storage;
    if (!storage || busy) return;
    busy = true;
    try {
      try {
        await storage.log.resolveConflict(id, side.choice);
      } catch (error) {
        notSettled(error);
        return;
      }
      app.failure = null;
      await settled(keptMessage(side.device));
    } finally {
      busy = false;
    }
  }

  /** Said where every screen shows it, with the conflict left as it was to try again. */
  function notSettled(error: unknown): void {
    const why = error instanceof Error ? error.message : String(error);
    app.failure = `The conflict was not settled, so it is still there: ${why}`;
  }

  async function resolveLibrary(conflict: LibraryConflict, keepMine: boolean): Promise<void> {
    const storage = app.storage;
    if (!storage || busy) return;
    busy = true;
    // Opened within the tap, as Safari requires, and pointed at the submission after.
    const tab = keepMine ? window.open('', '_blank') : null;
    try {
      let kind;
      try {
        kind = await storage.log.resolveLibraryConflict(
          conflict.id,
          keepMine ? 'keep_mine' : 'use_shipped',
        );
      } catch (error) {
        // The tab was opened within the tap; nothing is left to send it to.
        tab?.close();
        notSettled(error);
        return;
      }
      if (tab && kind) tab.location.href = submissionUrl(conflict.addition, kind);
      else tab?.close();
      app.failure = null;
      await settled(keepMine ? 'Kept your exercise' : "Kept the app's exercise");
    } finally {
      busy = false;
    }
  }
</script>

{#snippet lines(rows: Span[][])}
  {#each rows as row, i (i)}
    <p class="l">
      {#each row as span, k (k)}{#if span.changed}<mark>{span.text}</mark
          >{:else}{span.text}{/if}{/each}
    </p>
  {/each}
{/snippet}

<ScreenHeader
  title="Conflicts"
  meta={total > 0 ? 'Nothing was lost. Pick the version to keep.' : undefined}
  back={{ href: routeHash({ name: 'more', page: null }) }}
/>

{#if loaded && total === 0}
  <EmptyState
    title="No conflicts"
    line="Your devices agree. Nothing is waiting."
    action={{ label: 'Back to More', href: routeHash({ name: 'more', page: null }) }}
  />
{/if}

{#each conflicts as conflict (conflict.id)}
  <section class="conflict" aria-labelledby="c-{conflict.id}">
    <h2 id="c-{conflict.id}">{conflict.title}</h2>
    <p class="line">{conflict.line}</p>
    {#each conflict.sides as side (side.choice)}
      <div class="side card">
        <p class="who">
          <span class="caps">{side.device}</span>
          {#if side.when}<span class="meta">{whenLabel(side.when)}</span>{/if}
        </p>
        {@render lines(side.lines)}
        <Button
          full
          disabled={busy}
          aria-label="Keep the version from {side.device}"
          onclick={() => resolve(conflict.id, side)}>Keep this one</Button
        >
      </div>
    {/each}
  </section>
{/each}

{#each libraryConflicts as { view, conflict } (view.id)}
  <section class="conflict" aria-labelledby="c-{view.id}">
    <h2 id="c-{view.id}">{view.title}</h2>
    <p class="line">{view.line}</p>
    {#each view.sides as side (side.label)}
      <div class="side card">
        <p class="who"><span class="caps">{side.label}</span></p>
        {@render lines(side.lines)}
        {#if side.keepMine}
          <p class="meta note">Opens a proposal for the app's library on GitHub.</p>
        {/if}
        <Button
          full
          disabled={busy}
          aria-label={side.keepMine ? 'Keep your version' : "Keep the app's version"}
          onclick={() => resolveLibrary(conflict, side.keepMine)}>Keep this one</Button
        >
      </div>
    {/each}
  </section>
{/each}

<style>
  .conflict {
    margin-bottom: var(--space-6);
  }

  h2 {
    margin: var(--space-4) var(--gutter) var(--space-2);
    font: var(--fw-display) 1.125rem / var(--lh-snug) var(--font-display);
    letter-spacing: var(--ls-caps);
    text-transform: uppercase;
  }

  .line {
    margin: 0 var(--gutter) var(--space-3);
    color: var(--ink-2);
    font-size: var(--fs-lead);
  }

  .side {
    margin: 0 12px var(--space-2);
    padding: var(--space-3) var(--space-4) var(--space-4);
  }

  .who {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-2);
  }

  .who .caps {
    color: var(--ink-2);
  }

  .l {
    margin-bottom: var(--space-1);
    font-size: var(--fs-lead);
    overflow-wrap: anywhere;
  }

  /* What differs: a wash and a 2px rule, so it never rests on colour alone. */
  mark {
    padding: 0 2px;
    border-bottom: 2px solid var(--accent);
    background: var(--accent-wash);
    color: inherit;
  }

  .note {
    margin-top: var(--space-2);
  }

  .side :global(button) {
    margin-top: var(--space-3);
  }
</style>
