<script lang="ts">
  import type { Exercise, ExerciseInstance, LoadUnit, PerformedSet, Session } from '../model';
  import {
    addSet,
    amountOf,
    editSet,
    formatSeconds,
    measureOf,
    moveExercise,
    needsBodyweight,
    parseNumber,
    parseRpe,
    parseSeconds,
    removeExercise,
    removeSet,
    setExerciseNotes,
    skipSet,
    targetsOf,
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
    /** Opens the exercise's history. */
    onhistory: (exercise: Exercise) => void;
  }
  let { session, instance, exercise, last, unit, onchange, onhistory }: Props = $props();

  const timed = $derived(exercise ? measureOf(exercise) === 'time' : false);
  const measure = $derived(timed ? 'time' : 'weight');
  const missingBodyweight = $derived(exercise ? needsBodyweight(session, exercise) : false);
  const UNITS: LoadUnit[] = ['kg', 'lb', 'pins'];
  const position = $derived(session.exercises.findIndex((e) => e.id === instance.id));
  /** The set whose actions (warm-up, skip, remove) are open, from a tap on its number. */
  let opened = $state<string | null>(null);
  let noting = $state(false);

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

  /**
   * Tapping an empty field that has a target takes the target, selected so that
   * typing replaces it: lifting what was planned costs no typing. Never the RPE,
   * which is what the set felt like, not what was planned.
   */
  function takeTarget(
    input: HTMLInputElement,
    target: string,
    parse: (text: string) => number | null | undefined,
    apply: (value: number) => SetEdit,
    set: PerformedSet,
  ): void {
    if (input.value !== '' || target === '') return;
    const value = parse(target);
    if (value === null || value === undefined) return;
    edit(set, apply(value));
    input.value = target;
    requestAnimationFrame(() => input.select());
  }

  function nextUnit(set: PerformedSet): LoadUnit {
    const current = unitOf(set) ?? unit;
    return UNITS[(UNITS.indexOf(current) + 1) % UNITS.length];
  }

  function shownAmount(set: PerformedSet): string {
    const amount = amountOf(set);
    if (amount === null) return '';
    return timed ? formatSeconds(amount).replace(' s', '') : String(amount);
  }

  function removeExerciseAsked(): void {
    const logged = instance.performed.some((s) => s.state === 'done');
    if (!logged || confirm(`Remove ${exercise?.name ?? 'this exercise'} and its sets?`)) {
      onchange(removeExercise(session, instance.id));
    }
  }
</script>

