<script lang="ts">
  import type { Snippet } from 'svelte';
  import Button from '../kit/Button.svelte';

  /**
   * The card an entry is typed into: the fields it is given, what is wrong
   * with them in words, and the two ways out. Used by weigh-ins, reference
   * maxes and records by hand, so all three read as one.
   */
  interface Props {
    submitLabel: string;
    problem: string | null;
    onsubmit: () => void;
    oncancel: () => void;
    children: Snippet;
  }
  let { submitLabel, problem, onsubmit, oncancel, children }: Props = $props();
</script>

<form
  class="card entry"
  onsubmit={(event) => {
    event.preventDefault();
    onsubmit();
  }}
>
  <div class="fields">{@render children()}</div>
  {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
  <div class="actions">
    <Button type="submit" variant="quiet">{submitLabel}</Button>
    <Button variant="link" onclick={oncancel}>Cancel</Button>
  </div>
</form>

<style>
  .entry {
    display: grid;
    gap: var(--space-3);
    margin: 0 12px var(--space-3);
    padding: var(--space-4);
  }

  .fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3) var(--space-4);
  }

  /* A field that needs the whole width says so with class="wide". */
  .fields :global(.wide) {
    grid-column: 1 / -1;
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .problem {
    font-size: var(--fs-meta);
  }
</style>
