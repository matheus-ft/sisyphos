<script lang="ts">
  import type { Exercise } from '../model';
  import Icon from './kit/Icon.svelte';

  /** A search over the library to add an exercise, or to create one it lacks. */
  interface Props {
    library: Exercise[];
    /** Shown before anything is typed, most recent first. */
    recentIds: string[];
    onpick: (exercise: Exercise) => void;
    /** Creates an exercise the library lacks, named from what was typed. */
    oncreate: (name: string) => void;
  }
  let { library, recentIds, onpick, oncreate }: Props = $props();

  let query = $state('');
  let focused = $state(false);

  /** Lowercased and stripped of accents, so "romanian" finds "Romanian" and "pes" finds "pés". */
  const fold = (text: string) =>
    text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();

  const results = $derived.by(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      if (!focused) return [];
      const byId = new Map(library.map((e) => [e.id, e]));
      return recentIds.flatMap((id) => byId.get(id) ?? []).slice(0, 6);
    }
    return library
      .filter((e) => words.every((w) => fold(`${e.name} ${e.id}`).includes(w)))
      .slice(0, 12);
  });

  function pick(exercise: Exercise): void {
    onpick(exercise);
    query = '';
  }
</script>

<div class="add">
  <label class="search">
    <Icon name="plus" size="sm" />
    <input
      bind:value={query}
      placeholder="Add an exercise"
      aria-label="Add an exercise"
      autocapitalize="off"
      autocomplete="off"
      onfocus={() => (focused = true)}
      onblur={() => setTimeout(() => (focused = false), 200)}
    />
  </label>
  {#if results.length || query.trim()}
    <ul class="group">
      {#each results as exercise (exercise.id)}
        <li class="row-link"><button onclick={() => pick(exercise)}>{exercise.name}</button></li>
      {/each}
      {#if query.trim()}
        <li class="row-link">
          <button class="create" onclick={() => oncreate(query.trim())}
            >New exercise “{query.trim()}”…</button
          >
        </li>
      {/if}
    </ul>
  {/if}
</div>

<style>
  .search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    border-bottom: var(--hairline) dashed var(--line-strong);
    color: var(--accent);
  }

  .search:focus-within {
    border-bottom: var(--stroke-strong) solid var(--accent);
  }

  input {
    flex: 1;
    border: 0;
  }

  input:focus {
    border: 0;
  }

  input::placeholder {
    color: var(--accent);
  }

  .group {
    margin: var(--space-2) 0 0;
  }

  .create {
    color: var(--accent);
  }
</style>
