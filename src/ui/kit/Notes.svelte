<script lang="ts">
  import Button from './Button.svelte';

  /**
   * A free-text note. Once its record is saved or locked (`saved`) it is read
   * as text in the body font, full width, line breaks kept, no box, with an
   * Edit link that turns it back into a textarea that grows with its text;
   * leaving the field returns to text. An unsaved record keeps the field.
   * `onchange` gets the text when the field is left changed.
   */
  interface Props {
    id: string;
    value: string;
    saved: boolean;
    /** Names the field and the Edit link. */
    label: string;
    placeholder?: string;
    rows?: number;
    onchange?: (text: string) => void;
  }
  let {
    id,
    value = $bindable(),
    saved,
    label,
    placeholder = '',
    rows = 2,
    onchange,
  }: Props = $props();

  let editing = $state(false);
  const reading = $derived(saved && !editing);

  function edit(): void {
    editing = true;
    queueMicrotask(() => document.getElementById(id)?.focus());
  }
</script>

{#if reading}
  <div class="read">
    <p {id} class="text" class:none={value.trim() === ''}>
      {value.trim() === '' ? 'No notes' : value}
    </p>
    <Button variant="link" aria-label="Edit {label.toLowerCase()}" onclick={edit}>Edit</Button>
  </div>
{:else}
  <textarea
    {id}
    {rows}
    {placeholder}
    aria-label={label}
    bind:value
    onchange={(e) => onchange?.(e.currentTarget.value)}
    onblur={() => (editing = false)}></textarea>
{/if}

<style>
  .read {
    display: grid;
    justify-items: start;
    gap: 0;
  }

  .text {
    margin: 0;
    width: 100%;
    font-family: var(--font-text);
    font-size: 1rem;
    line-height: 1.5;
    color: var(--ink);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .text.none {
    color: var(--muted);
  }

  .read :global(.button-link) {
    margin-left: calc(-1 * var(--space-2));
  }

  textarea {
    width: 100%;
    resize: none;
    field-sizing: content;
  }
</style>
