<script lang="ts">
  import type { Exercise, Session } from '../model';
  import AddExercise from './AddExercise.svelte';
  import ExerciseCard from './ExerciseCard.svelte';
  import { addExercise, lastTime, lastUnit, parseNumber } from './session';

  interface Props {
    session: Session;
    library: Exercise[];
    /** Every session, for what each exercise did last time. */
    sessions: Session[];
    onchange: (next: Session) => void;
    onfinish: () => void;
    onclose: () => void;
    ondelete: () => void;
    onsavetemplate: (name: string) => void;
  }
  let { session, library, sessions, onchange, onfinish, onclose, ondelete, onsavetemplate }: Props =
    $props();

  const byId = $derived(new Map(library.map((e) => [e.id, e])));
  const open = $derived(session.ended_at === null);
  const needsBodyweight = $derived(
    session.exercises.some((e) => byId.get(e.exercise_id)?.load_type === 'bw_plus'),
  );
  /** Exercises of recent sessions first: most days repeat a recent one. */
  const recentIds = $derived([
    ...new Set([...sessions].reverse().flatMap((s) => s.exercises.map((e) => e.exercise_id))),
  ]);

  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(timer);
  });

  const elapsed = $derived.by(() => {
    const end = session.ended_at ? Date.parse(session.ended_at) : now;
    const minutes = Math.max(0, Math.round((end - Date.parse(session.started_at)) / 60_000));
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  });

  const day = $derived(
    new Date(`${session.date}T12:00:00`).toLocaleDateString([], {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }),
  );

  function pick(exercise: Exercise): void {
    onchange(addExercise(session, exercise, () => crypto.randomUUID()));
  }

  function setBodyweight(text: string): void {
    const kg = parseNumber(text);
    if (kg !== undefined) onchange({ ...session, bodyweight_kg: kg });
  }

  function setNotes(text: string): void {
    onchange({ ...session, notes: text.trim() === '' ? null : text });
  }

  function saveTemplate(): void {
    const name = prompt('Name the template', '');
    if (name?.trim()) onsavetemplate(name.trim());
  }
</script>

<section>
  <header>
    {#if !open}<button class="back" onclick={onclose}>‹ Sessions</button>{/if}
    <h1>{day}</h1>
    <p class="meta tabular">{open ? `${elapsed} so far` : elapsed}</p>
  </header>

  {#if needsBodyweight}
    <label class="bodyweight">
      Bodyweight today, kg
      <input
        inputmode="decimal"
        value={session.bodyweight_kg ?? ''}
        onchange={(e) => setBodyweight(e.currentTarget.value)}
      />
    </label>
  {/if}

  {#each session.exercises as instance (instance.id)}
    {@const exercise = byId.get(instance.exercise_id)}
    <ExerciseCard
      {session}
      {instance}
      {exercise}
      last={exercise ? lastTime(exercise, sessions, session.id) : null}
      unit={exercise ? lastUnit(exercise, sessions, session.id) : 'kg'}
      {onchange}
    />
  {/each}

  <AddExercise {library} {recentIds} onpick={pick} />

  <label class="notes">
    Notes
    <textarea rows="3" value={session.notes ?? ''} onchange={(e) => setNotes(e.currentTarget.value)}
    ></textarea>
  </label>

  {#if open}
    <button class="finish" onclick={onfinish}>Finish session</button>
  {:else}
    <div class="after">
      <button onclick={saveTemplate}>Save as template</button>
      <button class="delete" onclick={ondelete}>Delete session</button>
    </div>
  {/if}
</section>

<style>
  header {
    margin-bottom: 1rem;
  }

  h1 {
    margin: 0;
    font-size: 1.4rem;
  }

  .meta {
    margin: 0.2rem 0 0;
    color: var(--muted);
  }

  .back {
    margin: 0 0 0.5rem;
    padding: 0.5rem 0;
    min-height: 2.75rem;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
  }

  label {
    display: grid;
    gap: 0.3rem;
    margin: 1rem 0;
    font-size: 0.9rem;
    color: var(--ink-2);
  }

  input,
  textarea {
    min-height: 2.75rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--line);
    border-radius: 0.5rem;
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-size: 1rem;
  }

  .bodyweight input {
    width: 7rem;
  }

  .finish {
    width: 100%;
    min-height: 3.25rem;
    margin-top: 2rem;
    border: 1px solid var(--accent);
    border-radius: 0.75rem;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: 1.05rem;
    font-weight: 600;
  }

  .after {
    display: flex;
    gap: 0.5rem;
    margin-top: 2rem;
  }

  .after button {
    min-height: 2.75rem;
    padding: 0 1rem;
    border: 1px solid var(--line);
    border-radius: 0.5rem;
    background: var(--surface);
    color: var(--ink);
    font: inherit;
  }

  .after .delete {
    color: var(--accent);
  }
</style>
