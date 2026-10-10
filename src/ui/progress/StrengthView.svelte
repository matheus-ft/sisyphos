<script lang="ts">
  import { e1rmSeries, e1rmSets, rangeStart, type StrengthRange } from '../../metrics/e1rm';
  import { app } from '../app.svelte';
  import {
    bodyweightAtFrom,
    dayText,
    headlineOf,
    pointText,
    resolveTab,
    sparseNote,
    strengthDays,
    strengthTabs,
    STRENGTH_RANGES,
  } from '../athloi';
  import Button from '../kit/Button.svelte';
  import EmptyState from '../kit/EmptyState.svelte';
  import Laurel from '../kit/Laurel.svelte';
  import LiftTabs from '../kit/LiftTabs.svelte';
  import Segmented from '../kit/Segmented.svelte';
  import HillChart from './HillChart.svelte';

  /**
   * One of the four record-keeping lifts' best e1RM over time, drawn as the
   * hill the boulder climbs, with every working set's own figure over it.
   */
  interface Props {
    today: string;
    /** The exercise last picked on Progress, kept across views; null for the default. */
    picked: string | null;
    onpick: (id: string) => void;
  }
  let { today, picked, onpick }: Props = $props();

  let range = $state<StrengthRange>('6M');
  let table = $state(false);

  const bodyweightAt = $derived(bodyweightAtFrom(app.bodyweights));
  const tabs = $derived(strengthTabs(app.current, app.library, bodyweightAt));
  const lift = $derived(resolveTab(tabs, picked));
  const history = $derived(lift ? e1rmSeries(app.current, lift.exercise, { bodyweightAt }) : []);
  const from = $derived(rangeStart(range, today));
  // Judged over the whole history, so narrowing the range never turns its first day into a record.
  const points = $derived(from ? history.filter((p) => p.date >= from) : history);
  const sets = $derived(lift ? e1rmSets(app.current, lift.exercise, { bodyweightAt, from }) : []);
  const headline = $derived(headlineOf(points, today));
  const note = $derived(sparseNote(points.length, history.length, range));
  const texts = $derived(
    lift ? sets.map((p) => pointText(p, app.current, lift.exercise, today)) : [],
  );
  const days = $derived(strengthDays(points, sets));
  const dayTexts = $derived(
    lift ? days.map((d) => dayText(d, sets, app.current, lift.exercise, today)) : [],
  );
  const summary = $derived(
    lift && headline
      ? `${lift.exercise.name}, e1RM ${headline.value} kilograms${headline.change ? `, ${headline.change}` : ''}. ${points.length} ${points.length === 1 ? 'day' : 'days'}, ${sets.length} ${sets.length === 1 ? 'set' : 'sets'}. Arrow keys move along the days.`
      : '',
  );
</script>

{#if !lift}
  <EmptyState title="Not enough sessions yet" line="The hill needs a few sessions to draw." />
{:else}
  <LiftTabs
    tabs={tabs.map((t) => ({ id: t.exercise.id, label: t.label, name: t.exercise.name }))}
    value={lift.exercise.id}
    onchange={onpick}
    label="Lift"
  >
    {#if history.length === 0}
      <EmptyState title="Not enough sessions yet" line="The hill needs a few sessions to draw." />
    {:else}
      <div class="controls">
        <Segmented
          options={STRENGTH_RANGES}
          value={range}
          label="Range"
          onchange={(next) => (range = next)}
        />
      </div>

      {#if headline}
        <p class="headline">
          <span class="figure-num stat">{headline.value}</span>
          <span class="unit">kg e1RM</span>
          {#if headline.change}<span class="meta">{headline.change}</span>{/if}
        </p>
      {/if}

      {#if points.length > 0}
        <div class="card chart-card">
          <HillChart {points} {sets} {days} texts={dayTexts} label={summary} to={today} />
        </div>
      {/if}

      {#if note}
        <p class="note meta">
          {note.text}
          {#if note.widen}
            <Button variant="link" onclick={() => (range = 'all')}>Show all</Button>
          {/if}
        </p>
      {/if}

      {#if points.length > 0}
        <div class="foot">
          <Button variant="link" aria-expanded={table} onclick={() => (table = !table)}
            >{table ? 'Hide table' : 'Show as table'}</Button
          >
        </div>
        {#if table}
          <div class="card tablecard">
            <table>
              <caption class="visually-hidden">
                {lift.exercise.name}, newest day first: the day's best e1RM and the set it came
                from, then every working set
              </caption>
              <thead>
                <tr
                  ><th scope="col">Day</th><th scope="col">e1RM</th><th scope="col">Set</th><th
                    scope="col">Kind</th
                  ></tr
                >
              </thead>
              {#each [...days].reverse() as d, i (d.date)}
                {@const day = dayTexts[days.length - 1 - i]}
                <tbody>
                  <tr class="day" class:record={d.best.record}>
                    <th scope="row">{day.date}</th>
                    <td
                      >{day.best.replace('e1RM ', '')}{#if d.best.record}<span class="laurel"
                          ><Laurel size={14} label="record" /></span
                        >{/if}</td
                    >
                    <td>{day.from ?? ''}</td>
                    <td>{day.single ?? 'Best'}</td>
                  </tr>
                  {#each [...d.sets].reverse() as si (sets[si].set_id)}
                    {@const text = texts[si]}
                    <tr class="set">
                      <th scope="row"><span class="visually-hidden">{day.date}, </span>Set</th>
                      <td>{text.value}</td>
                      <td>{text.set ?? ''}</td>
                      <td>{text.kind}</td>
                    </tr>
                  {/each}
                </tbody>
              {/each}
            </table>
          </div>
        {/if}
      {/if}
    {/if}
  </LiftTabs>
{/if}

<style>
  .controls {
    margin: var(--space-3) var(--gutter) 0;
  }

  .headline {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: var(--space-4) var(--gutter) var(--space-2);
  }

  .stat {
    font-size: var(--fs-stat);
  }

  /* Garamond, not the caps face: Cinzel capitals set the 1 of e1RM as an I. */
  .unit {
    color: var(--ink-2);
    font-size: var(--fs-body);
  }

  .chart-card {
    margin: 0 12px;
    padding: var(--space-3) var(--space-2) var(--space-2);
  }

  .note {
    margin: var(--space-3) var(--gutter) 0;
  }

  .foot {
    display: flex;
    justify-content: flex-end;
    margin: var(--space-1) var(--gutter) 0;
  }

  .tablecard {
    margin: var(--space-2) 12px 0;
    padding: 0;
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-meta);
  }

  th,
  td {
    padding: var(--space-2) var(--space-3);
    text-align: left;
    white-space: nowrap;
  }

  thead th {
    font: var(--fw-strong) var(--fs-label) / 1 var(--font-display);
    letter-spacing: var(--ls-caps);
    text-transform: uppercase;
    color: var(--ink-2);
  }

  tbody th {
    font-weight: var(--fw-text);
  }

  tbody tr.day {
    border-top: var(--hairline) solid var(--line);
  }

  tr.set {
    color: var(--ink-2);
  }

  tr.set th {
    padding-left: var(--space-5);
  }

  tr.record {
    background: var(--laurel-wash);
  }

  .laurel {
    margin-left: var(--space-2);
    vertical-align: -2px;
  }
</style>
