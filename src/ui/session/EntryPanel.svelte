<script lang="ts">
  /**
   * The entry panel: a bottom sheet for saving the set being entered, opened
   * from the end button of a set row. Load and reps on −/+ steppers that step
   * by the plate increment, then the RPE chips 6 to 10 in halves, laid out in
   * two staggered courses: tapping one saves the set. A warm-up takes Done (or
   * Skip) instead of an RPE, and a set of a session only planned takes a plain
   * Save. The owner (SessionView) applies `onsave`'s edit with `editSet` (or
   * `planSet`), closes the panel and opens the rest.
   */
  import { untrack } from 'svelte';
  import type { LoadUnit, PerformedSet } from '../../model';
  import { stepAmount, type Prefill } from '../entry';
  import Button from '../kit/Button.svelte';
  import Sheet from '../kit/Sheet.svelte';
  import { parseNumber, parseSeconds, type SetEdit } from '../session';
  import { panelFigure, panelSave, RPE_COURSES, stepText } from './panel';
  import Stepper from './Stepper.svelte';

  interface Props {
    open: boolean;
    /** "Bench press". */
    exerciseName: string;
    /** "Set 2", or "Warm-up 1" for a warm-up. */
    setLabel: string;
    /** The set being entered, as it is now. */
    set: PerformedSet;
    /** Where the steppers start (entry.ts `entryPrefill`). RPE is never prefilled. */
    prefill: Prefill;
    /** What the prescription asks, for the head: "5 @ 8". Null without one. */
    target: string | null;
    /** The target RPE, ringed among the chips (a mark, not a selection). Null without one. */
    targetRpe: number | null;
    /**
     * The suggested weight and its reason, "92.5 kg · +2.5: last @7.5 for a target of 8":
     * the weight said, since the steppers may hold a target instead. Null without one.
     */
    suggestion: string | null;
    /** Weighted work has load and reps; timed work a time only. */
    measure: 'weight' | 'time';
    /** The load's unit; seconds when `measure` is time. */
    unit: LoadUnit;
    /** How far − and + move the load, in `unit`. */
    plateStep: number;
    /** The session is planned, not started: the set's numbers are saved, never its RPE. */
    planning?: boolean;
    /** Saves the set: amount and reps, and the RPE tapped (none for a warm-up). */
    onsave: (edit: SetEdit) => void;
    /** A warm-up's Skip: the owner marks the set skipped. */
    onskip?: () => void;
    onclose: () => void;
  }
  let {
    open,
    exerciseName,
    setLabel,
    set,
    prefill,
    target,
    targetRpe,
    suggestion,
    measure,
    unit,
    plateStep,
    planning = false,
    onsave,
    onskip,
    onclose,
  }: Props = $props();

  let amount = $state('');
  let reps = $state('');

  // A different set starts from its own prefill; the same set keeps what was stepped to.
  $effect(() => {
    void set.id;
    untrack(() => {
      amount = prefill.amount === null ? '' : panelFigure(measure, prefill.amount, unit).text;
      reps = prefill.reps === null ? '' : String(prefill.reps);
    });
  });

  const parseAmount = (text: string) =>
    measure === 'time' ? parseSeconds(text) : parseNumber(text);
  const amountValue = $derived(parseAmount(amount));
  const repsValue = $derived(parseNumber(reps));
  /** A set with no load or no reps is not one: the chips wait for both rather than save half. */
  const ready = $derived(
    typeof amountValue === 'number' && (measure === 'time' || typeof repsValue === 'number'),
  );
  const saving = $derived(panelSave(set, planning));

  function stepAmountBy(direction: 1 | -1): void {
    const now = typeof amountValue === 'number' ? amountValue : 0;
    amount = panelFigure(
      measure,
      stepAmount(now, direction, { measure, step: plateStep }),
      unit,
    ).text;
  }

  function stepReps(direction: 1 | -1): void {
    const now = typeof repsValue === 'number' ? repsValue : 0;
    reps = String(Math.max(0, now + direction));
  }

  function save(rpe: number | null): void {
    if (!ready) return;
    onsave({
      amount: amountValue as number,
      ...(measure === 'weight' ? { reps: repsValue as number } : {}),
      ...(rpe !== null ? { rpe } : {}),
    });
  }

  const unitLabel = $derived(
    panelFigure(measure, typeof amountValue === 'number' ? amountValue : 0, unit).unit,
  );
