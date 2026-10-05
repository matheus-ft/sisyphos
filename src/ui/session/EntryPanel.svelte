<script lang="ts">
  /**
   * CONTRACT STUB, filled by wave 1 (session package). The props below are the
   * final interface; the body is a minimal working placeholder.
   *
   * The entry panel: a bottom sheet for saving the set being entered, opened
   * from the end button of a set row in ExerciseCard. Load and reps on −/+
   * steppers that step by `plateStep`, then the RPE chips 6 to 10 in halves:
   * tapping one saves the set. A warm-up takes Done (or Skip) instead of an
   * RPE. The owner (SessionView) applies `onsave`'s edit with `editSet`, then
   * closes the panel or moves it to the next set, and opens the rest takeover.
   */
  import type { LoadUnit, PerformedSet } from '../../model';
  import type { Prefill } from '../entry';
  import Button from '../kit/Button.svelte';
  import Icon from '../kit/Icon.svelte';
  import Sheet from '../kit/Sheet.svelte';
  import { parseNumber, parseSeconds, type SetEdit } from '../session';

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
    /** The suggested weight and its reason: "+2.5: last @7.5 for a target of 8". Null without one. */
    suggestion: string | null;
    /** Weighted work has load and reps; timed work a time only. */
    measure: 'weight' | 'time';
    /** The load's unit; seconds when `measure` is time. */
    unit: LoadUnit;
    /** How far − and + move the load, in `unit`. */
    plateStep: number;
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
    onsave,
    onskip,
    onclose,
  }: Props = $props();

  const RPES = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
  let amount = $state('');
  let reps = $state('');

  // A different set starts from its own prefill.
  $effect(() => {
    void set.id;
    amount = prefill.amount === null ? '' : String(prefill.amount);
    reps = prefill.reps === null ? '' : String(prefill.reps);
  });

  function step(by: number): void {
    const now = parseNumber(amount) ?? 0;
    amount = String(Math.max(0, Math.round((now + by) * 100) / 100));
  }

  function save(rpe: number | null): void {
    const parsedAmount = (measure === 'time' ? parseSeconds : parseNumber)(amount);
    const parsedReps = parseNumber(reps);
    onsave({
      amount: parsedAmount ?? null,
      ...(measure === 'weight' ? { reps: parsedReps ?? null } : {}),
      ...(rpe !== null ? { rpe } : {}),
    });
  }
</script>

<Sheet {open} {onclose} accent label="{exerciseName}, {setLabel}">
  <div class="head">
    <span class="caps">{exerciseName} · {setLabel}</span>
    {#if target}<span class="meta">target {target}</span>{/if}
  </div>
  {#if suggestion}<p class="meta">{suggestion}</p>{/if}

  <div class="fields">
    <div class="stepper">
      <Button onclick={() => step(-plateStep)} aria-label="Less"><Icon name="minus" /></Button>
      <input
        class="figure-num"
        inputmode="decimal"
        aria-label={measure === 'time' ? 'Time' : `Load in ${unit}`}
        bind:value={amount}
      />
      <Button onclick={() => step(plateStep)} aria-label="More"><Icon name="plus" /></Button>
    </div>
    {#if measure === 'weight'}
      <div class="stepper">
        <span></span>
        <input class="figure-num" inputmode="numeric" aria-label="Reps" bind:value={reps} />
        <span class="caps">reps</span>
      </div>
    {/if}
  </div>

  {#if set.is_warmup}
    <p class="caps hint">Warm-ups take no RPE</p>
    <div class="warm">
      <Button bench onclick={onskip}>Skip</Button>
      <Button variant="primary" bench onclick={() => save(null)}>Done</Button>
    </div>
  {:else}
    <p class="caps hint">RPE · tap to save</p>
    <div class="rpes" role="group" aria-label="RPE, saves the set">
      {#each RPES as rpe (rpe)}
        <button
          class="rpe figure-num"
          class:target={rpe === targetRpe}
          aria-label={rpe === targetRpe ? `${rpe}, the target` : String(rpe)}
          onclick={() => save(rpe)}>{rpe}</button
        >
      {/each}
    </div>
  {/if}
</Sheet>

<style>
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    min-height: 32px;
    color: var(--ink-2);
  }

  .fields {
    display: grid;
    gap: var(--space-2);
    margin: var(--space-2) 0;
  }

  .stepper {
    display: grid;
    grid-template-columns: 64px 1fr 64px;
    align-items: center;
    gap: var(--space-2);
  }

  .stepper input {
    width: 100%;
    font-size: var(--fs-entry);
    text-align: center;
    border-bottom-color: transparent;
  }

  .hint {
    margin: var(--space-2) 0;
    color: var(--ink-2);
  }

  .rpes {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 6px;
  }

  .rpe {
    min-height: var(--tap-bench);
    border: var(--stroke) solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    box-shadow: var(--shadow-1);
    font-size: 1.375rem;
  }

  .rpe.target {
    border: var(--stroke-strong) solid var(--accent);
    background: var(--accent-wash);
    color: var(--accent);
  }

  .rpe:active {
    background: var(--figure);
    color: var(--on-figure);
  }

  .warm {
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: var(--space-2);
  }
</style>
