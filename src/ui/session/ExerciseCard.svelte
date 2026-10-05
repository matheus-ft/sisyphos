<script lang="ts">
  import type { Exercise, ExerciseInstance, LoadUnit, PerformedSet, Session } from '../../model';
  import Button from '../kit/Button.svelte';
  import Icon from '../kit/Icon.svelte';
  import { confirmDialog } from '../overlays.svelte';
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
  } from '../session';

  /**
   * One exercise of a session: its sets as rows typed into as in v0, each
   * with an end button that opens the entry panel. Current (holding the set
   * being entered) is ringed in the accent; done carries a verdigris border.
   */
  interface Props {
    session: Session;
    instance: ExerciseInstance;
    /** Missing when the log names an exercise this library does not have. */
    exercise: Exercise | undefined;
    /** The sets of the last other session with this exercise. */
    last: string | null;
    /** The unit a new set starts in. */
    unit: LoadUnit;
    /** The set being entered in the whole session, drawn inverted; at most one. */
    active: string | null;
    onchange: (next: Session) => void;
    /** Opens the exercise's history. */
    onhistory: (exercise: Exercise) => void;
    /** Opens the entry panel on a set. */
    onentry: (set: PerformedSet) => void;
  }
  let { session, instance, exercise, last, unit, active, onchange, onhistory, onentry }: Props =
    $props();

  const timed = $derived(exercise ? measureOf(exercise) === 'time' : false);
  const measure = $derived(timed ? 'time' : 'weight');
  const missingBodyweight = $derived(exercise ? needsBodyweight(session, exercise) : false);
  const UNITS: LoadUnit[] = ['kg', 'lb', 'pins'];
  const position = $derived(session.exercises.findIndex((e) => e.id === instance.id));
  const current = $derived(instance.performed.some((s) => s.id === active));
  const done = $derived(
    instance.performed.length > 0 && instance.performed.every((s) => s.state !== 'pending'),
  );
  const name = $derived(exercise?.name ?? instance.exercise_id);
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
    const now = unitOf(set) ?? unit;
    return UNITS[(UNITS.indexOf(now) + 1) % UNITS.length];
  }

  function shownAmount(set: PerformedSet): string {
    const amount = amountOf(set);
    if (amount === null) return '';
    return timed ? formatSeconds(amount).replace(' s', '') : String(amount);
  }

  async function removeAsked(): Promise<void> {
    const logged = instance.performed.filter((s) => s.state === 'done').length;
    const ok =
      logged === 0 ||
      (await confirmDialog({
        title: `Remove ${name}?`,
        body: `Its ${logged} done ${logged === 1 ? 'set goes' : 'sets go'} with it.`,
        confirmLabel: `Remove ${name}`,
        cancelLabel: 'Keep it',
        danger: true,
      }));
    if (ok) onchange(removeExercise(session, instance.id));
  }
</script>

