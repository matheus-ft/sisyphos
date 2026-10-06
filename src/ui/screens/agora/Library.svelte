<script lang="ts">
  import musclesCsv from '../../../library/muscles.csv?raw';
  import { parseMuscles } from '../../../library/parse';
  import type { Exercise, LoadType, Tier } from '../../../model';
  import PickSheet from '../../agora/PickSheet.svelte';
  import { app } from '../../app.svelte';
  import Button from '../../kit/Button.svelte';
  import Chip from '../../kit/Chip.svelte';
  import EmptyState from '../../kit/EmptyState.svelte';
  import Icon from '../../kit/Icon.svelte';
  import ScreenHeader from '../../kit/ScreenHeader.svelte';
  import Sheet from '../../kit/Sheet.svelte';
  import {
    canCreate,
    filterLibrary,
    isFiltered,
    LIFT_FILTERS,
    muscleLine,
    NO_FILTER,
    TIER_LABEL,
    TIERS,
    type LibraryFilter,
  } from '../../librarySearch';
  import { routeHash } from '../../route';

  /**
   * The exercise library: search it, narrow it by base lift, tier and muscle,
   * open an exercise to see it and change it, or create one it lacks.
   */

  const muscles = parseMuscles(musclesCsv);
  const muscleNames = new Map(muscles.map((m) => [m.id, m.name]));

  let filter = $state<LibraryFilter>({ ...NO_FILTER });
  let picker = $state<'lift' | 'tier' | 'muscle' | null>(null);
  let shown = $state<Exercise | null>(null);

  const results = $derived(filterLibrary(app.library, filter));
  const typed = $derived(filter.query.trim());
  const offerCreate = $derived(canCreate(app.library, filter.query));

  const liftLabel = $derived(LIFT_FILTERS.find((o) => o.value === filter.lift)?.label ?? 'Lift');
  const tierLabel = $derived(filter.tier ? TIER_LABEL[filter.tier] : 'Tier');
  const muscleLabel = $derived(filter.muscle ? (muscleNames.get(filter.muscle) ?? '') : 'Muscle');

  const LOAD: Record<LoadType, string> = {
    external: 'a weight',
    bw_plus: 'bodyweight plus a weight',
    none: 'nothing: timed',
  };

  const names = (ids: string[]) => ids.map((m) => muscleNames.get(m) ?? m).join(', ');

  function change(exercise: Exercise): void {
    shown = null;
    app.editing = exercise;
  }

  function history(exercise: Exercise): void {
    shown = null;
    app.openExercise(exercise);
  }
</script>

<ScreenHeader
  title="Library"
  meta="{app.library.length} exercises"
  back={{ href: routeHash({ name: 'more', page: null }) }}
/>

<label class="search">
  <Icon name="search" />
  <input
    bind:value={filter.query}
    placeholder="Search exercises"
    aria-label="Search exercises"
    autocapitalize="off"
    autocomplete="off"
    enterkeyhint="search"
  />
</label>

<div class="chips" role="group" aria-label="Filters">
  <Chip
    chevron
    pressed={filter.lift !== null}
    label="lift"
    onclick={() => (picker = 'lift')}
    onclear={() => (filter.lift = null)}>{liftLabel}</Chip
  >
  <Chip
    chevron
    pressed={filter.tier !== null}
    label="tier"
    onclick={() => (picker = 'tier')}
    onclear={() => (filter.tier = null)}>{tierLabel}</Chip
  >
  <Chip
    chevron
    pressed={filter.muscle !== null}
    label="muscle"
    onclick={() => (picker = 'muscle')}
    onclear={() => (filter.muscle = null)}>{muscleLabel}</Chip
  >
</div>

