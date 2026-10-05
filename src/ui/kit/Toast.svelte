<script lang="ts">
  /**
   * A one-line confirmation, with at most one action (Undo): a figure-coloured
   * card at the foot of the screen, over the rest takeover. The shell's
   * ToastHost places it and times it; this only draws it.
   */
  interface Props {
    message: string;
    strong?: string;
    action?: { label: string; run: () => void };
  }
  let { message, strong, action }: Props = $props();
</script>

<div class="toast" role="status">
  <span class="grow"
    >{message}{#if strong}
      · <b class="tabular">{strong}</b>{/if}</span
  >
  {#if action}
    <button class="act" onclick={action.run}>{action.label}</button>
  {/if}
</div>

<style>
  .toast {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 52px;
    padding: 4px 4px 4px 16px;
    border-radius: var(--radius-md);
    background: var(--figure);
    color: var(--on-figure);
    box-shadow: var(--shadow-4);
    font-size: var(--fs-meta);
  }

  .grow {
    flex: 1;
  }

  b {
    font: var(--fw-num) 1rem var(--font-num);
  }

  .act {
    padding: 0 14px;
    color: var(--figure-accent);
    font: var(--fw-display) var(--fs-label) / 1 var(--font-display);
    letter-spacing: var(--ls-caps);
    text-transform: uppercase;
  }
</style>
