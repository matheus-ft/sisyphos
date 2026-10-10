<script lang="ts">
  import { untrack } from 'svelte';
  import musclesCsv from '../../library/muscles.csv?raw';
  import { parseMuscles } from '../../library/parse';
  import { muscleWeights } from '../../metrics/definitions';
  import { setsBehindMuscle, weeklyVolume, type VolumeWindow } from '../../metrics/weekly';
  import { app } from '../app.svelte';
  import {
    COUNTING_OPTIONS,
    formatCount,
    groupMuscleSets,
    LEGEND_LABELS,
    legendCaption,
    levelsOf,
    muscleRowText,
    openingWindow,
    topMuscles,
    volumeHeading,
    VOLUME_WINDOWS,
  } from '../athloi';
  import Button from '../kit/Button.svelte';
  import Chip from '../kit/Chip.svelte';
  import Segmented from '../kit/Segmented.svelte';
  import Sheet from '../kit/Sheet.svelte';
  import Statue from './Statue.svelte';

  /** The kouros, shaded by working sets, and the numbers behind the shading. */
  interface Props {
    today: string;
  }
  let { today }: Props = $props();

  const muscles = parseMuscles(musclesCsv);

  let period = $state<VolumeWindow>(
    untrack(() =>
      openingWindow(weeklyVolume(app.current, app.library, muscles, 'this_week', today)),
    ),
  );
  let selected = $state<string | null>(null);
  let table = $state(false);

  // The counting is a device preference; the active preset in definitions.json is only its default.
  const counting = $derived(app.prefs.muscleCounting);
  const weights = $derived(muscleWeights(counting));

  const volume = $derived(weeklyVolume(app.current, app.library, muscles, period, today, weights));
  const levels = $derived(levelsOf(volume));
  const top = $derived(topMuscles(volume));
  const worked = $derived(volume.find((v) => v.muscle.id === selected));
  const behind = $derived(
    selected
      ? groupMuscleSets(
          setsBehindMuscle(app.current, app.library, selected, period, today, weights),
          app.library,
        )
      : [],
  );
  const span = $derived(period === 'this_week' ? 'this week' : 'in the last 4 weeks');

  function openSession(id: string): void {
    const session = app.current.find((s) => s.id === id);
    if (session) app.openSession(session);
  }
</script>

