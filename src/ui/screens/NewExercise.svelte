<script lang="ts">
  import { untrack } from 'svelte';
  import musclesCsv from '../../library/muscles.csv?raw';
  import { parseMuscles } from '../../library/parse';
  import type { CompetitionLift, Exercise, LoadType, LoadUnit, Tier } from '../../model';
  import Button from '../kit/Button.svelte';
  import ScreenHeader from '../kit/ScreenHeader.svelte';
  import { exerciseIdFrom, nameProblem } from '../session';

  /** A new exercise for the library, saved on this phone and proposed to the shared library. */
  interface Props {
    /** What was typed in the search, as a start for the name. */
    name: string;
    library: Exercise[];
    onsave: (exercise: Exercise) => void;
    onclose: () => void;
  }
  let { name: typed, library, onsave, onclose }: Props = $props();

  const muscles = parseMuscles(musclesCsv);
  const TIERS: [Tier, string][] = [
    ['comp', 'competition lift'],
    ['high_spec', 'close variation'],
    ['low_spec', 'distant variation'],
    ['acc', 'accessory'],
  ];

  // What was typed only starts the name; the form edits its own copy.
  let name = $state(untrack(() => typed));
  let baseLift = $state<CompetitionLift | ''>('');
  let tier = $state<Tier>('acc');
  let loadType = $state<LoadType>('external');
  let unit = $state<LoadUnit>('kg');
  let unilateral = $state(false);
  let primary = $state<string[]>([]);
  let aux = $state<string[]>([]);
  let problem = $state<string | null>(null);

  /** A muscle is primary, aux or neither; a tap moves it to the next. */
  function cycle(id: string): void {
    if (primary.includes(id)) {
      primary = primary.filter((m) => m !== id);
      aux = [...aux, id];
    } else if (aux.includes(id)) {
      aux = aux.filter((m) => m !== id);
    } else {
      primary = [...primary, id];
    }
  }

  function save(event: SubmitEvent): void {
    event.preventDefault();
    problem = nameProblem(name);
    const id = exerciseIdFrom(name);
    if (!problem && library.some((e) => e.id === id))
      problem = 'An exercise with that name exists.';
    if (!problem && primary.length === 0) problem = 'Pick at least one primary muscle.';
    if (problem) return;
    onsave({
      id,
      name: name.trim(),
      base_lift: baseLift || null,
      tier,
      unilateral,
      load_type: loadType,
      default_unit: unit,
      muscles: { primary, aux },
    });
  }
</script>

<ScreenHeader title="New exercise" back={{ onclick: onclose }} />

<div class="body">
  <p class="meta">
    Saved on this phone at once. Saving also opens a prefilled proposal on github.com to add it to
    the shared library, for you to submit if you like.
  </p>

  <form onsubmit={save}>
    <div class="field">
      <label for="new-name">Name</label>
      <input id="new-name" bind:value={name} autocomplete="off" />
    </div>
    <div class="field">
      <label for="new-lift">Serves</label>
      <select id="new-lift" bind:value={baseLift}>
        <option value="">no competition lift</option>
        <option value="squat">squat</option>
        <option value="bench">bench</option>
        <option value="deadlift">deadlift</option>
      </select>
    </div>
    <div class="field">
      <label for="new-tier">As a</label>
      <select id="new-tier" bind:value={tier}>
        {#each TIERS as [value, label] (value)}<option {value}>{label}</option>{/each}
      </select>
    </div>
    <div class="field">
      <label for="new-load">Loaded by</label>
      <select id="new-load" bind:value={loadType}>
        <option value="external">a weight</option>
        <option value="bw_plus">bodyweight plus a weight</option>
        <option value="none">nothing: timed</option>
      </select>
    </div>
    <div class="field">
      <label for="new-unit">Usually in</label>
      <select id="new-unit" bind:value={unit}>
        <option value="kg">kg</option>
        <option value="lb">lb</option>
        <option value="pins">pins</option>
      </select>
    </div>
    <label class="check"
      ><input type="checkbox" bind:checked={unilateral} /> One side at a time</label
    >

    <p class="meta">Muscles: tap once for primary, twice for aux, again to clear.</p>
    <div class="muscles">
      {#each muscles as muscle (muscle.id)}
        <button
          type="button"
          class="chip"
          class:aux={aux.includes(muscle.id)}
          aria-pressed={primary.includes(muscle.id)}
          onclick={() => cycle(muscle.id)}
          >{muscle.name}{#if aux.includes(muscle.id)}<span class="tag">aux</span>{/if}</button
        >
      {/each}
    </div>

    {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
    <Button type="submit" variant="primary" bench full>Save</Button>
  </form>
</div>

<style>
  .body {
    padding: 0 var(--gutter);
  }

  form {
    display: grid;
    gap: var(--space-4);
    margin-top: var(--space-4);
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--tap);
  }

  .check input {
    min-height: 0;
    width: 20px;
    height: 20px;
    accent-color: var(--figure);
  }

  .muscles {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  /* Aux is outlined in the figure colour: chosen, but less than primary. */
  .aux {
    border: var(--stroke-strong) solid var(--figure);
  }

  .tag {
    font: italic 0.8125rem / 1 var(--font-text);
    color: var(--ink-2);
  }
</style>
