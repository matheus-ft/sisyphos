<script lang="ts" module>
  export type BannerKind = 'conflict' | 'info' | 'offline' | 'done';
</script>

<script lang="ts">
  import Icon, { type IconName } from './Icon.svelte';

  /**
   * A full-width notice: a 4px rule and a glyph in the state's colour, one line
   * of text and at most one action. A conflict banner cannot be dismissed; it
   * stays until no conflict is left.
   */

  interface Props {
    kind: BannerKind;
    text: string;
    /** A caps link at the right: "Review", "Ask". */
    action?: { label: string; href?: string; onclick?: () => void };
  }
  let { kind, text, action }: Props = $props();

  const GLYPH: Record<BannerKind, IconName> = {
    conflict: 'conflict',
    info: 'info',
    offline: 'cloud',
    done: 'check',
  };
</script>

<div class="banner {kind}" role="status">
  <Icon name={GLYPH[kind]} />
  <span class="grow">{text}</span>
  {#if action?.href}
    <a class="act" href={action.href}>{action.label}</a>
  {:else if action}
    <button class="act" onclick={action.onclick}>{action.label}</button>
  {/if}
</div>

<style>
  .banner {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 52px;
    padding: 6px 6px 6px 14px;
    border-left: 4px solid var(--warning);
    background: var(--warning-wash);
    color: var(--ink);
    font-size: var(--fs-meta);
    line-height: 1.3;
  }

  .banner :global(.ico) {
    color: var(--warning);
  }

  .info,
  .offline {
    border-left-color: var(--line-strong);
    background: var(--surface);
  }

  .info :global(.ico),
  .offline :global(.ico) {
    color: var(--ink-2);
  }

  .done {
    border-left-color: var(--success);
    background: var(--success-wash);
  }

  .done :global(.ico) {
    color: var(--success);
  }

  .grow {
    flex: 1;
  }

  .act {
    display: inline-flex;
    align-items: center;
    min-height: var(--tap);
    padding: 0 10px;
    color: var(--accent);
    font: var(--fw-display) var(--fs-label) / 1 var(--font-display);
    letter-spacing: var(--ls-caps);
    text-transform: uppercase;
    text-decoration: none;
  }
</style>
