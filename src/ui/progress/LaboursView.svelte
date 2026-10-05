<script lang="ts">
  import { app } from '../app.svelte';
  import { recordedExercises, recordRows, resolvePick, shortDay } from '../athloi';
  import Chip from '../kit/Chip.svelte';
  import EmptyState from '../kit/EmptyState.svelte';
  import Laurel from '../kit/Laurel.svelte';
  import ExercisePicker from './ExercisePicker.svelte';

  /** The best weight at each rep count from 1 to 10, from sessions and by hand together. */
  interface Props {
    today: string;
    picked: string | null;
    onpick: (id: string) => void;
  }
  let { today, picked, onpick }: Props = $props();

  let choosing = $state(false);

  const choices = $derived(recordedExercises(app.records, app.library));
  const chosen = $derived(resolvePick(choices, picked));
  const rows = $derived(chosen ? recordRows(app.records, chosen.exercise.id, today) : []);

  /** A session record opens its session; a hand-entered one is edited under Agora's Lifter. */
  function open(sessionId: string | null, manual: boolean): void {
    if (manual) {
      app.go({ name: 'more', page: 'lifter' });
      return;
    }
    const session = app.current.find((s) => s.id === sessionId);
    if (session) app.openSession(session);
  }
</script>

{#if !chosen}
  <EmptyState title="No records yet" line="Records appear as you log sets of 1 to 10 reps." />
{:else}
  <div class="controls">
    <Chip chevron onclick={() => (choosing = true)}>{chosen.exercise.name}</Chip>
    <span class="meta">best weight for each rep count</span>
  </div>

  <ul class="card rows">
    {#each rows as row (row.reps)}
      {@const actionable = row.sessionId !== null || row.manual}
      <li class:recent={row.recent} class:none={row.weight === null}>
        {#snippet inner()}
          <span class="reps">
            <span class="n figure-num">{row.reps}</span>
            <span class="caps">{row.reps === 1 ? 'rep' : 'reps'}</span>
          </span>
          {#if row.weight !== null}
            <span class="weight">
              {#if row.recent}<Laurel size={16} />{/if}
              <span class="figure-num w">{row.weight}</span>
              <span class="unit">kg</span>
            </span>
            <span class="when meta">
              <span>{row.date}</span>
              <span>{row.source}</span>
            </span>
          {:else}
            <span class="empty meta">no record yet</span>
          {/if}
        {/snippet}
        {#if actionable}
          <button
            aria-label="{row.spoken}. {row.manual ? 'Edit under Lifter' : 'Open the session'}"
            onclick={() => open(row.sessionId, row.manual)}
          >
            {@render inner()}
          </button>
        {:else}
          <div class="plain" role="group" aria-label={row.spoken}>{@render inner()}</div>
        {/if}
      </li>
    {/each}
  </ul>
  <p class="foot">
    {#if rows.some((r) => r.manual)}Records marked “by hand” were entered under Lifter in More.{/if}
  </p>

  <ExercisePicker
    open={choosing}
    onclose={() => (choosing = false)}
    value={chosen.exercise.id}
    {onpick}
    items={choices.map((c) => ({
      id: c.exercise.id,
      name: c.exercise.name,
      meta: `${c.count} ${c.count === 1 ? 'record' : 'records'} · latest ${shortDay(c.last)}`,
    }))}
  />
{/if}

<style>
  .controls {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin: var(--space-3) var(--gutter) var(--space-3);
  }

  .rows {
    margin: 0 12px;
    padding: 0;
    overflow: hidden;
    list-style: none;
  }

  li + li {
    border-top: var(--hairline) solid var(--line);
  }

  li.recent {
    background: var(--laurel-wash);
  }

  button,
  .plain {
    display: grid;
    grid-template-columns: 44px 1fr auto;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 52px;
    padding: 4px var(--space-4) 4px var(--space-3);
    text-align: left;
    color: inherit;
  }

  button:active {
    background: var(--sunken);
  }

  .reps {
    display: grid;
    justify-items: center;
    gap: 2px;
  }

  .n {
    font-size: 1.0625rem;
    line-height: 1;
  }

  .reps .caps {
    font-size: 0.5625rem;
    color: var(--muted);
  }

  .weight {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
  }

  .weight :global(.laurel) {
    align-self: center;
  }

  .w {
    font-size: 1.375rem;
    line-height: 1;
  }

  .unit {
    font-style: italic;
    color: var(--muted);
    font-size: var(--fs-meta);
  }

  .when {
    display: grid;
    justify-items: end;
    font-size: 0.8125rem;
    line-height: 1.25;
  }

  li.none .empty {
    grid-column: 2 / 4;
    color: var(--muted);
  }

  .foot {
    margin: var(--space-2) var(--gutter) 0;
    font: italic 0.875rem / 1.35 var(--font-text);
    color: var(--muted);
  }
</style>
