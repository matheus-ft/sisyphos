<script lang="ts">
  import { e1rmSeries, rangeStart, type StrengthRange } from '../../metrics/e1rm';
  import { app } from '../app.svelte';
  import {
    bodyweightAtFrom,
    dateInYear,
    headlineOf,
    liftChoices,
    pointText,
    resolvePick,
    shortDay,
    sparseNote,
    STRENGTH_RANGES,
  } from '../athloi';
  import Button from '../kit/Button.svelte';
  import Chip from '../kit/Chip.svelte';
  import EmptyState from '../kit/EmptyState.svelte';
  import Laurel from '../kit/Laurel.svelte';
  import Segmented from '../kit/Segmented.svelte';
  import ExercisePicker from './ExercisePicker.svelte';
  import HillChart from './HillChart.svelte';

  /** Each lift's best e1RM over time, drawn as the hill the boulder climbs. */
  interface Props {
    today: string;
    /** The exercise last picked on Progress, kept across views; null for the default. */
    picked: string | null;
    onpick: (id: string) => void;
  }
  let { today, picked, onpick }: Props = $props();

  let range = $state<StrengthRange>('6M');
  let choosing = $state(false);
  let table = $state(false);

  const bodyweightAt = $derived(bodyweightAtFrom(app.bodyweights));
  const choices = $derived(liftChoices(app.current, app.library, bodyweightAt));
  const lift = $derived(resolvePick(choices, picked));
  const history = $derived(lift ? e1rmSeries(app.current, lift.exercise, { bodyweightAt }) : []);
  const from = $derived(rangeStart(range, today));
  // Judged over the whole history, so narrowing the range never turns its first day into a record.
  const points = $derived(from ? history.filter((p) => p.date >= from) : history);
  const headline = $derived(headlineOf(points, today));
  const note = $derived(sparseNote(points.length, history.length, range));
  const texts = $derived(
    lift ? points.map((p) => pointText(p, app.current, lift.exercise, today)) : [],
  );
  const summary = $derived(
    lift && headline
      ? `${lift.exercise.name}, e1RM ${headline.value} kilograms${headline.change ? `, ${headline.change}` : ''}. ${points.length} ${points.length === 1 ? 'day' : 'days'}. Arrow keys move along the hill.`
      : '',
  );
</script>

{#if !lift}
  <EmptyState title="Not enough sessions yet" line="The hill needs a few sessions to draw." />
{:else}
  <div class="controls">
    <Chip chevron onclick={() => (choosing = true)}>{lift.exercise.name}</Chip>
  </div>
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
      <HillChart {points} {texts} label={summary} to={today} />
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
            {lift.exercise.name}, best e1RM on each day it was trained, newest first
          </caption>
          <thead>
            <tr
              ><th scope="col">Date</th><th scope="col">Estimated max</th><th scope="col"
                >Best set</th
              ></tr
            >
          </thead>
          <tbody>
            {#each [...points].reverse() as p, i (p.date)}
              {@const text = texts[points.length - 1 - i]}
              <tr class:record={p.record}>
                <th scope="row">{dateInYear(p.date, today)}</th>
                <td
                  >{text.value}{#if p.record}<span class="laurel"
                      ><Laurel size={14} label="record" /></span
                    >{/if}</td
                >
                <td>{text.set ?? ''}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}

  <ExercisePicker
    open={choosing}
    onclose={() => (choosing = false)}
    value={lift.exercise.id}
    {onpick}
    items={choices.map((c) => ({
      id: c.exercise.id,
      name: c.exercise.name,
      meta: `${c.days} ${c.days === 1 ? 'day' : 'days'} · last ${shortDay(c.last)}`,
    }))}
  />
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

  tbody tr {
    border-top: var(--hairline) solid var(--line);
  }

  tr.record {
    background: var(--laurel-wash);
  }

  .laurel {
    margin-left: var(--space-2);
    vertical-align: -2px;
  }
</style>
