<script lang="ts">
  import { recordEvents } from '../../metrics/records';
  import { app } from '../app.svelte';
  import { bodyweightAtFrom } from '../athloi';
  import { historyWeeks } from '../history';
  import { exercisesInLog, recordMarks, weekSummary } from '../history-view';
  import CalendarView from '../history/CalendarView.svelte';
  import ExercisePicker from '../history/ExercisePicker.svelte';
  import SessionRow from '../history/SessionRow.svelte';
  import Chip from '../kit/Chip.svelte';
  import EmptyState from '../kit/EmptyState.svelte';
  import ScreenHeader from '../kit/ScreenHeader.svelte';
  import Segmented from '../kit/Segmented.svelte';
  import { localDate } from '../session';

  /**
   * Historia, the History tab: every session by week, newest first, or by
   * month on a calendar, optionally of one exercise. The view and the filter
   * are remembered for the visit (sessionStorage), so a tab switch or a
   * session opened from here comes back to where the lifter was.
   */

  type View = 'list' | 'calendar';
  const VIEWS = [
    { value: 'list', label: 'List' },
    { value: 'calendar', label: 'Calendar' },
  ] as const;
  const VIEW_KEY = 'sisyphos.history.view';
  const FILTER_KEY = 'sisyphos.history.filter';

  function recall(key: string): string | null {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function remember(key: string, value: string | null): void {
    try {
      if (value === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, value);
    } catch {
      // Without storage the choice simply lasts until the tab changes.
    }
  }

  let view = $state<View>(recall(VIEW_KEY) === 'calendar' ? 'calendar' : 'list');
  let filter = $state<string | null>(recall(FILTER_KEY));
  let picking = $state(false);

  const today = localDate(new Date());
  const names = $derived(new Map(app.library.map((e) => [e.id, e.name])));
  const inLog = $derived(exercisesInLog(app.current, app.library));
  // An exercise gone from the log (a deleted session) cannot stay as a filter nobody can clear.
  const selected = $derived(inLog.find((e) => e.id === filter) ?? null);
  const exerciseId = $derived(selected?.id ?? null);

  const weeks = $derived(
    historyWeeks(app.current, app.library, {
      exerciseId: exerciseId ?? undefined,
      bodyweightAt: bodyweightAtFrom(app.bodyweights),
    }),
  );
  const shown = $derived(
    exerciseId
      ? app.current.filter((s) => s.exercises.some((e) => e.exercise_id === exerciseId))
      : app.current,
  );
  const marks = $derived(
    recordMarks(recordEvents(app.current, app.library, app.manualRecords), exerciseId ?? undefined),
  );

  /**
   * Marks a sticky header as stuck once its top edge is clipped, so it takes a
   * background only while content scrolls beneath it. The body's gradient makes
   * any resting background show as a band.
   */
  function stuck(node: HTMLElement) {
    const watcher = new IntersectionObserver(
      ([entry]) => node.classList.toggle('stuck', entry.intersectionRatio < 1),
      { threshold: [1] },
    );
    watcher.observe(node);
    return { destroy: () => watcher.disconnect() };
  }

  function setView(next: View): void {
    view = next;
    remember(VIEW_KEY, next);
  }

  function setFilter(next: string | null): void {
    filter = next;
    picking = false;
    remember(FILTER_KEY, next);
  }
</script>

<ScreenHeader title="History">
  {#snippet actions()}
    <Segmented options={VIEWS} value={view} onchange={setView} label="View" />
  {/snippet}
</ScreenHeader>

{#if app.current.length === 0}
  <EmptyState
    title="No sessions yet"
    line="Sessions you log appear here, by week."
    action={{ label: 'Start a session', onclick: () => void app.create(null) }}
  />
{:else}
  <div class="filter">
    <Chip
      chevron
      pressed={selected !== null}
      label={selected?.name}
      onclick={() => (picking = true)}
      onclear={() => setFilter(null)}
    >
      {selected?.name ?? 'All exercises'}
    </Chip>
  </div>

  {#if view === 'calendar'}
    <CalendarView sessions={shown} {today} recordDays={marks.days} />
  {:else if weeks.length === 0}
    <EmptyState
      title="No sessions with it"
      line="Clear the filter to see every session."
      action={{ label: 'Clear filter', onclick: () => setFilter(null) }}
    />
  {:else}
    {#each weeks as week (week.start)}
      <section class="week">
        <h2 class="sec" use:stuck>
          <span class="caps">{week.label}</span>
          <span class="meta">{weekSummary(week, exerciseId !== null)}</span>
        </h2>
        <ul class="group">
          {#each week.rows as row (row.session.id)}
            <SessionRow {row} {names} {exerciseId} record={marks.sessions.has(row.session.id)} />
          {/each}
        </ul>
      </section>
    {/each}
  {/if}
{/if}

<ExercisePicker
  open={picking}
  exercises={inLog}
  selected={exerciseId}
  onpick={setFilter}
  onclose={() => (picking = false)}
/>

<style>
  .filter {
    padding: var(--space-2) var(--gutter) 0;
  }

  .week {
    margin-top: var(--space-2);
  }

  /* Sticks under the notch while its week scrolls past, then the next week takes over.
     top: -1px lets `stuck` see the clipped edge. */
  .week .sec {
    position: sticky;
    top: -1px;
    z-index: var(--z-sticky);
    margin: calc(-1 * var(--safe-top)) 0 var(--space-1);
    padding: calc(var(--safe-top) + var(--space-3)) var(--gutter) var(--space-2);
    font: var(--fw-text) var(--fs-body) / var(--lh-body) var(--font-text);
    letter-spacing: normal;
    text-transform: none;
  }

  .week .sec:global(.stuck) {
    background: color-mix(in srgb, var(--ground) 92%, transparent);
    backdrop-filter: blur(8px);
    box-shadow: 0 1px 0 var(--line);
  }
</style>
