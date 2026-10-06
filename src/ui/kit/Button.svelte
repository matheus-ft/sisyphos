<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  /**
   * The app's buttons. `primary` is filled with the figure colour and wears
   * the potter's double ring: one per screen. `quiet` is outlined, `danger`
   * is filled red and names what it destroys, `link` is accent text for an
   * action in running text ("+ Set"). Inscription caps throughout, except a
   * link, which is set like the text around it unless `caps`.
   */
  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'quiet' | 'danger' | 'link';
    /** 56 tall instead of 44: for what is pressed with a sweaty thumb mid-session. */
    bench?: boolean;
    /** Takes the full width of its container. */
    full?: boolean;
    /** A link in inscription caps, as in banners and toasts. */
    caps?: boolean;
    /** Makes it a link to this address (a hash route) instead of a button. */
    href?: string;
    children: Snippet;
  }
  let {
    variant = 'quiet',
    bench = false,
    full = false,
    caps = false,
    href,
    children,
    class: extra,
    type = 'button',
    ...rest
  }: Props = $props();

  const classes = $derived([
    variant === 'link' ? 'button-link' : ['button', `button-${variant}`],
    { 'button-bench': bench, full, 'link-caps': caps },
    extra,
  ]);
</script>

{#if href}
  <a {href} class={classes} aria-label={rest['aria-label']}>{@render children()}</a>
{:else}
  <button {type} class={classes} {...rest}>{@render children()}</button>
{/if}

<style>
  a {
    text-decoration: none;
  }

  a.button-link {
    display: inline-flex;
    align-items: center;
  }

  .full {
    width: 100%;
  }

  .link-caps {
    font: var(--fw-display) var(--fs-label) / 1 var(--font-display);
    letter-spacing: var(--ls-caps);
    text-transform: uppercase;
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
