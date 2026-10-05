<script lang="ts">
  import Boulder from './Boulder.svelte';
  import Button from './Button.svelte';

  /**
   * Nothing here yet: the hill with the boulder at its foot, a title, one line
   * of plain English and at most one quiet action.
   */
  interface Props {
    title: string;
    line: string;
    action?: { label: string; href?: string; onclick?: () => void };
  }
  let { title, line, action }: Props = $props();
</script>

<div class="empty">
  <Boulder size="empty" progress={0} label={null} />
  <h2>{title}</h2>
  <p>{line}</p>
  {#if action}
    <Button variant="quiet" href={action.href} onclick={action.onclick}>{action.label}</Button>
  {/if}
</div>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--space-8) var(--space-8) var(--space-6);
    text-align: center;
  }

  h2 {
    margin-top: var(--space-4);
    font: var(--fw-strong) 1.1875rem / var(--lh-snug) var(--font-text);
    letter-spacing: 0;
  }

  p {
    max-width: 30ch;
    margin: 4px 0 var(--space-4);
    font-size: var(--fs-meta);
    color: var(--ink-2);
  }
</style>
