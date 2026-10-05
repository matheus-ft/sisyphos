<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * A control that asks for a date. The native date input lies over what is
   * drawn, invisible but real, so a tap opens the phone's own picker (iOS
   * will not open one from a script) and a screen reader meets an actual date
   * field named by `label`.
   */
  interface Props {
    /** What picking does, for a screen reader: "Plan a session for". */
    label: string;
    onpick: (date: string) => void;
    min?: string;
    max?: string;
    /** A grouped row, or a quiet full-width button. */
    kind?: 'row' | 'button';
    children: Snippet;
  }
  let { label, onpick, min, max, kind = 'row', children }: Props = $props();

  function picked(input: HTMLInputElement): void {
    const value = input.value;
    input.value = '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) onpick(value);
  }
</script>

<label class="pick {kind}" class:button={kind === 'button'} class:button-quiet={kind === 'button'}>
  {@render children()}
  <input type="date" aria-label={label} {min} {max} onchange={(e) => picked(e.currentTarget)} />
</label>

<style>
  .pick {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    cursor: pointer;
  }

  .row {
    flex: 1;
    min-height: 56px;
    padding: 6px var(--space-4);
  }

  .button {
    justify-content: center;
    width: 100%;
  }

  /* Over everything, see-through: the tap lands on the real control. */
  input {
    position: absolute;
    inset: 0;
    width: 100%;
    min-height: 0;
    padding: 0;
    border: 0;
    opacity: 0;
    cursor: pointer;
  }

  .pick:has(input:focus-visible) {
    box-shadow: var(--focus-ring);
    border-radius: var(--radius-sm);
  }
</style>
