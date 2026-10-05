<script lang="ts">
  import type { Exercise } from '../../model';
  import { app } from '../app.svelte';
  import EmptyState from '../kit/EmptyState.svelte';
  import ScreenHeader from '../kit/ScreenHeader.svelte';
  import { historyOf } from '../session';

  /** One exercise's history: every session that did it, newest first, with its sets. */
  interface Props {
    exercise: Exercise;
  }
  let { exercise }: Props = $props();

  const history = $derived(historyOf(exercise, app.current));

  function day(date: string): string {
    return new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
</script>

<ScreenHeader title={exercise.name} back={{ onclick: () => app.back({ name: 'history' }) }} />

{#if history.length === 0}
  <EmptyState title="Not logged yet" line="Its sets appear here once a session holds them." />
{:else}
  <ul class="group">
    {#each history as entry (entry.session.id)}
      <li class="row-link">
        <button onclick={() => app.openSession(entry.session)}>
          <span class="date">{day(entry.session.date)}</span>
          <span class="grow sets tabular">{entry.sets.join(', ')}</span>
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .date {
    flex: none;
    width: 8.5rem;
    font-size: var(--fs-meta);
    color: var(--muted);
  }

  .sets {
    font-weight: var(--fw-medium);
  }
</style>
