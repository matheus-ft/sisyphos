<script lang="ts">
  import musclesCsv from '../../../library/muscles.csv?raw';
  import { parseMuscles } from '../../../library/parse';
  import type { Tier } from '../../../model';
  import { app } from '../../app.svelte';
  import EmptyState from '../../kit/EmptyState.svelte';
  import Icon from '../../kit/Icon.svelte';
  import ScreenHeader from '../../kit/ScreenHeader.svelte';
  import { routeHash } from '../../route';

  /** The exercise library: search it, open an exercise's history, create one it lacks. */

  let query = $state('');
  const muscleNames = new Map(parseMuscles(musclesCsv).map((m) => [m.id, m.name]));

  /** Lowercased and stripped of accents, so "romanian" finds "Romanian". */
  const fold = (text: string) =>
    text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();

  const results = $derived.by(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    return [...app.library]
      .filter((e) => words.every((w) => fold(`${e.name} ${e.id}`).includes(w)))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  const TIER: Record<Tier, string> = {
    comp: 'Main',
    high_spec: 'Variant',
    low_spec: 'Distant',
    acc: 'Accessory',
  };
</script>

<ScreenHeader title="Library" back={{ href: routeHash({ name: 'more', page: null }) }} />

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

{#if results.length === 0 && query.trim()}
  <EmptyState
    title="Nothing called “{query.trim()}”"
    line="Check the spelling, or create it."
    action={{ label: `Create “${query.trim()}”`, onclick: () => app.startCreating(query.trim()) }}
  />
{:else}
  <ul class="group">
    {#each results as exercise (exercise.id)}
      <li class="row-link">
        <button onclick={() => app.openExercise(exercise)}>
          <span class="grow">
            <span class="t">{exercise.name}</span>
            <span class="s"
              >{exercise.muscles.primary.map((m) => muscleNames.get(m) ?? m).join(', ')}</span
            >
          </span>
          <span class="tier">{TIER[exercise.tier]}</span>
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0 var(--gutter) var(--space-3);
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

  .tier {
    flex: none;
    padding: 2px 7px;
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-pill);
    font: var(--fw-display) 0.59375rem / 1.4 var(--font-display);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-2);
  }
</style>