<div class="chips" role="group" aria-label="Period">
  {#each VOLUME_WINDOWS as option (option.value)}
    <Chip pressed={period === option.value} onclick={() => (period = option.value)}>
      {option.label}
    </Chip>
  {/each}
</div>

<div class="counting">
  <Segmented
    options={COUNTING_OPTIONS}
    value={counting}
    label="Counting"
    onchange={(next) => app.setPrefs({ muscleCounting: next })}
  />
</div>

<div class="panel">
  <Statue {levels} {selected} onpick={(id) => (selected = id)}>
    <div class="legend">
      <ol class="ramp" aria-label="Shades, from untrained to most worked">
        {#each LEGEND_LABELS as text, i (text)}
          <li style:--shade="var(--vol-{i})"><span>{text}</span></li>
        {/each}
      </ol>
      <p class="caption">{legendCaption(period, counting)}</p>
    </div>
  </Statue>
</div>

<h2 class="sec caps">{volumeHeading(period)}</h2>
{#if top.length === 0}
  <p class="none meta">No working sets {span} yet.</p>
{:else}
  <ul class="bars">
    {#each top as bar (bar.id)}
      <li>
        <button
          aria-label="{bar.name}, {bar.text} sets {span}. Show the sets"
          onclick={() => (selected = bar.id)}
        >
          <span class="name">{bar.name}</span>
          <span class="track" aria-hidden="true"
            ><i style:width="{Math.max(4, bar.share * 100)}%"></i></span
          >
          <span class="figure-num count">{bar.text}</span>
        </button>
      </li>
    {/each}
  </ul>
{/if}

<div class="foot">
  <Button variant="link" aria-expanded={table} onclick={() => (table = !table)}
    >{table ? 'Hide the table' : 'All muscles as a table'}</Button
  >
</div>

{#if table}
  <div class="card tablecard">
    <table>
      <caption class="visually-hidden">Working sets {span}, by muscle, most worked first</caption>
      <thead>
        <tr>
          <th scope="col">Muscle</th>
          <th scope="col" class="num">Sets</th>
        </tr>
      </thead>
      <tbody>
        {#each volume as v (v.muscle.id)}
          <tr class:rested={v.sets === 0}>
            <th scope="row"
              ><button onclick={() => (selected = v.muscle.id)}>{v.muscle.name}</button></th
            >
            <td class="num figure-num">{formatCount(v.sets)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<Sheet
  open={selected !== null}
  onclose={() => (selected = null)}
  label="{worked?.muscle.name ?? 'Muscle'}, sets {span}"
>
  {#if worked}
    <h2 class="sheet-title">{worked.muscle.name}</h2>
    <p class="meta sheet-meta">
      <span class="figure-num">{formatCount(worked.sets)}</span>
      {worked.sets === 1 ? 'set' : 'sets'}
      {span}
    </p>
    {#if behind.length === 0}
      <p class="meta sheet-none">No working sets {span}.</p>
    {:else}
      <ul class="group sheet-list">
        {#each behind as row (row.key)}
          <li class="row-link">
            <button onclick={() => openSession(row.sessionId)}>
              <span class="grow">
                <span class="t">{row.exercise}</span>
                <span class="s">{row.when} · {muscleRowText(row)}</span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</Sheet>

<style>
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: var(--space-3) var(--gutter) var(--space-3);
  }

  .counting {
    margin: 0 var(--gutter) var(--space-3);
  }

  .panel {
    margin: 0 12px;
  }

  /* Inside the glaze panel, so the figures' clay colour (the Statue's text colour) carries. */
  .legend {
    display: grid;
    gap: var(--space-2);
    padding-inline: var(--space-2);
  }

  .ramp {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .ramp li {
    display: grid;
    gap: 5px;
    text-align: center;
  }

  .ramp li::before {
    content: '';
    height: 8px;
    background: var(--shade);
  }

  .ramp li:first-child::before {
    border-radius: 4px 0 0 4px;
  }

  .ramp li:last-child::before {
    border-radius: 0 4px 4px 0;
  }

  .ramp span {
    font-size: 0.75rem;
  }

  .caption {
    font: italic 0.8125rem / 1.3 var(--font-text);
    text-align: center;
    text-wrap: balance;
    opacity: 0.85;
  }

  .sec {
    margin-top: var(--space-5);
  }

  .none {
    margin: 0 var(--gutter);
  }

  .bars {
    margin: 0 var(--gutter);
    padding: 0;
    list-style: none;
  }

  .bars li + li {
    border-top: var(--hairline) solid var(--line);
  }

  .bars button {
    display: grid;
    grid-template-columns: minmax(0, 9.5rem) 1fr 3rem;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: var(--tap);
    text-align: left;
  }

  /* Wraps rather than cutting "Front and side delts" short: the name is the label. */
  .name {
    padding: var(--space-2) 0;
    line-height: var(--lh-tight);
  }

  .track {
    display: block;
    height: 6px;
  }

  .track i {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: var(--vol-3);
  }

  .count {
    font-size: 1.25rem;
    text-align: right;
  }

  .foot {
    display: flex;
    justify-content: flex-end;
    margin: var(--space-2) var(--gutter) 0;
  }

  .tablecard {
    margin: var(--space-2) 12px 0;
    padding: 0;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    padding: 0 var(--space-3);
    text-align: left;
  }

  thead th {
    padding-block: var(--space-2);
    font: var(--fw-strong) var(--fs-label) / 1 var(--font-display);
    letter-spacing: var(--ls-caps);
    text-transform: uppercase;
    color: var(--ink-2);
  }

  tbody tr {
    border-top: var(--hairline) solid var(--line);
  }

  tbody th {
    font-weight: var(--fw-text);
  }

  tbody th button {
    min-height: var(--tap);
    padding: 0;
    text-align: left;
  }

  .num {
    text-align: right;
    width: 4.5rem;
  }

  tr.rested {
    color: var(--muted);
  }

  .sheet-title {
    margin-top: var(--space-2);
  }

  .sheet-meta {
    margin: var(--space-1) 0 var(--space-3);
  }

  .sheet-none {
    margin-bottom: var(--space-3);
  }

  .sheet-list {
    margin: 0;
    box-shadow: none;
  }
</style>