<section>
  <header>
    {#if exercise}
      <button class="name" onclick={() => onhistory(exercise)}><h2>{exercise.name}</h2></button>
    {:else}
      <h2>{instance.exercise_id}</h2>
    {/if}
    <div class="order">
      <button
        class="quiet"
        aria-label="Move up"
        disabled={position === 0}
        onclick={() => onchange(moveExercise(session, instance.id, -1))}>↑</button
      >
      <button
        class="quiet"
        aria-label="Move down"
        disabled={position === session.exercises.length - 1}
        onclick={() => onchange(moveExercise(session, instance.id, 1))}>↓</button
      >
      <button class="quiet" onclick={() => (noting = !noting)}>note</button>
      <button class="quiet" onclick={removeExerciseAsked}>remove</button>
    </div>
  </header>
  {#if last}<p class="last tabular">last: {last}</p>{/if}
  {#if noting || instance.notes}
    <input
      class="note"
      aria-label="Note on {exercise?.name ?? 'this exercise'}"
      placeholder="note…"
      value={instance.notes ?? ''}
      onchange={(e) => onchange(setExerciseNotes(session, instance.id, e.currentTarget.value))}
    />
  {/if}

  {#each instance.performed as set, i (set.id)}
    {@const target = targetsOf(instance, set)}
    {@const skipped = set.state === 'skipped'}
    <div class="row tabular" class:timed class:skipped class:pending={set.state === 'pending'}>
      <button
        class="n"
        aria-label="Set {i + 1} actions"
        onclick={() => (opened = opened === set.id ? null : set.id)}
        >{set.is_warmup ? 'w' : i + 1}</button
      >
      <input
        inputmode={timed ? 'text' : 'decimal'}
        aria-label={timed ? 'Time' : 'Load'}
        placeholder={target.amount || (timed ? '0:00' : '')}
        value={shownAmount(set)}
        onfocus={(e) =>
          takeTarget(
            e.currentTarget,
            target.amount,
            timed ? parseSeconds : parseNumber,
            (amount) => ({ amount }),
            set,
          )}
        onchange={(e) =>
          field(
            e.currentTarget,
            timed ? parseSeconds : parseNumber,
            (amount) => ({ amount }),
            set,
            shownAmount(set),
          )}
      />
      {#if !timed}
        <button class="unit" onclick={() => edit(set, { unit: nextUnit(set) })}
          >{unitOf(set) ?? unit}</button
        >
        <span class="sep">×</span>
        <input
          inputmode="numeric"
          aria-label="Reps"
          placeholder={target.reps}
          value={set.reps ?? ''}
          onfocus={(e) =>
            takeTarget(e.currentTarget, target.reps, parseNumber, (reps) => ({ reps }), set)}
          onchange={(e) =>
            field(e.currentTarget, parseNumber, (reps) => ({ reps }), set, String(set.reps ?? ''))}
        />
      {/if}
      <span class="sep">@</span>
      <input
        inputmode="decimal"
        aria-label="RPE"
        placeholder={target.rpe}
        value={set.rpe ?? ''}
        onchange={(e) =>
          field(e.currentTarget, parseRpe, (rpe) => ({ rpe }), set, String(set.rpe ?? ''))}
      />
    </div>
    {#if opened === set.id}
      <div class="actions">
        <button class="link" onclick={() => edit(set, { is_warmup: !set.is_warmup })}>
          {set.is_warmup ? 'not a warm-up' : 'warm-up'}
        </button>
        <button
          class="link"
          onclick={() => onchange(skipSet(session, instance.id, set.id, !skipped))}
        >
          {skipped ? 'not skipped' : 'skip'}
        </button>
        <button class="link" onclick={() => onchange(removeSet(session, instance.id, set.id))}>
          remove set
        </button>
      </div>
    {/if}
  {/each}

  {#if missingBodyweight}<p class="hint">Today's bodyweight, above, counts in these sets.</p>{/if}
  <button
    class="link"
    onclick={() => onchange(addSet(session, instance.id, () => crypto.randomUUID()))}>+ set</button
  >
</section>

<style>
  section {
    padding: 1rem 0 0.5rem;
    border-bottom: 1px solid var(--line);
  }

  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }

  h2 {
    margin: 0;
    font-size: 1.1rem;
  }

  .quiet {
    min-height: 0;
    font-size: 0.85rem;
    color: var(--muted);
  }

  /* Up, down and remove sit together at the right of the exercise's name. */
  .order {
    display: flex;
    gap: 0.25rem;
  }

  .order button {
    min-width: 2.25rem;
  }

  .order button:disabled {
    visibility: hidden;
  }

  .last,
  .hint {
    margin: 0.15rem 0 0.25rem;
    font-size: 0.85rem;
    color: var(--muted);
  }

  .row {
    display: grid;
    grid-template-columns: 2rem 1fr 2.75rem 1rem 1fr 1rem 1fr;
    align-items: center;
    gap: 0.25rem;
  }

  .row.timed {
    grid-template-columns: 2rem 1fr 1rem 1fr;
  }

  .row input {
    width: 100%;
    min-width: 0;
    font-size: 1.2rem;
    text-align: center;
  }

  .n {
    color: var(--muted);
  }

  /* The name opens the exercise's history; it reads as a heading, not a button. */
  .name {
    min-height: 0;
    text-align: left;
  }

  .note {
    width: 100%;
    margin-bottom: 0.25rem;
    font-size: 0.9rem;
    color: var(--ink-2);
  }

  /* A skipped set was planned and deliberately not done: it stays, struck through. */
  .row.skipped input {
    text-decoration: line-through;
  }

  .row.skipped .n {
    text-decoration: line-through;
    color: var(--muted);
  }

  /* A set still missing a number is not counted yet, and shows it. */
  .row.pending .n {
    color: var(--line);
  }

  .unit {
    font-size: 0.85rem;
    color: var(--ink-2);
  }

  .sep {
    color: var(--muted);
    text-align: center;
  }

  .actions {
    display: flex;
    gap: 1.25rem;
    padding-left: 2.25rem;
    font-size: 0.9rem;
  }
</style>
