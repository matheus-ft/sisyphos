<script lang="ts">
  import {
    isComplete,
    type Exercise,
    type ExerciseInstance,
    type LoadUnit,
    type PerformedSet,
    type Session,
  } from '../model';
  import {
    addSet,
    amountOf,
    editSet,
    formatSeconds,
    measureOf,
    needsBodyweight,
    parseNumber,
    parseRpe,
    parseSeconds,
    removeExercise,
    removeSet,
    setDone,
    targetOf,
    unitOf,
    type SetEdit,
  } from './session';

  interface Props {
    session: Session;
    instance: ExerciseInstance;
    /** Missing when the log names an exercise this library does not have. */
    exercise: Exercise | undefined;
    /** The sets of the last other session with this exercise. */
    last: string | null;
    /** The unit a new set starts in. */
    unit: LoadUnit;
    onchange: (next: Session) => void;
  }
  let { session, instance, exercise, last, unit, onchange }: Props = $props();

  const measure = $derived(exercise ? measureOf(exercise) : 'weight');
  const blocked = $derived(exercise ? needsBodyweight(session, exercise) : false);
  const UNITS: LoadUnit[] = ['kg', 'lb', 'pins'];

  function edit(set: PerformedSet, change: SetEdit): void {
    onchange(editSet(session, instance.id, set.id, change, measure, unit));
  }

  /** A field that does not hold a valid number is put back as it was. */
  function field(
    input: HTMLInputElement,
    parse: (text: string) => number | null | undefined,
    apply: (value: number | null) => SetEdit,
    set: PerformedSet,
    shown: string,
  ): void {
    const value = parse(input.value);
    if (value === undefined) input.value = shown;
    else edit(set, apply(value));
  }

  function nextUnit(set: PerformedSet): LoadUnit {
    const current = unitOf(set) ?? unit;
    return UNITS[(UNITS.indexOf(current) + 1) % UNITS.length];
  }

  function shownAmount(set: PerformedSet): string {
    const amount = amountOf(set);
    if (amount === null) return '';
    return measure === 'time' ? formatSeconds(amount).replace(' s', '') : String(amount);
  }

  function removeCard(): void {
    const logged = instance.performed.some((s) => s.state === 'done');
    if (!logged || confirm(`Remove ${exercise?.name ?? 'this exercise'} and its sets?`)) {
      onchange(removeExercise(session, instance.id));
    }
  }
</script>

