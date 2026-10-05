<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import Button from './Button.svelte';
  import { durationOf, easeOut } from './motion';

  /**
   * A confirm, anchored at the bottom for the thumb: a question for a title,
   * what happens in the body, then the actions stacked full width. When the
   * action destroys something it comes first, filled red, and names what it
   * destroys ("Discard session"); cancel is quiet and says what stays ("Keep
   * it"). Focus stays inside while it is open; Escape cancels.
   *
   * Usually shown through `confirmDialog` and `promptDialog` in overlays.svelte.ts,
   * which the shell's DialogHost renders; use it directly only for a dialog
   * with content of its own.
   */
  interface Props {
    open: boolean;
    title: string;
    body?: string;
    confirmLabel: string;
    cancelLabel?: string;
    /** The confirm destroys something: red, and first. */
    danger?: boolean;
    onconfirm: () => void;
    oncancel: () => void;
    /** Shown between the body and the actions: a field, for a prompt. */
    children?: Snippet;
  }
  let {
    open,
    title,
    body,
    confirmLabel,
    cancelLabel = 'Cancel',
    danger = false,
    onconfirm,
    oncancel,
    children,
  }: Props = $props();

  const id = `dialog-${Math.random().toString(36).slice(2, 8)}`;
  let box = $state<HTMLElement | null>(null);

  const focusable = () =>
    box
      ? [...box.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]')].filter(
          (el) => !el.hasAttribute('disabled'),
        )
      : [];

  $effect(() => {
    if (!open || !box) return;
    // A field takes the focus to be typed in; otherwise the safe choice does.
    const field = box.querySelector<HTMLElement>('input, textarea, select');
    const safe = box.querySelector<HTMLElement>('[data-cancel]');
    (field ?? safe ?? box).focus();
  });

  function keydown(event: KeyboardEvent): void {
    if (!open) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      oncancel();
    } else if (event.key === 'Tab') {
      const items = focusable();
      if (items.length === 0) return;
      const [first, last] = [items[0], items[items.length - 1]];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    onconfirm();
  }
</script>

<svelte:window onkeydown={keydown} />

{#if open}
  <div
    class="scrim"
    transition:fade={{ duration: durationOf('--dur-base') }}
    onclick={oncancel}
    aria-hidden="true"
  ></div>
  <div
    bind:this={box}
    class="dialog"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="{id}-title"
    aria-describedby={body ? `${id}-body` : undefined}
    tabindex="-1"
    transition:fly={{ y: 80, duration: durationOf('--dur-base'), easing: easeOut }}
  >
    <form onsubmit={submit}>
      <h2 id="{id}-title">{title}</h2>
      {#if body}<p id="{id}-body">{body}</p>{/if}
      {#if children}<div class="extra">{@render children()}</div>{/if}
      <div class="acts">
        <Button type="submit" variant={danger ? 'danger' : 'primary'} bench full
          >{confirmLabel}</Button
        >
        <Button variant="quiet" bench full data-cancel onclick={oncancel}>{cancelLabel}</Button>
      </div>
    </form>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: var(--z-dialog);
    background: var(--scrim);
  }

  .dialog {
    position: fixed;
    right: calc(8px + var(--safe-right));
    bottom: calc(8px + var(--safe-bottom));
    left: calc(8px + var(--safe-left));
    z-index: var(--z-dialog);
    max-width: 36rem;
    margin: 0 auto;
    padding: var(--space-5) var(--space-4) var(--space-4);
    border-radius: var(--radius-lg);
    background: var(--raised);
    box-shadow: var(--shadow-4);
    outline: none;
  }

  h2 {
    font: var(--fw-strong) var(--fs-lead) / var(--lh-snug) var(--font-text);
    letter-spacing: 0;
  }

  p {
    margin-top: 6px;
    color: var(--ink-2);
  }

  .extra {
    margin-top: var(--space-3);
  }

  .acts {
    display: grid;
    gap: 10px;
    margin-top: var(--space-5);
  }
</style>
