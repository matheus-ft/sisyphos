<script lang="ts">
  import type { Exercise } from '../../model';
  import { app } from '../app.svelte';
  import Button from '../kit/Button.svelte';
  import Chip from '../kit/Chip.svelte';
  import Icon from '../kit/Icon.svelte';
  import { plateStep } from '../prefs';
  import { localDate } from '../session';
  import {
    formatClock,
    formatRange,
    loadModes,
    loadOf,
    loadPreview,
    MODE_LABELS,
    parseRange,
    READERS,
    type Target,
    type TargetEdit,
  } from '../template';

  /**
   * One planned set: how its load is prescribed (chips), the figure for it,
   * the reps and the RPE it aims at, and for a percentage what it comes to
   * today. Reps, RPE and the load take a number, a range (3-5) or a minimum
   * (5+), typed, since a range cannot be typed on a number pad.
   */
  interface Props {
    target: Target;
    /** 1-based, for the name and the accessible labels. */
    number: number;
    exercise: Exercise | undefined;
    timed: boolean;
    onedit: (change: TargetEdit) => void;
    onduplicate: () => void;
    onremove: () => void;
    /** Moves the target up or down among its exercise's; `first` and `last` say where it can go. */
    onmove: (by: -1 | 1) => void;
    first: boolean;
    last: boolean;
  }
  let {
    target,
    number,
    exercise,
    timed,
    onedit,
    onduplicate,
    onremove,
    onmove,
    first,
    last,
  }: Props = $props();

  const uid = $props.id();
  const load = $derived(loadOf(target));
  const modes = $derived(
    timed
      ? []
      : loadModes(
          exercise,
          load.mode === 'time' || load.mode === 'distance' ? undefined : load.mode,
        ),
  );
  const preview = $derived(
    loadPreview(target, {
      date: localDate(new Date()),
      oneRms: app.oneRms,
      step: plateStep(app.prefs, 'kg'),
    }),
  );

  /** The load's field: what it is called, how it reads and how it is shown. */
  const amount = $derived.by(() => {
    switch (load.mode) {
      case 'time':
        return { label: 'Time', read: READERS.time, show: formatClock, hint: '0:45' };
      case 'pct_1rm':
        return { label: '% of max', read: READERS.percent, show: undefined, hint: '80' };
      case 'bw_plus':
        return { label: 'Added kg', read: READERS.kg, show: undefined, hint: '0' };
      case 'absolute':
        return { label: 'Load kg', read: READERS.kg, show: undefined, hint: '100' };
      default:
        return null;
    }
  });

  /** A field that does not hold a valid figure is put back as it was. */
  function commit(
    input: HTMLInputElement,
    shown: string,
    read: (end: string) => number | null | undefined,
    apply: (value: [number | null, number | null] | null) => TargetEdit,
  ): void {
    const value = parseRange(input.value, read);
    if (value === undefined) input.value = shown;
    else onedit(apply(value));
  }

  const repsShown = $derived(formatRange(target.reps));
  const rpeShown = $derived(formatRange(target.rpe));
  const amountShown = $derived(amount ? formatRange(load.amount, amount.show) : '');

  function pick(mode: (typeof modes)[number]): void {
    onedit({ mode, lift: exercise?.base_lift ?? undefined });
  }
</script>

<div class="target">
  <div class="top">
    <h4 class="caps">Set {number}</h4>
    <div class="acts">
      <Button variant="link" aria-label="Duplicate set {number}" onclick={onduplicate}
        >Duplicate</Button
      >
      <Button variant="link" aria-label="Remove set {number}" onclick={onremove}>Remove</Button>
      <button
        class="icon-btn"
        aria-label="Move set {number} up"
        disabled={first}
        onclick={() => onmove(-1)}><Icon name="up" size="sm" /></button
      >
      <button
        class="icon-btn down"
        aria-label="Move set {number} down"
        disabled={last}
        onclick={() => onmove(1)}><Icon name="up" size="sm" /></button
      >
    </div>
  </div>

  {#if modes.length > 1}
    <div class="chips" role="group" aria-label="How set {number} is loaded">
      {#each modes as mode (mode)}
        <Chip pressed={load.mode === mode} onclick={() => pick(mode)}>{MODE_LABELS[mode]}</Chip>
      {/each}
    </div>
  {/if}

  <div class="fields" class:two={!amount || timed}>
    {#if amount}
      <div class="field">
        <label for="{uid}-load">{amount.label}</label>
        <input
          id="{uid}-load"
          class="figure-num"
          type="text"
          inputmode="text"
          enterkeyhint="done"
          placeholder={amount.hint}
          value={amountShown}
          onchange={(e) =>
            commit(e.currentTarget, amountShown, amount.read, (value) => ({ amount: value }))}
        />
      </div>
    {/if}
    {#if !timed}
      <div class="field">
        <label for="{uid}-reps">Reps</label>
        <input
          id="{uid}-reps"
          class="figure-num"
          type="text"
          inputmode="text"
          enterkeyhint="done"
          placeholder="5"
          value={repsShown}
          onchange={(e) =>
            commit(e.currentTarget, repsShown, READERS.reps, (value) => ({ reps: value }))}
        />
      </div>
    {/if}
    <div class="field">
      <label for="{uid}-rpe">RPE</label>
      <input
        id="{uid}-rpe"
        class="figure-num"
        type="text"
        inputmode="text"
        enterkeyhint="done"
        placeholder="8"
        value={rpeShown}
        onchange={(e) =>
          commit(e.currentTarget, rpeShown, READERS.rpe, (value) => ({ rpe: value }))}
      />
    </div>
  </div>

  {#if preview?.kind === 'resolved'}
    <p class="preview meta">
      {preview.lead} → <strong class="figure-num">{preview.result}</strong>, {preview.note}
    </p>
  {:else if preview?.kind === 'missing'}
    <p class="preview meta">
      No {preview.lift} max set yet. Set one in <a href="#/more/lifter">More, under Lifter</a>.
    </p>
  {/if}
</div>

<style>
  .target {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-2) 0 var(--space-3);
  }

  .target + :global(.target) {
    border-top: var(--hairline) solid var(--line);
  }

  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  h4 {
    color: var(--ink-2);
  }

  .acts {
    display: flex;
    align-items: center;
    margin-right: calc(-1 * var(--space-2));
  }

  .acts .icon-btn {
    color: var(--accent);
  }

  .acts .icon-btn:disabled {
    color: var(--muted);
  }

  /* The up arrow turned over. */
  .down :global(svg) {
    transform: rotate(180deg);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .fields {
    display: grid;
    margin-top: var(--space-1);
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-4);
  }

  .fields.two {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .fields input {
    font-size: var(--fs-row);
  }

  .preview {
    padding-top: 2px;
  }

  .preview strong {
    font-size: var(--fs-body);
    color: var(--ink);
  }
</style>
