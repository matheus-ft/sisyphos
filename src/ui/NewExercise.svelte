<script lang="ts">
  import { untrack } from 'svelte';
  import musclesCsv from '../library/muscles.csv?raw';
  import { parseMuscles } from '../library/parse';
  import type { CompetitionLift, Exercise, LoadType, LoadUnit, Tier } from '../model';
  import { exerciseIdFrom, nameProblem } from './session';

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

<article>
  <button class="link" onclick={onclose}>‹ back</button>
  <h1>New exercise</h1>
  <p class="muted">
    Saved on this phone at once. Saving also opens a prefilled proposal on github.com to add it to
    the shared library, for you to submit if you like.
  </p>

  <form onsubmit={save}>
    <label>name <input bind:value={name} autocomplete="off" /></label>
    <label>
      serves
      <select bind:value={baseLift}>
        <option value="">no competition lift</option>
        <option value="squat">squat</option>
        <option value="bench">bench</option>
        <option value="deadlift">deadlift</option>
      </select>
    </label>
    <label>
      as a
      <select bind:value={tier}>
        {#each TIERS as [value, label] (value)}<option {value}>{label}</option>{/each}
      </select>
    </label>
    <label>
      loaded by
      <select bind:value={loadType}>
        <option value="external">a weight</option>
        <option value="bw_plus">bodyweight plus a weight</option>
        <option value="none">nothing: timed</option>
      </select>
    </label>
    <label>
      usually in
      <select bind:value={unit}>
        <option value="kg">kg</option>
        <option value="lb">lb</option>
        <option value="pins">pins</option>
      </select>
    </label>
    <label class="check"
      ><input type="checkbox" bind:checked={unilateral} /> one side at a time</label
    >

    <p class="muted">Muscles: tap once for primary, twice for aux, again to clear.</p>
    <div class="muscles">
      {#each muscles as muscle (muscle.id)}
        <button
          type="button"
          class:primary={primary.includes(muscle.id)}
          class:aux={aux.includes(muscle.id)}
          onclick={() => cycle(muscle.id)}>{muscle.name}</button
        >
      {/each}
    </div>

    {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
    <button type="submit" class="save">Save</button>
  </form>
</article>

<style>
  h1 {
    font-size: 1.4rem;
  }

  .muted {
    color: var(--muted);
    font-size: 0.9rem;
  }

  form {
    display: grid;
    gap: 0.25rem;
  }

  label {
    display: grid;
    grid-template-columns: 6rem 1fr;
    align-items: center;
    color: var(--muted);
  }

  label input,
  select {
    color: var(--ink);
  }

  select {
    min-height: 2.75rem;
    border: 0;
    border-bottom: 1px solid var(--line);
    background: none;
    font: inherit;
    font-size: 1rem;
  }

  .check {
    display: flex;
    gap: 0.5rem;
    color: var(--ink);
  }

  .check input {
    min-height: 0;
  }

  .muscles {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .muscles button {
    min-height: 2.5rem;
    padding: 0 0.75rem;
    border: 1px solid var(--line);
    border-radius: 1.25rem;
    font-size: 0.9rem;
  }

  .muscles .primary {
    border-color: var(--ink);
    background: var(--ink);
    color: var(--ground);
  }

  .muscles .aux {
    border-color: var(--ink);
  }

  .problem {
    color: var(--accent);
  }

  .save {
    margin-top: 1rem;
    border: 1px solid var(--ink);
    border-radius: 0.5rem;
    font-weight: 600;
  }
</style>