<section class="card ex" class:card-current={current} class:card-done={done && !current}>
  <header>
    {#if exercise}
      <button class="name" onclick={() => onhistory(exercise)}><h3>{name}</h3></button>
    {:else}
      <h3 class="name">{name}</h3>
    {/if}
    <div class="order">
      <button
        class="icon-btn"
        aria-label="Move {name} up"
        disabled={position === 0}
        onclick={() => onchange(moveExercise(session, instance.id, -1))}
        ><Icon name="up" size="sm" /></button
      >
      <button
        class="icon-btn down"
        aria-label="Move {name} down"
        disabled={position === session.exercises.length - 1}
        onclick={() => onchange(moveExercise(session, instance.id, 1))}
        ><Icon name="up" size="sm" /></button
      >
      <button class="icon-btn" aria-label="Remove {name}" onclick={removeAsked}
        ><Icon name="close" size="sm" /></button
      >
    </div>
  </header>
  {#if last}<p class="meta last">Last time <b>{last}</b></p>{/if}
  {#if noting || instance.notes}
    <input
      class="note"
      aria-label="Note on {name}"
      placeholder="Note…"
      value={instance.notes ?? ''}
      onchange={(e) => onchange(setExerciseNotes(session, instance.id, e.currentTarget.value))}
    />
  {/if}

  <div class="rows">
    {#each instance.performed as set, i (set.id)}
      {@const target = targetsOf(instance, set)}
      {@const skipped = set.state === 'skipped'}
      <div
        class="row"
        class:timed
        class:skipped
        class:warm={set.is_warmup}
        class:pending={set.state === 'pending'}
        class:done={set.state === 'done'}
        class:active={set.id === active}
      >
        <button
          class="n"
          aria-label="Set {i + 1} actions"
          onclick={() => (opened = opened === set.id ? null : set.id)}
          >{set.is_warmup ? 'W' : i + 1}</button
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
          <span class="x">×</span>
          <input
            inputmode="numeric"
            aria-label="Reps"
            placeholder={target.reps}
            value={set.reps ?? ''}
            onfocus={(e) =>
              takeTarget(e.currentTarget, target.reps, parseNumber, (reps) => ({ reps }), set)}
            onchange={(e) =>
              field(
                e.currentTarget,
                parseNumber,
                (reps) => ({ reps }),
                set,
                String(set.reps ?? ''),
              )}
          />
        {/if}
        <span class="x">@</span>
        <input
          inputmode="decimal"
          aria-label="RPE"
          placeholder={target.rpe}
          value={set.rpe ?? ''}
          onchange={(e) =>
            field(e.currentTarget, parseRpe, (rpe) => ({ rpe }), set, String(set.rpe ?? ''))}
        />
        <span class="st">
          {#if set.state === 'done'}
            <Icon name="check" size={18} stroke={2.4} label="done" />
          {:else if skipped}
            <span class="word">skipped</span>
          {:else}
            <button
              class="icon-btn open"
              aria-label="Enter set {i + 1}"
              onclick={() => onentry(set)}><Icon name="sheet" /></button
            >
          {/if}
        </span>
      </div>
      {#if opened === set.id}
        <div class="actions">
          <Button variant="link" onclick={() => edit(set, { is_warmup: !set.is_warmup })}>
            {set.is_warmup ? 'Not a warm-up' : 'Warm-up'}
          </Button>
          <Button
            variant="link"
            onclick={() => onchange(skipSet(session, instance.id, set.id, !skipped))}
          >
            {skipped ? 'Not skipped' : 'Skip'}
          </Button>
          <Button variant="link" onclick={() => onchange(removeSet(session, instance.id, set.id))}>
            Remove set
          </Button>
        </div>
      {/if}
    {/each}
  </div>

  {#if missingBodyweight}<p class="meta">Today's bodyweight, below, counts in these sets.</p>{/if}
  <div class="foot">
    <Button
      variant="link"
      onclick={() => onchange(addSet(session, instance.id, () => crypto.randomUUID()))}
      >+ Set</Button
    >
    <Button variant="link" onclick={() => (noting = !noting)}>Note</Button>
  </div>
</section>

<style>
  .ex {
    margin: 0 12px var(--space-2);
    padding: var(--space-3) 14px var(--space-1);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  /* The name opens the exercise's history; it reads as a heading, not a button. */
  .name {
    min-width: 0;
    text-align: left;
  }

  .order {
    display: flex;
    margin: -8px -10px -8px 0;
    color: var(--ink-2);
  }

  .order .icon-btn {
    color: inherit;
  }

  .order .icon-btn:disabled {
    visibility: hidden;
  }

  .down :global(svg) {
    transform: rotate(180deg);
  }

  .last b {
    font: var(--fw-strong) 1rem var(--font-num);
    font-style: normal;
    color: var(--ink);
  }

  .note {
    width: 100%;
    font-size: var(--fs-meta);
    color: var(--ink-2);
  }

  .rows {
    display: grid;
    gap: 2px;
    margin-top: var(--space-2);
  }

  .row {
    display: grid;
    grid-template-columns:
      26px minmax(0, 1fr) 30px 12px minmax(0, 0.7fr) 14px minmax(0, 0.7fr)
      44px;
    align-items: center;
    gap: 2px;
    min-height: var(--tap);
    padding: 0 0 0 2px;
    border-radius: var(--radius-sm);
  }

  .row.timed {
    grid-template-columns: 26px minmax(0, 1fr) 14px minmax(0, 0.7fr) 44px;
  }

  .row input {
    width: 100%;
    min-width: 0;
    padding: 0;
    border-bottom-color: transparent;
    font: var(--fw-medium) var(--fs-row) / 1 var(--font-num);
    text-align: center;
  }

  .row input:focus {
    border-bottom: var(--stroke-strong) solid var(--accent);
  }

  .n {
    min-height: var(--tap);
    font: var(--fw-strong) 0.9375rem / 1 var(--font-num);
    color: var(--ink-2);
  }

  .x {
    text-align: center;
    color: var(--muted);
    font-size: 0.85em;
  }

  .unit {
    font: var(--fw-strong) var(--fs-label) / 1 var(--font-display);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .st {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    color: var(--success);
  }

  .word {
    font: italic 0.875rem / 1 var(--font-text);
    color: var(--muted);
  }

  .open {
    color: var(--ink-2);
  }

  .pending {
    outline: var(--stroke) dashed var(--line-strong);
    outline-offset: -1.5px;
  }

  .warm input {
    font-size: 1.0625rem;
    color: var(--ink-2);
  }

  .warm .n {
    font-family: var(--font-display);
    font-size: var(--fs-label);
    color: var(--muted);
  }

  /* A skipped set was planned and deliberately not done: it stays, struck through. */
  .skipped input,
  .skipped .n {
    text-decoration: line-through;
    color: var(--muted);
  }

  /* The set being entered: the one inversion in the list, ringed in the accent. */
  .active {
    min-height: 54px;
    margin: 2px -6px;
    padding-left: 8px;
    outline: none;
    background: var(--figure);
    color: var(--on-figure);
    box-shadow:
      0 0 0 3px var(--surface),
      0 0 0 4.5px var(--accent);
  }

  .active input {
    font-size: var(--fs-row-active);
    font-weight: var(--fw-num);
  }

  .active input::placeholder {
    color: color-mix(in srgb, var(--on-figure) 55%, transparent);
  }

  .active .n {
    font-size: 1.125rem;
    font-weight: var(--fw-display);
    color: var(--figure-accent);
  }

  .active .x,
  .active .unit {
    color: var(--on-figure);
    opacity: 0.7;
  }

  .active .open {
    color: var(--figure-accent);
  }

  .actions {
    display: flex;
    gap: var(--space-2);
    padding-left: 26px;
  }

  .foot {
    display: flex;
    gap: var(--space-3);
  }
</style>
