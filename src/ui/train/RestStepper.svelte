<script lang="ts">
  import type { Exercise } from '../../model';
  import Button from '../kit/Button.svelte';
  import Icon from '../kit/Icon.svelte';
  import { formatClock, restShown, stepTemplateRest } from '../template';
  import { restTargetS } from '../rest';

  /**
   * An exercise's target rest, stepped by 15 seconds. Until the lifter sets
   * one the tier's default is shown as such, and stepping starts from it.
   */
  interface Props {
    exercise: Exercise | undefined;
    /** Seconds; null is the tier's default. */
    value: number | null;
    onchange: (seconds: number | null) => void;
  }
  let { exercise, value, onchange }: Props = $props();

  const uid = $props.id();
  const own = $derived(value !== null);
  const label = $derived(restShown(exercise, value));
  const standard = $derived(formatClock(restTargetS(exercise?.tier ?? 'acc', null)));
</script>

<div class="rest">
  <span class="name caps" id="{uid}-rest">Rest</span>
  <div class="stepper" role="group" aria-labelledby="{uid}-rest">
    <button
      class="icon-btn"
      aria-label="Rest 15 seconds shorter"
      onclick={() => onchange(stepTemplateRest(exercise, value, -1))}
      ><Icon name="minus" size="sm" /></button
    >
    <output class="value" aria-live="polite">
      {#if own}
        <span class="figure-num">{label}</span>
      {:else}
        <span class="meta">default <span class="figure-num">{standard}</span></span>
      {/if}
    </output>
    <button
      class="icon-btn"
      aria-label="Rest 15 seconds longer"
      onclick={() => onchange(stepTemplateRest(exercise, value, 1))}
      ><Icon name="plus" size="sm" /></button
    >
  </div>
  {#if own}
    <Button
      variant="link"
      class="reset"
      aria-label="Use the default rest"
      onclick={() => onchange(null)}>Default</Button
    >
  {/if}
</div>

<style>
  .rest {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-1) 0;
  }

  .name {
    color: var(--ink-2);
    flex: none;
  }

  .stepper {
    display: flex;
    align-items: center;
    margin-left: auto;
  }

  .rest :global(.reset) {
    white-space: nowrap;
  }

  .stepper .icon-btn {
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-sm);
  }

  .value {
    min-width: 6em;
    text-align: center;
  }

  .value .figure-num {
    font-size: var(--fs-row);
  }

  .meta .figure-num {
    font-size: var(--fs-body);
  }
</style>
