<script lang="ts">
  import type { Exercise } from '../../model';
  import Icon from '../kit/Icon.svelte';
  import Sheet from '../kit/Sheet.svelte';
  import { filterLibrary, NO_FILTER, TIER_LABEL } from '../librarySearch';

  /** Pick one exercise from the library by searching it, in a bottom sheet. */
  interface Props {
    open: boolean;
    library: readonly Exercise[];
    current: string | null;
    onpick: (exercise: Exercise) => void;
    onclose: () => void;
  }
  let { open, library, current, onpick, onclose }: Props = $props();

  let query = $state('');
  const results = $derived(filterLibrary(library, { ...NO_FILTER, query }).slice(0, 40));

  $effect(() => {
    if (!open) query = '';
  });
</script>

<Sheet {open} {onclose} label="Pick an exercise">
  <label class="search">
    <Icon name="search" />
    <input
      bind:value={query}
      placeholder="Search exercises"
      aria-label="Search exercises"
      autocapitalize="off"
      autocomplete="off"
    />
  </label>
  {#if results.length === 0}
    <p class="meta none">Nothing called “{query.trim()}”.</p>
  {:else}
    <ul class="group list">
      {#each results as exercise (exercise.id)}
        <li class="row-link">
          <button onclick={() => onpick(exercise)}>
            <span class="grow t">{exercise.name}</span>
            {#if exercise.id === current}
              <span class="meta now">current</span>
            {:else}
              <span class="meta">{TIER_LABEL[exercise.tier].toLowerCase()}</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</Sheet>

<style>
  .search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-2) 0 var(--space-3);
    border-bottom: var(--hairline) solid var(--line-strong);
    color: var(--muted);
  }

  .search:focus-within {
    border-bottom: var(--stroke-strong) solid var(--accent);
  }

  .search input {
    flex: 1;
    border: 0;
    color: var(--ink);
  }

  .list {
    margin: 0;
  }

  .now {
    color: var(--accent);
  }

  .none {
    padding: var(--space-4) 0;
  }
</style>
