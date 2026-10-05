/**
 * What shows over every screen: one toast at a time, and one dialog. Any
 * screen or action asks for them here; the shell's ToastHost and DialogHost
 * render them. They replace `window.confirm` and `window.prompt`, which an
 * installed iPhone web app shows as a bare system alert, if at all.
 */

export interface ToastInput {
  /** The confirmation, in words: "Set 2 saved". */
  message: string;
  /** Figures after the message, set heavier: "92.5 × 5 @ 8". */
  strong?: string;
  /** One action, usually Undo. Running it dismisses the toast. */
  action?: { label: string; run: () => void };
  /** ms on screen; 5 s by default. */
  duration?: number;
}

export interface Toast extends ToastInput {
  /** Each toast is new, so the host restarts its timer even for the same words. */
  id: number;
}

export interface ConfirmInput {
  /** A question: "Discard this session?" */
  title: string;
  /** What happens: "Its 9 sets are deleted from this device and, at the next sync, from the log." */
  body?: string;
  /** Names what the action does or destroys: "Discard session". */
  confirmLabel: string;
  /** Says what stays: "Keep it". */
  cancelLabel?: string;
  danger?: boolean;
}

export interface PromptInput {
  title: string;
  body?: string;
  /** The field's label: "Name". */
  label: string;
  value?: string;
  placeholder?: string;
  confirmLabel: string;
  cancelLabel?: string;
}

export type DialogRequest =
  | ({ kind: 'confirm'; resolve: (ok: boolean) => void } & ConfirmInput)
  | ({ kind: 'prompt'; resolve: (text: string | null) => void } & PromptInput);

export const overlays = $state<{ toast: Toast | null; dialog: DialogRequest | null }>({
  toast: null,
  dialog: null,
});

let next = 1;

/** Shows a toast, replacing any on screen: one at a time. */
export function showToast(input: ToastInput): void {
  overlays.toast = { ...input, id: next++ };
}

export function dismissToast(): void {
  overlays.toast = null;
}

/** Asks a yes-or-no question; resolves true only when the lifter confirms. */
export function confirmDialog(input: ConfirmInput): Promise<boolean> {
  return new Promise((resolve) => {
    cancelOpen();
    overlays.dialog = { kind: 'confirm', ...input, resolve };
  });
}

/** Asks for a line of text; resolves it trimmed, or null when cancelled or left empty. */
export function promptDialog(input: PromptInput): Promise<string | null> {
  return new Promise((resolve) => {
    cancelOpen();
    overlays.dialog = { kind: 'prompt', ...input, resolve };
  });
}

/** Answers the open dialog and closes it. */
export function answerDialog(answer: boolean | string | null): void {
  const open = overlays.dialog;
  if (!open) return;
  overlays.dialog = null;
  if (open.kind === 'confirm') open.resolve(answer === true);
  else open.resolve(typeof answer === 'string' && answer.trim() !== '' ? answer.trim() : null);
}

/** A second question replaces the first, which counts as cancelled. */
function cancelOpen(): void {
  if (overlays.dialog) answerDialog(overlays.dialog.kind === 'confirm' ? false : null);
}
