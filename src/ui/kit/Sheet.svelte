<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { durationOf, easeOut } from './motion';

  /**
   * A bottom sheet over a scrim: the entry panel, pickers, anything that
   * belongs to the screen beneath and goes away again. It covers the tab bar
   * and keeps clear of the home indicator. Tapping the scrim or the handle,
   * dragging the handle down, or Escape closes it; the sheet only asks
   * (`onclose`), the owner decides by clearing `open`.
   */
  interface Props {
    open: boolean;
    onclose: () => void;
    /** The sheet's accessible name ("Bench press, set 2"). */
    label: string;
    /** A 1.5px accent top edge, for the entry panel: the set being entered. */
    accent?: boolean;
    children: Snippet;
  }
  let { open, onclose, label, accent = false, children }: Props = $props();

  let panel = $state<HTMLElement | null>(null);
  /** How far the handle has been dragged down, in px. */
  let drag = $state(0);
  let dragFrom: number | null = null;
  /** Dragged this far, the sheet closes when let go. */
  const CLOSE_AFTER = 80;

  $effect(() => {
    if (open && panel) panel.focus();
  });

  function keydown(event: KeyboardEvent): void {
    if (open && event.key === 'Escape') {
      event.stopPropagation();
      onclose();
    }
  }

  function down(event: PointerEvent): void {
    dragFrom = event.clientY;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent): void {
    if (dragFrom !== null) drag = Math.max(0, event.clientY - dragFrom);
  }

  function up(): void {
    // Only a press that began on the handle: a long press elsewhere can open
    // the sheet under the finger, and lifting it is not a tap on the handle.
    if (dragFrom === null) return;
    const dragged = drag;
    dragFrom = null;
    drag = 0;
    // A tap on the handle closes as surely as a drag.
    if (dragged > CLOSE_AFTER || dragged < 4) onclose();
  }
</script>

<svelte:window onkeydown={keydown} />

{#if open}
  <div
    class="scrim"
    transition:fade={{ duration: durationOf('--dur-base') }}
    onclick={onclose}
    aria-hidden="true"
  ></div>
  <div
    bind:this={panel}
    class="sheet"
    class:accent
    role="dialog"
    aria-modal="true"
    aria-label={label}
    tabindex="-1"
    style:transform={drag ? `translateY(${drag}px)` : undefined}
    transition:fly={{ y: 400, duration: durationOf('--dur-base'), easing: easeOut }}
  >
    <button
      class="handle"
      aria-label="Close"
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={() => {
        dragFrom = null;
        drag = 0;
      }}
    >
      <span></span>
    </button>
    {@render children()}
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: var(--z-sheet);
    background: var(--scrim);
  }

  .sheet {
    position: fixed;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: var(--z-sheet);
    max-height: calc(100dvh - var(--safe-top) - var(--space-8));
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 max(var(--gutter), var(--safe-right)) calc(var(--space-5) + var(--safe-bottom))
      max(var(--gutter), var(--safe-left));
    background: var(--raised);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    box-shadow: var(--shadow-3);
    outline: none;
  }

  .accent {
    border-top: var(--stroke) solid var(--accent);
  }

  /* The drawn handle is 36 × 4; the button around it is the full 44 to hit. */
  .handle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: var(--tap);
    margin-bottom: calc(-1 * var(--space-3));
    touch-action: none;
  }

  .handle span {
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: var(--line);
  }
</style>
