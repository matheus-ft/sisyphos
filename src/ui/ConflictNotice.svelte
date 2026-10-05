<script lang="ts">
  import { noticeCopy } from './conflicts';
  import Button from './kit/Button.svelte';
  import Icon from './kit/Icon.svelte';

  /**
   * The full-screen notice that two devices changed the same thing: how many,
   * that nothing was lost, and a way to Review them or leave them for Later.
   * The shell shows it after a sync that finds some and at every launch until
   * none are left, never during a session (conflicts.ts, noticeShown).
   */
  interface Props {
    count: number;
    onreview: () => void;
    onlater: () => void;
  }
  let { count, onreview, onlater }: Props = $props();

  const copy = $derived(noticeCopy(count));

  /** Lands a screen reader on the news, and the keyboard beside the actions. */
  function arrive(node: HTMLElement): void {
    node.focus({ preventScroll: true });
  }
</script>

<div
  class="notice"
  role="alertdialog"
  aria-modal="true"
  aria-labelledby="notice-title"
  aria-describedby="notice-line"
>
  <div class="body">
    <span class="mark"><Icon name="conflict" size={28} /></span>
    <h1 id="notice-title" tabindex="-1" use:arrive>{copy.title}</h1>
    <p id="notice-line" class="line">{copy.line}</p>
    <div class="acts">
      <Button variant="primary" full onclick={onreview}>Review</Button>
      <Button variant="link" onclick={onlater}>Later</Button>
    </div>
  </div>
</div>

<style>
  .notice {
    position: fixed;
    inset: 0;
    z-index: var(--z-takeover);
    overflow-y: auto;
    padding: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left);
    background: var(--raised);
  }

  .body {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    max-width: 40rem;
    margin: 0 auto;
    padding: var(--space-16) var(--gutter) var(--space-8);
  }

  .mark {
    display: inline-flex;
    margin-bottom: var(--space-4);
    color: var(--warning);
  }

  h1 {
    font: var(--fw-display) var(--fs-title) / var(--lh-snug) var(--font-display);
    letter-spacing: var(--ls-caps);
    text-transform: uppercase;
  }

  h1:focus {
    outline: none;
  }

  .line {
    margin-top: var(--space-3);
    color: var(--ink-2);
    font-size: var(--fs-lead);
    max-width: 30ch;
  }

  .acts {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-3);
    width: 100%;
    margin-top: var(--space-8);
  }

  /* Later is the quiet way out: centred under the one primary. */
  .acts :global(.button-link),
  .acts > :global(:last-child) {
    align-self: center;
  }
</style>
