<script lang="ts">
  import { app } from '../app.svelte';
  import { formatMinutes, programLabel, sessionMinutes, dayOfMonth, weekdayShort } from '../format';
  import type { HistoryRow } from '../history';
  import { e1rmText, exerciseSummary, filteredLead } from '../history-view';
  import Laurel from '../kit/Laurel.svelte';

  /**
   * One session in the list: the day, its program label, what was done (or,
   * filtered, that exercise's best set), how long it took, and the marks that
   * need a second look: pending sets, a record.
   */
  interface Props {
    row: HistoryRow;
    names: ReadonlyMap<string, string>;
    /** The filter's exercise; the row then speaks only of it. */
    exerciseId: string | null;
    record: boolean;
  }
  let { row, names, exerciseId, record }: Props = $props();

  const session = $derived(row.session);
  const label = $derived(programLabel(session.label));
  const minutes = $derived(sessionMinutes(session));
  const live = $derived(session.started_at !== null && session.ended_at === null);
  const best = $derived(exerciseId ? row.best : null);
</script>

<li class="row-link">
  <button onclick={() => app.openSession(session)}>
    <span class="day" class:planned={row.planned}>
      <span class="num">{dayOfMonth(session.date)}</span>
      <span class="wd caps">{weekdayShort(session.date)}</span>
    </span>
    <span class="grow">
      {#if exerciseId}
        <span class="s">{filteredLead(row, exerciseId)}</span>
        {#if best}
          <span class="t best">{best.text}</span>
        {:else}
          <span class="t what">{label ?? 'No sets yet'}</span>
        {/if}
      {:else}
        {#if label}<span class="s">{label}</span>{/if}
        <span class="t what">{exerciseSummary(session, names)}</span>
      {/if}
    </span>
    <span class="r">
      {#if live}
        <span class="live">in progress</span>
      {:else if row.planned}
        <span class="plan">planned</span>
      {:else if best?.e1rm != null}
        <span class="e1rm">e1RM {e1rmText(best.e1rm)}</span>
      {:else if !exerciseId && minutes !== null}
        <span>{formatMinutes(minutes)}</span>
      {/if}
      {#if (row.pendingSets > 0 && !row.planned) || record}
        <span class="marks">
          {#if row.pendingSets > 0 && !row.planned}
            <span class="pending"><i></i>{row.pendingSets} pending</span>
          {/if}
          {#if record}<Laurel label="Set a record" />{/if}
        </span>
      {/if}
    </span>
  </button>
</li>

<style>
  /* Heavy on the figures: the day is what the eye scans down the list for. */
  .day {
    display: flex;
    flex: none;
    flex-direction: column;
    align-items: center;
    width: 44px;
  }

  .num {
    font: var(--fw-num) 1.5rem / 1 var(--font-num);
  }

  .wd {
    margin-top: 3px;
    font-size: 0.65625rem;
    color: var(--muted);
  }

  /* A plan has not happened yet: the calendar's dashed ring, here as a muted day. */
  .planned .num {
    color: var(--ink-2);
  }

  .what {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .best {
    font: var(--fw-num) var(--fs-row) / var(--lh-snug) var(--font-num);
  }

  .r {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    font-size: var(--fs-meta);
    color: var(--muted);
    white-space: nowrap;
  }

  .live {
    color: var(--accent);
    font-style: italic;
  }

  .plan {
    font-style: italic;
    color: var(--ink-2);
  }

  .e1rm {
    font-size: var(--fs-body);
    font-weight: var(--fw-num);
  }

  .marks {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .pending {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-style: italic;
    color: var(--ink-2);
  }

  .pending i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }
</style>
