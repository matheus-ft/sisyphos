<script lang="ts">
  import type { Exercise } from '../../model';
  import { matchExercises } from '../history-view';
  import Icon from '../kit/Icon.svelte';
  import Sheet from '../kit/Sheet.svelte';

  /** The filter's picker: the exercises that appear in the log, searchable. */
  interface Props {
    open: boolean;
    exercises: readonly Exercise[];
    /** The exercise now filtered on, or null for all. */
    selected: string | null;
    onpick: (exerciseId: string | null) => void;
    onclose: () => void;
  }
  let { open, exercises, selected, onpick, onclose }: Props = $props();

  let query = $state('');
  const found = $derived(matchExercises(exercises, query));

  // A reopened picker starts fresh, not on the last search.
  $effect(() => {
    if (!open) query = '';
  });
</script>

<Sheet {open} {onclose} label="Filter by exercise">
  <div class="picker">
    <h2 class="caps">Exercise</h2>
    <label class="search">
      <Icon name="search" size="sm" />
      <input
        type="search"
        placeholder="Search exercises"
        aria-label="Search exercises"
        autocomplete="off"
        bind:value={query}
      />
    </label>
    <ul class="group" role="list">
      {#if query.trim() === ''}
        <li class="row-link">
          <button aria-pressed={selected === null} onclick={() => onpick(null)}>
            <span class="grow t">All exercises</span>
            {#if selected === null}<Icon name="check" size="sm" />{/if}
          </button>
        </li>
      {/if}
      {#each found as exercise (exercise.id)}
        <li class="row-link">
          <button aria-pressed={selected === exercise.id} onclick={() => onpick(exercise.id)}>
            <span class="grow t">{exercise.name}</span>
            {#if selected === exercise.id}<Icon name="check" size="sm" />{/if}
          </button>
        </li>
      {/each}
    </ul>
    {#if found.length === 0}
      <p class="none meta">Nothing called “{query.trim()}” in your log.</p>
    {/if}
  </div>
</Sheet>

<style>
  /* Tall from the start, so filtering the list does not make the sheet jump. */
  .picker {
    min-height: 60dvh;
  }

  h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--fs-label);
    color: var(--ink-2);
  }

  .search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
    color: var(--muted);
  }

  .search input {
    flex: 1;
    min-width: 0;
  }

  .group {
    margin: 0;
  }

  .group button[aria-pressed='true'] {
    font-weight: var(--fw-strong);
  }

  .none {
    margin-top: var(--space-4);
    text-align: center;
  }
</style>
