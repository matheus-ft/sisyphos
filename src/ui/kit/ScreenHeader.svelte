<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  /**
   * A screen's title: Cinzel, with an optional italic meta line beneath, a
   * back button before it for a screen opened from another, and controls at
   * the right (a segmented control, a link).
   */
  interface Props {
    title: string;
    meta?: string;
    /** A back button: a route to go to, or an action (usually `app.back`). */
    back?: { href?: string; onclick?: () => void; label?: string };
    /** `grc-Latn` for Agora, the one Greek title. */
    lang?: string;
    actions?: Snippet;
  }
  let { title, meta, back, lang, actions }: Props = $props();
</script>

<header class="screen-hd" class:with-back={back} class:with-actions={actions}>
  {#if back?.href}
    <a class="icon-btn back" href={back.href} aria-label={back.label ?? 'Back'}
      ><Icon name="back" /></a
    >
  {:else if back}
    <button class="icon-btn back" aria-label={back.label ?? 'Back'} onclick={back.onclick}
      ><Icon name="back" /></button
    >
  {/if}
  <div class="titles">
    <h1 {lang}>{title}</h1>
    {#if meta}<p class="meta">{meta}</p>{/if}
  </div>
  {#if actions}<div class="actions">{@render actions()}</div>{/if}
</header>

<style>
  .screen-hd {
    display: flex;
    align-items: flex-end;
    gap: var(--space-3);
    padding: var(--space-5) var(--gutter) var(--space-2);
  }

  .with-back {
    align-items: center;
    padding-left: var(--space-1);
    gap: var(--space-1);
  }

  .back {
    color: var(--ink);
  }

  .titles {
    flex: 1;
    min-width: 0;
  }

  /* On a narrow phone the controls drop under the title rather than over it:
     the title's own width decides whether they fit beside it. */
  .with-actions {
    flex-wrap: wrap;
  }

  .with-actions .titles {
    flex-basis: auto;
  }

  .meta {
    margin-top: 4px;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: none;
  }

  /* Beside a title a segmented control is set closer, so both fit a 375 phone. */
  .actions :global(.seg button) {
    padding-inline: var(--space-3);
  }
</style>