</script>

<Sheet {open} {onclose} accent label="{exerciseName}, {setLabel}">
  <div class="head">
    <span class="caps">{exerciseName} · {setLabel}</span>
    {#if target}<span class="meta">target <b class="tabular">{target}</b></span>{/if}
  </div>
  {#if suggestion}<p class="meta suggestion">Suggested {suggestion}</p>{/if}

  <div class="fields">
    <Stepper
      bind:value={amount}
      unit={unitLabel}
      label={measure === 'time' ? 'Time' : 'Load'}
      inputmode="decimal"
      onstep={stepAmountBy}
    />
    {#if measure === 'weight'}
      <Stepper bind:value={reps} unit="reps" label="Reps" inputmode="numeric" onstep={stepReps} />
    {/if}
  </div>

  {#if saving === 'save'}
    <p class="meta planned">Planned: the RPE comes when the set is lifted.</p>
    <Button variant="primary" bench full disabled={!ready} onclick={() => save(null)}>Save</Button>
    {#if !ready}
      <p class="meta need">Enter the {measure === 'weight' ? 'load and reps' : 'time'} to save.</p>
    {/if}
  {:else if saving === 'done'}
    <p class="hint caps">Warm-ups take no RPE</p>
    <div class="warm">
      <Button bench onclick={onskip}>Skip</Button>
      <Button variant="primary" bench disabled={!ready} onclick={() => save(null)}>Done</Button>
    </div>
  {:else}
    <div class="hint">
      <span class="caps">RPE · tap to save</span>
      <span class="meta">{stepText(measure, plateStep, unit)}</span>
    </div>
    <div class="rpes" role="group" aria-label="RPE, saves the set">
      {#each RPE_COURSES as course, i (i)}
        <div class="course" class:offset={i === 1}>
          {#each course as rpe (rpe)}
            <button
              class="rpe figure-num"
              class:target={rpe === targetRpe}
              disabled={!ready}
              aria-label={rpe === targetRpe ? `${rpe}, the target` : String(rpe)}
              onclick={() => save(rpe)}>{rpe}</button
            >
          {/each}
        </div>
      {/each}
    </div>
    {#if !ready}
      <p class="meta need">Enter the {measure === 'weight' ? 'load and reps' : 'time'} to save.</p>
    {/if}
  {/if}
</Sheet>

<style>
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    min-height: 32px;
    color: var(--ink-2);
  }

  .head .caps {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .head b {
    font: var(--fw-num) 1.0625rem var(--font-num);
    font-style: normal;
    color: var(--ink);
  }

  .suggestion {
    margin: 0;
  }

  .fields {
    display: grid;
    gap: var(--space-1);
    margin: var(--space-2) 0 var(--space-1);
  }

  .hint {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin: var(--space-2) 0;
    color: var(--ink-2);
  }

  .hint .meta {
    color: var(--muted);
  }

  .rpes {
    display: grid;
    gap: var(--space-2);
  }

  .course {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 6px;
  }

  /* The second course is four chips, offset half a chip: staggered ashlar, each chip as wide as in the first. */
  .course.offset {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    padding-inline: calc(10% + 0.6px);
  }

  .rpe {
    min-height: 52px;
    border: var(--stroke) solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow-1);
    font-size: 1.375rem;
    transition:
      background-color var(--dur-press),
      color var(--dur-press);
  }

  .rpe.target {
    border: var(--stroke-strong) solid var(--accent);
    background: var(--accent-wash);
    color: var(--accent);
  }

  .rpe:active:not(:disabled) {
    background: var(--figure);
    color: var(--on-figure);
  }

  .rpe:disabled {
    opacity: 0.45;
  }

  .need {
    margin: var(--space-2) 0 0;
    text-align: center;
  }

  .planned {
    margin: var(--space-2) 0 var(--space-3);
  }

  .warm {
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: var(--space-2);
  }
</style>
