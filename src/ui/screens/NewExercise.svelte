<script lang="ts">
  import { untrack } from 'svelte';
  import musclesCsv from '../../library/muscles.csv?raw';
  import { parseMuscles } from '../../library/parse';
  import type { CompetitionLift, Exercise, LoadType, LoadUnit, Tier } from '../../model';
  import Button from '../kit/Button.svelte';
  import Segmented from '../kit/Segmented.svelte';
  import ScreenHeader from '../kit/ScreenHeader.svelte';
  import { exerciseIdFrom, nameProblem } from '../session';

  /**
   * An exercise for the library, saved on this phone and proposed to the shared
   * library. Either a new one, named from what was typed in a search, or, with
   * `exercise`, one of the library's own being changed: its id stays, so every
   * session that used it keeps pointing at it, and there is no duplicate to check.
   */
  interface Props {
    /** What was typed in the search, as a start for the name of a new exercise. */
    name?: string;
    /** The exercise being changed; the form starts from it. */
    exercise?: Exercise;
    library: Exercise[];
    onsave: (exercise: Exercise) => void;
    onclose: () => void;
  }
  let { name: typed = '', exercise, library, onsave, onclose }: Props = $props();

  const muscles = parseMuscles(musclesCsv);
  const TIERS: [Tier, string][] = [
    ['comp', 'competition lift'],
    ['high_spec', 'close variation'],
    ['low_spec', 'distant variation'],
    ['acc', 'accessory'],
  ];
  const LIFTS: { value: CompetitionLift | 'none'; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'squat', label: 'Squat' },
    { value: 'bench', label: 'Bench' },
    { value: 'deadlift', label: 'Deadlift' },
  ];
  const UNITS: { value: LoadUnit; label: string }[] = [
    { value: 'kg', label: 'kg' },
    { value: 'lb', label: 'lb' },
    { value: 'pins', label: 'pins' },
  ];

  // The props only start the form; it edits its own copy.
  const start = untrack(() => exercise);
  let name = $state(untrack(() => start?.name ?? typed));
  let baseLift = $state<CompetitionLift | 'none'>(start?.base_lift ?? 'none');
  let tier = $state<Tier>(start?.tier ?? 'acc');
  let loadType = $state<LoadType>(start?.load_type ?? 'external');
  let unit = $state<LoadUnit>(start?.default_unit ?? 'kg');
  let unilateral = $state(start?.unilateral ?? false);
  let primary = $state<string[]>([...(start?.muscles.primary ?? [])]);
  let aux = $state<string[]>([...(start?.muscles.aux ?? [])]);
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
    // A change keeps its id, so only a new exercise can collide with one.
    const id = start?.id ?? exerciseIdFrom(name);
    if (!problem && !start && library.some((e) => e.id === id))
      problem = 'An exercise with that name exists.';
    if (!problem && primary.length === 0) problem = 'Pick at least one primary muscle.';
    if (problem) return;
    onsave({
      id,
      name: name.trim(),
      base_lift: baseLift === 'none' ? null : baseLift,
      tier,
      unilateral,
      load_type: loadType,
      default_unit: unit,
      muscles: { primary, aux },
    });
  }
</script>

<ScreenHeader title={start ? 'Change exercise' : 'New exercise'} back={{ onclick: onclose }} />

<div class="body">
  <p class="meta">
    {#if start}
      Saved on this phone at once. If it now differs from the shared library, a prefilled proposal
      opens on github.com for you to submit if you like.
    {:else}
      Saved on this phone at once. Saving also opens a prefilled proposal on github.com to add it to
      the shared library, for you to submit if you like.
    {/if}
  </p>

  <form onsubmit={save}>
    <div class="field">
      <label for="new-name">Name</label>
      <input id="new-name" bind:value={name} autocomplete="off" />
    </div>
    <div class="field">
      <span class="label" id="new-lift-l">Serves</span>
      <Segmented
        full
        label="Competition lift it serves"
        options={LIFTS}
        value={baseLift}
        onchange={(value) => (baseLift = value)}
      />
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
      <span class="label">Usually in</span>
      <Segmented
        full
        label="Usual unit"
        options={UNITS}
        value={unit}
        onchange={(value) => (unit = value)}
      />
    </div>
    <label class="check"
      ><input type="checkbox" bind:checked={unilateral} /> One side at a time</label
    >

    <div class="field">
      <span class="label">Muscles</span>
      <p class="meta">Tap once for primary, twice for aux, again to clear.</p>
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
    </div>

    {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
    <Button type="submit" variant="primary" bench full
      >{start ? 'Save change' : 'Save exercise'}</Button
    >
  </form>
</div>

<style>
  .body {
    padding: 0 var(--gutter) var(--space-6);
  }

  form {
    display: grid;
    gap: var(--space-4);
    margin-top: var(--space-5);
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
