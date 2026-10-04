<script lang="ts">
  import type { Exercise, Session } from '../model';
  import AddExercise from './AddExercise.svelte';
  import ExerciseCard from './ExerciseCard.svelte';
  import {
    addExercise,
    doneCount,
    formatSeconds,
    lastTime,
    lastUnit,
    parseNumber,
    setDate,
  } from './session';

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
    /** Starts a planned session. */
    onstart: () => void;
    /** Plans a new session repeating this one. */
    ondoagain: () => void;
    onhistory: (exercise: Exercise) => void;
    oncreate: (name: string) => void;
  }
  let {
    session,
    library,
    sessions,
    onchange,
    onfinish,
    onclose,
    ondelete,
    onsavetemplate,
    onstart,
    ondoagain,
    onhistory,
    oncreate,
  }: Props = $props();

  const byId = $derived(new Map(library.map((e) => [e.id, e])));
  const open = $derived(session.ended_at === null);
  const planned = $derived(session.started_at === null);
  const hasBodyweightWork = $derived(
    session.exercises.some((e) => byId.get(e.exercise_id)?.load_type === 'bw_plus'),
  );
  /** Exercises of recent sessions first: most days repeat a recent one. */
  const recentIds = $derived([
    ...new Set([...sessions].reverse().flatMap((s) => s.exercises.map((e) => e.exercise_id))),
  ]);

  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 1_000);
    return () => clearInterval(timer);
  });

  /**
   * When the last set was finished, for the rest timer. Kept for the tab, so a
   * reload between sets keeps counting; never saved, since nothing needs it.
   */
  const restKey = $derived(`sisyphos.rest.${session.id}`);
  let restFrom = $state<number | null>(null);
  $effect(() => {
    try {
      const kept = Number(sessionStorage.getItem(restKey));
      restFrom = kept > 0 ? kept : null;
    } catch {
      restFrom = null;
    }
  });
  const rest = $derived(
    open && !planned && restFrom !== null
      ? formatSeconds(Math.floor((now - restFrom) / 1000))
      : null,
  );

  /** Every change passes here: a set newly done starts the rest timer. */
  function change(next: Session): void {
    if (doneCount(next) > doneCount(session)) {
      restFrom = Date.now();
      try {
        sessionStorage.setItem(restKey, String(restFrom));
      } catch {
        // The timer still runs; it only forgets on reload.
      }
    }
    onchange(next);
  }

  /** How long it has run, or ran; nothing for a session planned or logged after the fact. */
  const duration = $derived.by(() => {
    if (session.started_at === null || session.time_precision === 'date_only') return '';
    const end = session.ended_at ? Date.parse(session.ended_at) : now;
    const minutes = Math.max(0, Math.floor((end - Date.parse(session.started_at)) / 60_000));
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  });

  function pick(exercise: Exercise): void {
    change(addExercise(session, exercise, () => crypto.randomUUID()));
  }

  function changeDate(value: string): void {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) change(setDate(session, value));
  }

  function setBodyweight(text: string): void {
    const kg = parseNumber(text);
    if (kg !== undefined) change({ ...session, bodyweight_kg: kg });
  }

  function setNotes(text: string): void {
    change({ ...session, notes: text.trim() === '' ? null : text });
  }

  function saveTemplate(): void {
    const name = prompt('Name the template', '');
    if (name?.trim()) onsavetemplate(name.trim());
  }
</script>

<article>
  <header>
    {#if !open || planned}<button class="link" onclick={onclose}>‹ back</button>{/if}
    <div class="when">
      <input
        class="date"
        type="date"
        aria-label="Date"
        value={session.date}
        onchange={(e) => changeDate(e.currentTarget.value)}
      />
      {#if planned}<span class="duration">planned</span>{/if}
      {#if duration}<span class="duration tabular">{duration}{open ? ' so far' : ''}</span>{/if}
    </div>
    {#if rest}<p class="rest tabular">rest {rest}</p>{/if}
  </header>

  {#if planned}
    <button class="primary" onclick={onstart}>Start</button>
  {/if}

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
      onchange={change}
      {onhistory}
    />
  {/each}

  <AddExercise {library} {recentIds} onpick={pick} {oncreate} />

  <textarea
    class="notes"
    rows="3"
    placeholder="notes…"
    value={session.notes ?? ''}
    onchange={(e) => setNotes(e.currentTarget.value)}></textarea>

  {#if planned}
    <div class="after">
      <button class="link" onclick={ondelete}>discard plan</button>
    </div>
  {:else if open}
    <button class="primary" onclick={onfinish}>Finish</button>
  {:else}
    <div class="after">
      <button class="link" onclick={ondoagain}>do this again</button>
      <button class="link" onclick={saveTemplate}>save as template</button>
      <button class="link" onclick={ondelete}>delete</button>
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

  .rest {
    margin: 0.25rem 0 0;
    font-size: 1.6rem;
    font-weight: 600;
  }

  .primary {
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
