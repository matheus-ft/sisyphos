<script lang="ts">
  import { STONE_INCISIONS, STONE_PATH } from '../hill';

  /**
   * The boulder as a sync spinner: the stone turning once every 1.2 seconds.
   * It is a hint that something is happening, so reduced motion simply holds it
   * still, next to the words that say so.
   */
  interface Props {
    size?: number;
  }
  let { size = 18 }: Props = $props();
</script>

<svg class="stone" viewBox="-1.15 -1.15 2.3 2.3" width={size} height={size} aria-hidden="true">
  <path d={STONE_PATH} fill="var(--figure)" />
  {#each STONE_INCISIONS as d (d)}
    <path {d} fill="none" stroke="var(--ground)" stroke-width="0.09" stroke-linecap="round" />
  {/each}
</svg>

<style>
  .stone {
    flex: none;
    animation: turn 1.2s linear infinite;
  }

  @keyframes turn {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .stone {
      animation: none;
    }
  }
</style>
