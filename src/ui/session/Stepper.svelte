<script lang="ts">
  import Icon from '../kit/Icon.svelte';

  /**
   * One number of the entry panel on − and +: a 64 × 56 button either side
   * of the figure, which is itself an input so that a number typed on the
   * keyboard works as it does in the rows. Holding a button repeats it, so
   * a jump from 60 to 100 kg is not forty taps.
   */
  interface Props {
    value: string;
    /** Caps beside the figure ("kg", "reps"); it sits outside the centre so the number stays central. */
    unit: string;
    /** Names the figure and its buttons: "Load", "Reps". */
    label: string;
    inputmode: 'decimal' | 'numeric';
    /** One tap: −1 or +1. The owner decides what a step is. */
    onstep: (direction: 1 | -1) => void;
  }
  let { value = $bindable(), unit, label, inputmode, onstep }: Props = $props();

  /** The first repeat waits, so a tap is only a tap. */
  const HOLD_MS = 400;
  const REPEAT_MS = 120;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let pressed = $state<1 | -1 | null>(null);

  function stop(): void {
    clearTimeout(timer);
    timer = undefined;
    pressed = null;
  }

  function repeat(direction: 1 | -1): void {
    onstep(direction);
    timer = setTimeout(() => repeat(direction), REPEAT_MS);
  }

  function press(direction: 1 | -1): void {
    pressed = direction;
    onstep(direction);
    timer = setTimeout(() => repeat(direction), HOLD_MS);
  }

  // The pointer does the stepping, so a keyboard's Enter or Space (a click with no pointer) steps here.
  function click(event: MouseEvent, direction: 1 | -1): void {
    if (event.detail === 0) onstep(direction);
  }

  $effect(() => stop);
</script>

<div class="stepper">
  <button
    class="step"
    class:pressed={pressed === -1}
    aria-label="Less {label.toLowerCase()}"
    onpointerdown={() => press(-1)}
    onpointerup={stop}
    onpointerleave={stop}
    onpointercancel={stop}
    onclick={(e) => click(e, -1)}
    oncontextmenu={(e) => e.preventDefault()}><Icon name="minus" size={24} stroke={2.6} /></button
  >
  <label class="value">
    <input
      class="figure-num"
      {inputmode}
      aria-label={label}
      style:width="{Math.max(value.length, 2) + 0.5}ch"
      bind:value
      onfocus={(e) => e.currentTarget.select()}
    />
    <span class="caps unit">{unit}</span>
  </label>
  <button
    class="step"
    class:pressed={pressed === 1}
    aria-label="More {label.toLowerCase()}"
    onpointerdown={() => press(1)}
    onpointerup={stop}
    onpointerleave={stop}
    onpointercancel={stop}
    onclick={(e) => click(e, 1)}
    oncontextmenu={(e) => e.preventDefault()}><Icon name="plus" size={24} stroke={2.6} /></button
  >
</div>

<style>
  .stepper {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr) 64px;
    align-items: center;
    gap: var(--space-2);
    min-height: 66px;
  }

  .step {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 64px;
    min-height: var(--tap-bench);
    border: var(--stroke) solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow-1);
    touch-action: manipulation;
    user-select: none;
    -webkit-touch-callout: none;
  }

  .step.pressed {
    background: var(--figure);
    color: var(--on-figure);
  }

  .value {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .value input {
    min-width: 0;
    max-width: 100%;
    padding: 0;
    border-bottom-color: transparent;
    font-size: var(--fs-entry);
    line-height: var(--lh-tight);
    text-align: center;
  }

  .value input:focus {
    border-bottom-color: var(--accent);
  }

  .unit {
    color: var(--muted);
  }
</style>
