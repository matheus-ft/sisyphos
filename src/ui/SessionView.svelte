<script lang="ts">
  import type { Exercise, Session } from '../model';
  import AddExercise from './AddExercise.svelte';
  import ExerciseCard from './ExerciseCard.svelte';
  import { addExercise, lastTime, lastUnit, parseNumber, setDate } from './session';

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
  const hasBodyweightWork = $derived(
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

  /** How long it has run, or ran; nothing for a session logged after the fact. */
  const duration = $derived.by(() => {
    if (session.time_precision === 'date_only') return '';
    const end = session.ended_at ? Date.parse(session.ended_at) : now;
    const minutes = Math.max(0, Math.round((end - Date.parse(session.started_at)) / 60_000));
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  });

  function pick(exercise: Exercise): void {
    onchange(addExercise(session, exercise, () => crypto.randomUUID()));
  }

  function changeDate(value: string): void {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) onchange(setDate(session, value));
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

<article>
  <header>
    {#if !open}<button class="link" onclick={onclose}>‹ back</button>{/if}
    <div class="when">
      <input
        class="date"
        type="date"
        aria-label="Date"
        value={session.date}
        onchange={(e) => changeDate(e.currentTarget.value)}
      />
      {#if duration}<span class="duration tabular">{duration}{open ? ' so far' : ''}</span>{/if}
    </div>
  </header>

  {#if hasBodyweightWork}
    <label class="bodyweight">
      bodyweight today
      <input
        inputmode="decimal"
        placeholder="kg"
        value={session.bodyweight_kg ?? ''}
        onchange={(e) => setBodyweight(e.currentTarget.value)}
      />
      kg
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

  <textarea
    class="notes"
    rows="3"
    placeholder="notes…"
    value={session.notes ?? ''}
    onchange={(e) => setNotes(e.currentTarget.value)}></textarea>

  {#if open}
    <button class="finish" onclick={onfinish}>Finish</button>
  {:else}
    <div class="after">
      <button class="link" onclick={saveTemplate}>save as template</button>
      <button class="link" onclick={ondelete}>delete session</button>
    </div>
  {/if}
</article>

<style>
  .when {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
  }

  .date {
    border-bottom-color: transparent;
    font-size: 1.4rem;
    font-weight: 600;
  }

  .duration {
    color: var(--muted);
  }

  .bodyweight {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--ink-2);
  }

  .bodyweight input {
    width: 4.5rem;
    font-size: 1.2rem;
    text-align: center;
  }

  .notes {
    display: block;
    width: 100%;
    margin-top: 1rem;
    resize: vertical;
  }

  .finish {
    width: 100%;
    margin-top: 2rem;
    border: 1px solid var(--ink);
    border-radius: 0.5rem;
    font-weight: 600;
  }

  .after {
    display: flex;
    gap: 1.5rem;
    margin-top: 1.5rem;
  }
</style>
