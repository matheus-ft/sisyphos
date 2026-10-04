<script lang="ts">
  import type { Exercise, Session, Template } from '../model';

  interface Props {
    sessions: Session[];
    templates: Template[];
    library: Exercise[];
    onstart: (template: Template | null) => void;
    onopen: (session: Session) => void;
  }
  let { sessions, templates, library, onstart, onopen }: Props = $props();

  const names = $derived(new Map(library.map((e) => [e.id, e.name])));
  const recent = $derived([...sessions].reverse().slice(0, 30));

  function summary(session: Session): string {
    const list = session.exercises.map((e) => names.get(e.exercise_id) ?? e.exercise_id);
    return list.length ? list.join(', ') : 'No exercises';
  }

  function day(date: string): string {
    return new Date(`${date}T12:00:00`).toLocaleDateString([], {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  }
</script>

<section>
  <button class="start" onclick={() => onstart(null)}>Start session</button>

  {#if templates.length}
    <h2>From a template</h2>
    <ul class="templates">
      {#each templates as template (template.id)}
        <li><button onclick={() => onstart(template)}>{template.name}</button></li>
      {/each}
    </ul>
  {/if}

  {#if recent.length}
    <h2>Recent</h2>
    <ul class="sessions">
      {#each recent as session (session.id)}
        <li>
          <button onclick={() => onopen(session)}>
            <span class="date">{day(session.date)}</span>
            <span class="what">{summary(session)}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .start {
    width: 100%;
    min-height: 3.5rem;
    border: 0;
    border-radius: 0.75rem;
    background: var(--accent);
    color: var(--surface);
    font: inherit;
    font-size: 1.15rem;
    font-weight: 600;
  }

  h2 {
    margin: 2rem 0 0.5rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li button {
    display: flex;
    gap: 0.75rem;
    width: 100%;
    min-height: 2.75rem;
    padding: 0.6rem 0;
    border: 0;
    border-bottom: 1px solid var(--line);
    background: none;
    color: var(--ink);
    font: inherit;
    text-align: left;
  }

  .date {
    flex: none;
    width: 6.5rem;
    color: var(--ink-2);
  }

  .what {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
