<script lang="ts">
  import Icon from '../kit/Icon.svelte';
  import Sheet from '../kit/Sheet.svelte';

  /** The exercises a Progress view can show, in a sheet: the one on screen is ticked. */
  interface Props {
    open: boolean;
    onclose: () => void;
    items: { id: string; name: string; meta: string }[];
    value: string | null;
    onpick: (id: string) => void;
  }
  let { open, onclose, items, value, onpick }: Props = $props();
</script>

<Sheet {open} {onclose} label="Choose an exercise">
  <h2 class="caps title">Exercise</h2>
  <ul class="group">
    {#each items as item (item.id)}
      <li class="row-link">
        <button
          aria-current={item.id === value ? 'true' : undefined}
          onclick={() => {
            onpick(item.id);
            onclose();
          }}
        >
          <span class="grow">
            <span class="t">{item.name}</span>
            <span class="s">{item.meta}</span>
          </span>
          {#if item.id === value}<Icon name="check" size="sm" label="Showing" />{/if}
        </button>
      </li>
    {/each}
  </ul>
</Sheet>

<style>
  .title {
    margin: var(--space-2) 0 var(--space-3);
    color: var(--ink-2);
  }

  /* Rows bring their own card edge; inside a sheet they sit flush with the gutter. */
  .group {
    margin: 0;
    box-shadow: none;
  }

  button[aria-current='true'] .t {
    font-weight: var(--fw-strong);
  }
</style>
