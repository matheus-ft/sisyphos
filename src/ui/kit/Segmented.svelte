<script lang="ts" generics="T extends string">
  /**
   * A row of mutually exclusive choices: List / Calendar, Body / Strength /
   * Labours, 3M / 6M / 1Y / All, plate increments. The chosen one is raised
   * out of a sunken track.
   */
  interface Props {
    options: readonly { value: T; label: string }[];
    value: T;
    onchange: (value: T) => void;
    /** What is being chosen, for a screen reader: "View". */
    label: string;
    /** Stretch to the container's width, each choice an equal share. */
    full?: boolean;
  }
  let { options, value, onchange, label, full = false }: Props = $props();
</script>

<div class="seg" class:full role="group" aria-label={label}>
  {#each options as option (option.value)}
    <button aria-pressed={option.value === value} onclick={() => onchange(option.value)}
      >{option.label}</button
    >
  {/each}
</div>

<style>
  .seg {
    display: inline-grid;
    grid-auto-columns: 1fr;
    grid-auto-flow: column;
    padding: 3px;
    border-radius: var(--radius-md);
    background: var(--sunken);
  }

  .full {
    display: grid;
    width: 100%;
  }

  /* 38 drawn inside the 3px track: with the track, 44 to hit. */
  button {
    min-height: 38px;
    padding: 0 var(--space-4);
    border-radius: 6px;
    font: var(--fw-display) var(--fs-label) / 1 var(--font-display);
    letter-spacing: var(--ls-caps);
    text-transform: uppercase;
    color: var(--ink-2);
  }

  /* Stretched, each choice is centred in its share, so its padding only sets how
     narrow the row can get: four lifts must fit a 360 phone. */
  .full button {
    padding-inline: var(--space-2);
  }

  button[aria-pressed='true'] {
    background: var(--raised);
    color: var(--ink);
    box-shadow: var(--shadow-1);
  }
</style>
