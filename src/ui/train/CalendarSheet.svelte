<script lang="ts">
  import type { IsoDate, Session } from '../../model';
  import { longDate } from '../format';
  import {
    canShiftMonth,
    inRange,
    monthGrid,
    monthOf,
    shiftMonth,
    WEEKDAY_INITIALS,
  } from '../history';
  import { dayAria } from '../history-view';
  import Icon from '../kit/Icon.svelte';
  import Sheet from '../kit/Sheet.svelte';

  /**
   * A month to pick a day from, in a sheet: the in-app stand-in for the
   * phone's date picker. Days outside `min` and `max` cannot be picked and the
   * arrows stop at the month holding the last one that can. Days with a
   * session carry a disc, days with a plan a dashed ring, today an accent
   * ring, as in History's calendar. Picking a day only reports it
   * (`onpick`); the owner closes the sheet.
   */
  interface Props {
    open: boolean;
    onclose: () => void;
    /** The sheet's accessible name ("Pick a day to plan"), also its title. */
    label: string;
    sessions: readonly Session[];
    today: IsoDate;
    min?: IsoDate;
    max?: IsoDate;
    onpick: (date: IsoDate) => void;
  }
  let { open, onclose, label, sessions, today, min, max, onpick }: Props = $props();

  // svelte-ignore state_referenced_locally
  let at = $state(monthOf(today));
  // Each time it opens, on the month of today.
  $effect(() => {
    if (open) at = monthOf(today);
  });

  const range = $derived({ min, max });
  const grid = $derived(monthGrid(at.year, at.month, sessions, { today }));
</script>

<Sheet {open} {onclose} {label}>
  <h2 class="title caps">{label}</h2>

  <header class="month">
    <button
      class="icon-btn"
      aria-label="Previous month"
      disabled={!canShiftMonth(at, -1, range)}
      onclick={() => (at = shiftMonth(at, -1))}
    >
      <Icon name="back" />
    </button>
    <h3 aria-live="polite">{grid.title}</h3>
    <button
      class="icon-btn"
      aria-label="Next month"
      disabled={!canShiftMonth(at, 1, range)}
      onclick={() => (at = shiftMonth(at, 1))}
    >
      <Icon name="chev" />
    </button>
  </header>

  <div class="wds caps" aria-hidden="true">
    {#each WEEKDAY_INITIALS as w, i (i)}<span>{w}</span>{/each}
  </div>

  <div class="days" role="group" aria-label={grid.title}>
    {#each grid.weeks.flat() as day (day.date)}
      <button
        class="cell"
        class:out={!day.inMonth}
        data-date={day.date}
        disabled={!inRange(day.date, range)}
        aria-label={dayAria(day, longDate(day.date))}
        aria-current={day.today ? 'date' : undefined}
        onclick={() => onpick(day.date)}
      >
        <span
          class="disc"
          class:session={day.sessions.length > 0}
          class:plan={day.sessions.length === 0 && day.planned.length > 0}
          class:today={day.today}
        >
          {day.day}
        </span>
      </button>
    {/each}
  </div>

  <footer class="legend meta">
    <span><i class="key session"></i>session</span>
    <span><i class="key plan"></i>planned</span>
  </footer>
</Sheet>

<style>
  .title {
    margin: 0 0 var(--space-2);
    font-size: var(--fs-label);
    color: var(--ink-2);
  }

  .month {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .month h3 {
    font-size: 1.0625rem;
  }

  /* Hidden, not removed, so the month's name stays centred at the edge of the range. */
  .month .icon-btn:disabled {
    visibility: hidden;
  }

  .wds,
  .days {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
  }

  .wds {
    margin-top: var(--space-1);
    text-align: center;
    font-size: 0.65625rem;
    color: var(--muted);
  }

  .cell {
    display: grid;
    place-items: center;
    min-height: var(--tap);
    padding: 0;
    color: var(--ink);
    font-size: var(--fs-body);
    font-weight: var(--fw-text);
  }

  /* line-strong at 60%: still legible as a date, quiet enough to say "not this month" or "not on offer". */
  .out,
  .cell:disabled {
    color: color-mix(in srgb, var(--line-strong) 60%, transparent);
  }

  .disc {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 50%;
  }

  .session {
    font-weight: var(--fw-num);
    background: var(--figure);
    color: var(--on-figure);
  }

  .out .session,
  .cell:disabled .session {
    opacity: 0.55;
  }

  .plan {
    border: 1.5px dashed var(--line-strong);
  }

  /* The gap in sheet colour keeps the ring clear of a disc it surrounds. */
  .today {
    box-shadow:
      0 0 0 2px var(--raised),
      0 0 0 3.5px var(--accent);
  }

  .legend {
    display: flex;
    justify-content: center;
    gap: var(--space-4);
    margin-top: var(--space-2);
    font-size: 0.875rem;
    color: var(--muted);
  }

  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .key {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .key.session {
    background: var(--figure);
  }

  .key.plan {
    border: 1.5px dashed var(--line-strong);
  }
</style>
