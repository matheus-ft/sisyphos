<script lang="ts">
  import type { Exercise, IsoDate, Session, Template } from '../model';

  interface Props {
    sessions: Session[];
    templates: Template[];
    library: Exercise[];
    /** Starts a session today, or on `date` for one logged after the fact. */
    onstart: (template: Template | null, date?: IsoDate) => void;
    onopen: (session: Session) => void;
    onopentemplate: (template: Template) => void;
    onnewtemplate: () => void;
  }
  let { sessions, templates, library, onstart, onopen, onopentemplate, onnewtemplate }: Props =
    $props();

  const names = $derived(new Map(library.map((e) => [e.id, e.name])));
  const recent = $derived([...sessions].reverse().slice(0, 30));

  function summary(session: Session): string {
    const list = session.exercises.map((e) => names.get(e.exercise_id) ?? e.exercise_id);
    return list.length ? list.join(', ') : 'no exercises';
  }

  function day(date: string): string {
    return new Date(`${date}T12:00:00`).toLocaleDateString([], {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  }

  function past(value: string): void {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) onstart(null, value);
  }
</script>

<article>
  <button class="start" onclick={() => onstart(null)}>Start session</button>
  <label class="past">
    or log a past session on
    <input
      type="date"
      aria-label="Past session date"
      onchange={(e) => past(e.currentTarget.value)}
    />
  </label>

  <h2>Templates</h2>
  <ul>
    {#each templates as template (template.id)}
      <li class="template">
        <button class="name" onclick={() => onopentemplate(template)}>{template.name}</button>
        <button class="link" onclick={() => onstart(template)}>start</button>
      </li>
    {/each}
  </ul>
  <button class="link" onclick={onnewtemplate}>+ template</button>

  {#if recent.length}
    <h2>Recent</h2>
    <ul>
      {#each recent as session (session.id)}
        <li>
          <button class="session" onclick={() => onopen(session)}>
            <span class="date">{day(session.date)}</span>
            <span class="what">{summary(session)}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</article>

<style>
  .start {
    width: 100%;
    border: 1px solid var(--ink);
    border-radius: 0.5rem;
    font-size: 1.1rem;
    font-weight: 600;
  }

  .past {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.5rem;
    font-size: 0.9rem;
    color: var(--muted);
  }

  .past input {
    font-size: 0.9rem;
  }

  h2 {
    margin: 2rem 0 0.25rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    border-bottom: 1px solid var(--line);
  }

  .template {
    display: flex;
    justify-content: space-between;
  }

  .name {
    flex: 1;
    text-align: left;
  }

  .session {
    display: flex;
    gap: 0.75rem;
    width: 100%;
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
