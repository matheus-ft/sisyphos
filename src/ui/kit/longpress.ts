/**
 * A long press, as a Svelte action: a touch held still, or a right click (the
 * context menu, which is also how Android reports a long press). It calls
 * `onpress` instead of letting the phone select text, and swallows the tap the
 * release would make, so holding a row does not also do what tapping it does.
 *
 * A field that can be typed in is left alone: holding one is how the phone
 * places the caret and pastes. A long-press zone inside another is its own;
 * the outer one does not fire for it.
 */

/** About what the phone itself waits before a long press. */
export const LONG_PRESS_MS = 450;
/** A finger that moves this far is scrolling, not holding. */
const SLOP = 10;

function typedIn(target: EventTarget | null): boolean {
  const field = target instanceof Element ? target.closest('input, textarea, select') : null;
  if (!field) return false;
  return !(field as HTMLInputElement).readOnly && !(field as HTMLInputElement).disabled;
}

export function longpress(node: HTMLElement, onpress: () => void) {
  let handler = onpress;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let from: { x: number; y: number } | null = null;
  /** Fired, so the click the release makes is not a tap. */
  let fired = false;
  node.dataset.longpress = '';

  const mine = (target: EventTarget | null) =>
    target instanceof Element && target.closest('[data-longpress]') === node;

  function cancel(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    from = null;
  }

  function fire(): void {
    cancel();
    fired = true;
    // The release's click comes in the same turn as its pointerup, wherever the
    // finger is by then (on what just opened, perhaps); after it, a click is a tap.
    window.addEventListener('pointerup', () => setTimeout(() => (fired = false)), { once: true });
    navigator.vibrate?.(10);
    handler();
  }

  function down(event: PointerEvent): void {
    fired = false;
    if (event.button !== 0 || !mine(event.target) || typedIn(event.target)) return;
    from = { x: event.clientX, y: event.clientY };
    timer = setTimeout(fire, LONG_PRESS_MS);
  }

  function moved(event: PointerEvent): void {
    if (from && Math.hypot(event.clientX - from.x, event.clientY - from.y) > SLOP) cancel();
  }

  function click(event: MouseEvent): void {
    if (!fired) return;
    fired = false;
    event.preventDefault();
    event.stopPropagation();
  }

  function contextmenu(event: MouseEvent): void {
    if (!mine(event.target) || typedIn(event.target)) return;
    event.preventDefault();
    // Android raises it at the same moment the timer fires: one press, one call.
    if (!fired) fire();
  }

  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', moved);
  node.addEventListener('pointerup', cancel);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('pointerleave', cancel);
  node.addEventListener('click', click, true);
  node.addEventListener('contextmenu', contextmenu);

  return {
    update(next: () => void) {
      handler = next;
    },
    destroy() {
      cancel();
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', moved);
      node.removeEventListener('pointerup', cancel);
      node.removeEventListener('pointercancel', cancel);
      node.removeEventListener('pointerleave', cancel);
      node.removeEventListener('click', click, true);
      node.removeEventListener('contextmenu', contextmenu);
    },
  };
}
