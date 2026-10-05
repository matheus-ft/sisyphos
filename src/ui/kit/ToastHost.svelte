<script lang="ts">
  import { fly } from 'svelte/transition';
  import { dismissToast, overlays } from '../overlays.svelte';
  import { durationOf, easeOut } from './motion';
  import Toast from './Toast.svelte';

  /**
   * Shows the toast asked for in overlays.svelte.ts, above the tab bar or at
   * the foot of the screen, for its duration. The shell sets `--dock`, the
   * height of whatever is docked at the bottom.
   */
  const DEFAULT_MS = 5_000;

  $effect(() => {
    const toast = overlays.toast;
    if (!toast) return;
    const timer = setTimeout(() => {
      if (overlays.toast?.id === toast.id) dismissToast();
    }, toast.duration ?? DEFAULT_MS);
    return () => clearTimeout(timer);
  });

  function run(action: () => void): void {
    dismissToast();
    action();
  }
</script>

{#if overlays.toast}
  {@const toast = overlays.toast}
  {#key toast.id}
    <div
      class="host"
      transition:fly={{ y: 24, duration: durationOf('--dur-fast'), easing: easeOut }}
    >
      <Toast
        message={toast.message}
        strong={toast.strong}
        action={toast.action
          ? { label: toast.action.label, run: () => run(toast.action!.run) }
          : undefined}
      />
    </div>
  {/key}
{/if}

<style>
  .host {
    position: fixed;
    right: calc(12px + var(--safe-right));
    bottom: calc(var(--dock, var(--safe-bottom)) + 12px);
    left: calc(12px + var(--safe-left));
    z-index: var(--z-toast);
    max-width: 36rem;
    margin: 0 auto;
  }
</style>