<article>
  <header>
    <h2>{exercise?.name ?? instance.exercise_id}</h2>
    <button class="icon" aria-label="Remove exercise" onclick={removeCard}>×</button>
  </header>
  {#if last}<p class="last tabular">Last time: {last}</p>{/if}

  <div class="labels" class:time={measure === 'time'}>
    <span></span>
    <span>{measure === 'time' ? 'time' : 'load'}</span>
    {#if measure === 'weight'}<span></span><span>reps</span>{/if}
    <span>RPE</span>
  </div>

  {#each instance.performed as set, i (set.id)}
    {@const target = targetOf(instance, set)}
    {@const done = set.state === 'done'}
    <div class="row tabular" class:done class:time={measure === 'time'}>
      <span class="n">{set.is_warmup ? 'W' : i + 1}</span>
      <input
        inputmode={measure === 'time' ? 'text' : 'decimal'}
        aria-label={measure === 'time' ? 'Time' : 'Load'}
        placeholder={measure === 'time' ? '1:30' : ''}
        value={shownAmount(set)}
        onchange={(e) =>
          field(
            e.currentTarget,
            measure === 'time' ? parseSeconds : parseNumber,
            (amount) => ({ amount }),
            set,
            shownAmount(set),
          )}
      />
      {#if measure === 'weight'}
        <button class="unit" onclick={() => edit(set, { unit: nextUnit(set) })}>
          {unitOf(set) ?? unit}
        </button>
        <input
          inputmode="numeric"
          aria-label="Reps"
          value={set.reps ?? ''}
          onchange={(e) =>
            field(e.currentTarget, parseNumber, (reps) => ({ reps }), set, String(set.reps ?? ''))}
        />
      {/if}
      <input
        inputmode="decimal"
        aria-label="RPE"
        value={set.rpe ?? ''}
        onchange={(e) =>
          field(e.currentTarget, parseRpe, (rpe) => ({ rpe }), set, String(set.rpe ?? ''))}
      />
      <button
        class="tick"
        class:on={done}
        aria-label={done ? 'Mark not done' : 'Mark done'}
        disabled={!done && (!isComplete(set) || blocked)}
        onclick={() => onchange(setDone(session, instance.id, set.id, !done))}>✓</button
      >
      <details class="more">
        <summary aria-label="More">⋯</summary>
        <button onclick={() => edit(set, { is_warmup: !set.is_warmup })}>
          {set.is_warmup ? 'Not a warm-up' : 'Warm-up'}
        </button>
        <button onclick={() => onchange(removeSet(session, instance.id, set.id))}>Remove set</button
        >
      </details>
    </div>
    {#if target && !done}<p class="target tabular">Target {target}</p>{/if}
  {/each}

  {#if blocked}<p class="hint">Enter today's bodyweight above to tick these sets.</p>{/if}
  <button
    class="add-set"
    onclick={() => onchange(addSet(session, instance.id, () => crypto.randomUUID()))}
  >
    + set
  </button>
</article>

<style>
  article {
    margin: 0 0 1rem;
    padding: 0.75rem;
    border: 1px solid var(--line);
    border-radius: 0.75rem;
    background: var(--surface);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  h2 {
    margin: 0;
    font-size: 1.05rem;
  }

  .last,
  .target,
  .hint {
    margin: 0.2rem 0 0.4rem;
    font-size: 0.85rem;
    color: var(--muted);
  }

  .target {
    margin: -0.2rem 0 0.4rem 2rem;
  }

  .labels,
  .row {
    display: grid;
    grid-template-columns: 1.5rem 1fr 2.75rem 1fr 1fr 2.75rem 2rem;
    gap: 0.35rem;
    align-items: center;
  }

  .labels.time,
  .row.time {
    grid-template-columns: 1.5rem 1fr 1fr 2.75rem 2rem;
  }

  .labels {
    font-size: 0.75rem;
    color: var(--muted);
  }

  .row {
    margin: 0.3rem 0;
  }

  .n {
    color: var(--muted);
    text-align: center;
  }

  input {
    width: 100%;
    min-width: 0;
    min-height: 2.75rem;
    padding: 0 0.4rem;
    border: 1px solid var(--line);
    border-radius: 0.4rem;
    background: var(--ground);
    color: var(--ink);
    font: inherit;
    font-size: 1.1rem;
    text-align: center;
  }

  .done input {
    border-color: transparent;
  }

  button {
    font: inherit;
    color: var(--ink);
  }

  .unit,
  .tick {
    min-height: 2.75rem;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 0.4rem;
    background: none;
  }

  .unit {
    font-size: 0.85rem;
    color: var(--ink-2);
  }

  .tick {
    font-size: 1.1rem;
    color: var(--muted);
  }

  .tick.on {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--surface);
  }

  .tick:disabled {
    opacity: 0.35;
  }

  .icon {
    min-width: 2.75rem;
    min-height: 2.75rem;
    border: 0;
    background: none;
    color: var(--muted);
    font-size: 1.3rem;
  }

  .more {
    position: relative;
  }

  .more summary {
    display: grid;
    place-items: center;
    min-height: 2.75rem;
    color: var(--muted);
    list-style: none;
    cursor: pointer;
  }

  .more summary::-webkit-details-marker {
    display: none;
  }

  .more[open] {
    z-index: 1;
  }

  .more button {
    position: relative;
    display: block;
    width: 9rem;
    min-height: 2.75rem;
    margin-left: -7rem;
    border: 1px solid var(--line);
    background: var(--surface);
    text-align: left;
    padding: 0 0.75rem;
  }

  .add-set {
    min-height: 2.75rem;
    margin-top: 0.25rem;
    padding: 0 0.75rem;
    border: 0;
    background: none;
    color: var(--accent);
  }
</style>
