<script lang="ts">
  import type { Exercise } from '../model';

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
  <input
    bind:value={query}
    placeholder="+ exercise"
    autocapitalize="off"
    autocomplete="off"
    onfocus={() => (focused = true)}
    onblur={() => setTimeout(() => (focused = false), 200)}
  />
  {#if results.length || query.trim()}
    <ul>
      {#each results as exercise (exercise.id)}
        <li><button onclick={() => pick(exercise)}>{exercise.name}</button></li>
      {/each}
      {#if query.trim()}
        <li>
          <button class="create" onclick={() => oncreate(query.trim())}
            >new exercise “{query.trim()}”…</button
          >
        </li>
      {/if}
    </ul>
  {/if}
</div>

<style>
  .add {
    margin: 0.75rem 0;
  }

  input {
    width: 100%;
    border-bottom-style: dashed;
  }

  input::placeholder {
    color: var(--accent);
    opacity: 1;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  button {
    width: 100%;
    padding-left: 1rem;
    border-bottom: 1px solid var(--line);
    text-align: left;
  }

  .create {
    color: var(--accent);
  }
</style>
