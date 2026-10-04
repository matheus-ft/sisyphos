<script lang="ts">
  import type { Exercise, Session } from '../model';
  import { historyOf } from './session';

  interface Props {
    exercise: Exercise;
    sessions: Session[];
    onclose: () => void;
  }
  let { exercise, sessions, onclose }: Props = $props();

  const history = $derived(historyOf(exercise, sessions));

  function day(date: string): string {
    return new Date(`${date}T12:00:00`).toLocaleDateString([], {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
</script>

<article>
  <button class="link" onclick={onclose}>‹ back</button>
  <h1>{exercise.name}</h1>
  {#if history.length === 0}
    <p class="muted">Not logged yet.</p>
  {/if}
  <ul>
    {#each history as entry (entry.session.id)}
      <li>
        <span class="date">{day(entry.session.date)}</span>
        <span class="sets tabular">{entry.sets.join(', ')}</span>
      </li>
    {/each}
  </ul>
</article>

<style>
  h1 {
    font-size: 1.4rem;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: grid;
    grid-template-columns: 8.5rem 1fr;
    gap: 0.5rem;
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--line);
  }

  .date,
  .muted {
    color: var(--muted);
  }
</style>
