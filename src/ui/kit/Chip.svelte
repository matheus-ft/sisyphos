<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  /**
   * A pill: a filter, a choice in a group, a picker that opens a sheet.
   * Selected (`pressed`) takes the figure colour; the accent never means
   * selected. With `onclear`, a selected chip carries a × of its own, so the
   * chip itself still opens what it picks and the × clears it.
   */
  interface Props {
    pressed?: boolean;
    /** A chevron after the label: the chip opens a picker. */
    chevron?: boolean;
    onclick?: () => void;
    /** Shown as a × while pressed, labelled "Clear {label}". */
    onclear?: () => void;
    /** What the chip is, for the clear button's name. */
    label?: string;
    disabled?: boolean;
    children: Snippet;
  }
  let {
    pressed = false,
    chevron = false,
    onclick,
    onclear,
    label,
    disabled = false,
    children,
  }: Props = $props();
</script>

{#if onclear && pressed}
  <span class="chip split" aria-pressed="true">
    <button class="main" {onclick} {disabled}>{@render children()}</button>
    <button class="x" aria-label={label ? `Clear ${label}` : 'Clear'} onclick={onclear} {disabled}>
      <Icon name="close" size="sm" />
    </button>
  </span>
{:else}
  <button class="chip" aria-pressed={pressed} {onclick} {disabled}>
    {@render children()}
    {#if chevron}<Icon name="down" size="sm" />{/if}
  </button>
{/if}

<style>
  .split {
    padding: 0;
    gap: 0;
  }

  .split button {
    display: inline-flex;
    align-items: center;
    min-height: var(--tap);
    color: inherit;
  }

  .main {
    padding: 0 var(--space-1) 0 var(--space-4);
  }

  .x {
    padding: 0 var(--space-3) 0 var(--space-2);
  }

  .chip:disabled {
    opacity: 0.5;
  }
</style>
