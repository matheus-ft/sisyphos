<script lang="ts">
  import type { IsoDate, Session } from '../../model';
  import { app } from '../app.svelte';
  import { formatMinutes, longDate, programLabel, sessionMinutes } from '../format';
  import { monthGrid, shiftMonth } from '../history';
  import { dayAria, dayTap, exerciseSummary } from '../history-view';
  import Icon from '../kit/Icon.svelte';
  import Sheet from '../kit/Sheet.svelte';

  /**
   * The month calendar: a figure disc per day with a session, a dashed ring
   * for one planned, a gilded dot for a record, an accent ring for today.
   */
  interface Props {
    sessions: readonly Session[];
    today: IsoDate;
    recordDays: ReadonlySet<IsoDate>;
  }
  let { sessions, today, recordDays }: Props = $props();

  const here = $derived({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) });
  // svelte-ignore state_referenced_locally
  let at = $state({ ...here });
  let chosen = $state<{ title: string; ids: string[] } | null>(null);

  const grid = $derived(monthGrid(at.year, at.month, sessions, { today, recordDays }));
  const names = $derived(new Map(app.library.map((e) => [e.id, e.name])));
  const onToday = $derived(at.year === here.year && at.month === here.month);
  const picked = $derived(
    chosen ? chosen.ids.flatMap((id) => sessions.find((s) => s.id === id) ?? []) : [],
  );

  function tap(day: (typeof grid.weeks)[number][number]): void {
    const result = dayTap(day);
    if (result.kind === 'open') {
      const session = sessions.find((s) => s.id === result.id);
      if (session) app.openSession(session);
    } else if (result.kind === 'choose') {
      chosen = { title: longDate(day.date), ids: result.ids };
    }
  }
</script>

<section class="cal card" aria-label="Calendar">
  <header class="month">
    <button class="icon-btn" aria-label="Previous month" onclick={() => (at = shiftMonth(at, -1))}>
      <Icon name="back" />
    </button>
    <h2 aria-live="polite">{grid.title}</h2>
    <button class="icon-btn" aria-label="Next month" onclick={() => (at = shiftMonth(at, 1))}>
      <Icon name="chev" />
    </button>
  </header>

  <div class="wds caps" aria-hidden="true">
    {#each ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as w, i (i)}<span>{w}</span>{/each}
  </div>

  <div class="days" role="group" aria-label={grid.title}>
    {#each grid.weeks.flat() as day (day.date)}
      {@const any = day.sessions.length > 0 || day.planned.length > 0}
      <button
        class="cell"
        class:out={!day.inMonth}
        disabled={!any}
        aria-label={dayAria(day, longDate(day.date))}
        aria-current={day.today ? 'date' : undefined}
        onclick={() => tap(day)}
      >
        <span
          class="disc"
          class:session={day.sessions.length > 0}
          class:plan={day.sessions.length === 0 && day.planned.length > 0}
          class:today={day.today}
        >
          {day.day}
        </span>
        {#if day.record}<i class="dot"></i>{/if}
      </button>
    {/each}
  </div>

  <footer class="legend meta">
    <span><i class="key session"></i>session</span>
    <span><i class="key plan"></i>planned</span>
    <span><i class="key rec"></i>record</span>
    {#if !onToday}
      <button class="back-today" onclick={() => (at = { ...here })}>Today</button>
    {/if}
  </footer>
</section>

<Sheet
  open={chosen !== null}
  onclose={() => (chosen = null)}
  label={`Sessions on ${chosen?.title ?? ''}`}
>
  <h2 class="pick-title caps">{chosen?.title}</h2>
  <ul class="group pick" role="list">
    {#each picked as session (session.id)}
      {@const label = programLabel(session.label)}
      {@const minutes = sessionMinutes(session)}
      <li class="row-link">
        <button
          onclick={() => {
            chosen = null;
            app.openSession(session);
          }}
        >
          <span class="grow">
            {#if label}<span class="s">{label}</span>{/if}
            <span class="t what">{exerciseSummary(session, names)}</span>
          </span>
          <span class="v">
            {session.started_at === null
              ? 'planned'
              : session.ended_at === null
                ? 'in progress'
                : minutes !== null
                  ? formatMinutes(minutes)
                  : ''}
          </span>
        </button>
      </li>
    {/each}
  </ul>
</Sheet>

<style>
  .cal {
    margin: var(--space-3) 12px 0;
    padding: var(--space-2) var(--space-2) var(--space-3);
  }

  .month {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .month h2 {
    font-size: 1.0625rem;
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
    position: relative;
    display: grid;
    place-items: center;
    min-height: var(--tap);
    padding: 0;
    color: var(--ink);
    font-size: var(--fs-body);
  }

  .cell:disabled {
    color: var(--ink);
  }

  /* line-strong at 60%: still legible as a date, quiet enough to say "not this month". */
  .out {
    color: color-mix(in srgb, var(--line-strong) 60%, transparent);
  }

  .out:disabled {
    color: color-mix(in srgb, var(--line-strong) 60%, transparent);
  }

  .disc {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    font-weight: var(--fw-num);
  }

  .session {
    background: var(--figure);
    color: var(--on-figure);
  }

  .out .session {
    opacity: 0.55;
  }

  .plan {
    border: 1.5px dashed var(--line-strong);
  }

  /* The gap in surface colour keeps the ring clear of a disc it surrounds. */
  .today {
    box-shadow:
      0 0 0 2px var(--surface),
      0 0 0 3.5px var(--accent);
  }

  .dot {
    position: absolute;
    bottom: 1px;
    left: 50%;
    width: 6px;
    height: 6px;
    margin-left: -3px;
    border-radius: 50%;
    background: var(--laurel-fill);
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
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

  .key.rec {
    width: 6px;
    height: 6px;
    background: var(--laurel-fill);
  }

  .back-today {
    min-height: var(--tap);
    padding: 0 var(--space-2);
    color: var(--accent);
    font-style: italic;
  }

  .pick-title {
    margin: 0 0 var(--space-2);
    font-size: var(--fs-label);
    color: var(--ink-2);
  }

  .pick {
    margin: 0;
  }

  .what {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