{#if results.length === 0}
  {#if typed && offerCreate}
    <EmptyState
      title="Nothing called “{typed}”"
      line="Check the spelling, or create it."
      action={{ label: `Create “${typed}”`, onclick: () => app.startCreating(typed) }}
    />
  {:else}
    <EmptyState
      title="No exercise matches"
      line="Loosen a filter to see more."
      action={isFiltered(filter)
        ? { label: 'Clear filters', onclick: () => (filter = { ...NO_FILTER }) }
        : undefined}
    />
  {/if}
{:else}
  <ul class="group">
    {#each results as exercise (exercise.id)}
      <li class="row-link">
        <button onclick={() => (shown = exercise)}>
          <span class="grow">
            <span class="t">{exercise.name}</span>
            <span class="s">{muscleLine(exercise, muscleNames)}</span>
          </span>
          <span class="tier">{TIER_LABEL[exercise.tier]}</span>
        </button>
      </li>
    {/each}
    {#if typed && offerCreate}
      <li class="row-link">
        <button onclick={() => app.startCreating(typed)}>
          <span class="grow t create">+ Create “{typed}”</span>
        </button>
      </li>
    {/if}
  </ul>
{/if}

<PickSheet
  open={picker === 'lift'}
  title="Base lift"
  anyLabel="Any lift"
  options={LIFT_FILTERS}
  value={filter.lift}
  onpick={(value) => {
    filter.lift = value;
    picker = null;
  }}
  onclose={() => (picker = null)}
/>
<PickSheet
  open={picker === 'tier'}
  title="Tier"
  anyLabel="Any tier"
  options={TIERS.map((value: Tier) => ({ value, label: TIER_LABEL[value] }))}
  value={filter.tier}
  onpick={(value) => {
    filter.tier = value;
    picker = null;
  }}
  onclose={() => (picker = null)}
/>
<PickSheet
  open={picker === 'muscle'}
  title="Muscle"
  anyLabel="Any muscle"
  options={muscles.map((m) => ({ value: m.id, label: m.name }))}
  value={filter.muscle}
  onpick={(value) => {
    filter.muscle = value;
    picker = null;
  }}
  onclose={() => (picker = null)}
/>

<Sheet open={shown !== null} onclose={() => (shown = null)} label={shown?.name ?? 'Exercise'}>
  {#if shown}
    <div class="detail">
      <div class="head">
        <h2>{shown.name}</h2>
        <span class="tier">{TIER_LABEL[shown.tier]}</span>
      </div>
      <dl>
        <dt class="caps">Serves</dt>
        <dd>{shown.base_lift ?? 'no competition lift'}</dd>
        <dt class="caps">Primary</dt>
        <dd>{names(shown.muscles.primary)}</dd>
        {#if shown.muscles.aux.length}
          <dt class="caps">Also works</dt>
          <dd>{names(shown.muscles.aux)}</dd>
        {/if}
        <dt class="caps">Loaded by</dt>
        <dd>
          {LOAD[shown.load_type]}, usually in {shown.default_unit}{shown.unilateral
            ? ', one side at a time'
            : ''}
        </dd>
      </dl>
      <Button variant="quiet" full bench onclick={() => change(shown!)}>Change this exercise</Button
      >
      <p class="meta note">
        It is saved on this phone at once, and a proposal to change it in the shared library opens
        on github.com for you to submit.
      </p>
      <Button variant="link" onclick={() => history(shown!)}>See its history</Button>
    </div>
  {/if}
</Sheet>

<style>
  .search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-2) var(--gutter) var(--space-1);
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

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: var(--space-2) var(--gutter) var(--space-3);
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

  .create {
    color: var(--accent);
  }

  .detail {
    display: grid;
    gap: var(--space-3);
    padding-top: var(--space-2);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  h2 {
    font: var(--fw-display) var(--fs-name) / var(--lh-snug) var(--font-display);
    letter-spacing: var(--ls-name);
    text-transform: uppercase;
  }

  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-2) var(--space-4);
    margin: 0;
  }

  dt {
    padding-top: 4px;
    color: var(--ink-2);
  }

  dd {
    margin: 0;
  }

  .note {
    margin: 0;
  }
</style>
