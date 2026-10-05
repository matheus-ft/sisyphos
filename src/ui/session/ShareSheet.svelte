<script lang="ts">
  /**
   * The share card as an image to keep, for where the browser cannot hand it to
   * the share sheet itself (a desktop, an older iPhone): press and hold the
   * image to save it, or take it through the link.
   */
  import Sheet from '../kit/Sheet.svelte';

  interface Props {
    open: boolean;
    blob: Blob | null;
    fileName: string;
    onclose: () => void;
  }
  let { open, blob, fileName, onclose }: Props = $props();

  // An object URL holds the PNG in memory until it is revoked.
  let url = $state<string | null>(null);
  $effect(() => {
    if (!open || !blob) {
      url = null;
      return;
    }
    const held = URL.createObjectURL(blob);
    url = held;
    return () => URL.revokeObjectURL(held);
  });
</script>

<Sheet {open} {onclose} label="Share card">
  {#if url}
    <div class="card">
      <img src={url} alt="The session as a card: date, boulder, totals and top sets" />
    </div>
    <p class="meta hint">Press and hold the image to save it.</p>
    <p class="save"><a href={url} download={fileName}>Or download it</a></p>
  {/if}
</Sheet>

<style>
  .card {
    max-width: 22rem;
    margin: var(--space-2) auto 0;
    border-radius: var(--radius-md);
    overflow: hidden;
    box-shadow: var(--shadow-2);
  }

  img {
    display: block;
    width: 100%;
    height: auto;
    /* iOS offers Save Image on a long press only where the callout is left on. */
    -webkit-touch-callout: default;
    user-select: auto;
  }

  .hint,
  .save {
    margin: var(--space-3) 0 0;
    text-align: center;
  }
</style>
