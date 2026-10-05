<script lang="ts">
  /**
   * The record mark: a sprig of five almond leaves on a curved stem, in gilded
   * --laurel-fill. It is the only record mark (there is no star), and it always
   * sits beside words that say "record", so it is decoration unless labelled.
   */
  interface Props {
    /** px; 16 in rows, 40 on the share card. */
    size?: number;
    label?: string;
  }
  let { size = 16, label }: Props = $props();

  const LEAVES: [number, number, number][] = [
    [4.4, 12.6, -100],
    [6.4, 10.6, -5],
    [8.2, 8.2, -100],
    [10, 5.8, -5],
    [11.2, 3.6, -52],
  ];
</script>

<svg
  class="laurel"
  viewBox="0 0 16 16"
  overflow="visible"
  style:width="{size}px"
  style:height="{size}px"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
>
  <path class="stem" d="M2.5 14.5C6 11.5 9 7.5 11.6 3.4" />
  {#each LEAVES as [x, y, r], i (i)}
    <path
      class="leaf"
      transform="translate({x} {y}) rotate({r})"
      d="M0 0C1.4-1.5 3.4-1.5 4.8 0C3.4 1.5 1.4 1.5 0 0Z"
    />
  {/each}
</svg>

<style>
  .laurel {
    flex: none;
  }

  .leaf {
    fill: var(--laurel-fill);
  }

  .stem {
    fill: none;
    stroke: var(--laurel-fill);
    stroke-width: 1.2;
    stroke-linecap: round;
  }
</style>
