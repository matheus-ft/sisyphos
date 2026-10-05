<script lang="ts">
  import type { Exercise, PerformedSet, Session } from '../../model';
  import AddExercise from '../AddExercise.svelte';
  import { app } from '../app.svelte';
  import { entryPrefill, plateStep } from '../entry';
  import { formatMinutes, longDate, programLabel, sessionMinutes } from '../format';
  import { sessionTally } from '../hill';
  import Boulder from '../kit/Boulder.svelte';
  import Button from '../kit/Button.svelte';
  import Icon from '../kit/Icon.svelte';
  import Meander from '../kit/Meander.svelte';
  import { promptDialog } from '../overlays.svelte';
  import {
    addExercise,
    doneCount,
    editSet,
    formatSet,
    lastTime,
    lastUnit,
    measureOf,
    parseNumber,
    setDate,
    skipSet,
    targetsOf,
    type SetEdit,
  } from '../session';
  import EntryPanel from './EntryPanel.svelte';
  import ExerciseCard from './ExerciseCard.svelte';
  import RestTakeover from './RestTakeover.svelte';

  /**
   * A session on screen: running, planned ahead, or past. A focused mode, with
   * its own back and no tab bar. Its header carries the boulder; the sets are
   * typed into their rows or saved from the entry panel; saving a working set
   * opens the rest takeover.
   */
  interface Props {
    session: Session;
  }
  let { session }: Props = $props();

  const change = (next: Session) => {
    noteRest(next);
    void app.save(next);
  };

  const byId = $derived(new Map(app.library.map((e) => [e.id, e])));
  const open = $derived(session.ended_at === null);
  const planned = $derived(session.started_at === null);
  const running = $derived(open && !planned);
  const hasBodyweightWork = $derived(
    session.exercises.some((e) => byId.get(e.exercise_id)?.load_type === 'bw_plus'),
  );
  /** Exercises of recent sessions first: most days repeat a recent one. */
  const recentIds = $derived([
    ...new Set([...app.sessions].reverse().flatMap((s) => s.exercises.map((e) => e.exercise_id))),
  ]);
  const tally = $derived(sessionTally(session, app.sessions));
  const label = $derived(programLabel(session.label));
  /** The set being entered: the first one still pending, in order. */
  const active = $derived.by(() => {
    if (!open) return null;
    for (const e of session.exercises) {
      const set = e.performed.find((s) => s.state === 'pending');
      if (set) return { instance: e, set };
    }
    return null;
  });

  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 1_000);
    return () => clearInterval(timer);
  });
  const minutes = $derived(sessionMinutes(session, now));

  // --- rest -------------------------------------------------------------------------

  /**
   * When the last set was finished. Kept for the tab, so a reload between sets
   * keeps counting; never saved, since rest is not analysed.
   */
  const restKey = $derived(`sisyphos.rest.${session.id}`);
  let restFrom = $state<number | null>(null);
  let restOpen = $state(false);
  let chime = $state(false);
  let awake = $state(false);
  $effect(() => {
    try {
      const kept = Number(sessionStorage.getItem(restKey));
      restFrom = kept > 0 ? kept : null;
    } catch {
      restFrom = null;
    }
  });
  const restClock = $derived.by(() => {
    if (!running || restFrom === null) return null;
    const s = Math.max(0, Math.floor((now - restFrom) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  });

  /** A set newly done starts the rest; a working set also opens the takeover. */
  function noteRest(next: Session): void {
    if (!running || doneCount(next) <= doneCount(session)) return;
    restFrom = Date.now();
    try {
      sessionStorage.setItem(restKey, String(restFrom));
    } catch {
      // The timer still runs; it only forgets on reload.
    }
    const working = (s: Session) =>
      s.exercises.reduce(
        (n, e) => n + e.performed.filter((p) => p.state === 'done' && !p.is_warmup).length,
        0,
      );
    if (working(next) > working(session)) restOpen = true;
  }

  function skipRest(): void {
    restFrom = null;
    restOpen = false;
    try {
      sessionStorage.removeItem(restKey);
    } catch {
      // Nothing kept, nothing to forget.
    }
  }

  const restContext = $derived.by(() => {
    const last = [...session.exercises]
      .reverse()
      .find((e) => e.performed.some((s) => s.state === 'done'));
    if (!last) return '';
    const working = last.performed.filter((s) => !s.is_warmup);
    const done = working.filter((s) => s.state === 'done').length;
    return `${byId.get(last.exercise_id)?.name ?? last.exercise_id} · set ${done} of ${working.length} done`;
  });

  const restNext = $derived.by(() => {
    if (!active) return null;
    const exercise = byId.get(active.instance.exercise_id);
    const index = active.instance.performed.indexOf(active.set);
    const t = targetsOf(active.instance, active.set);
    const figures =
      formatSet(active.set, exercise) ||
      [t.amount, t.reps && `× ${t.reps}`, t.rpe && `@ ${t.rpe}`].filter(Boolean).join(' ') ||
      '—';
    return {
      label: `Set ${index + 1}`,
      figures,
      exercise: exercise?.name ?? active.instance.exercise_id,
    };
  });

  // --- the entry panel --------------------------------------------------------------

  let entry = $state<{ instanceId: string; setId: string } | null>(null);
  const entering = $derived.by(() => {
    if (!entry) return null;
    const instance = session.exercises.find((e) => e.id === entry?.instanceId);
    const set = instance?.performed.find((s) => s.id === entry?.setId);
    return instance && set ? { instance, set } : null;
  });

  function openEntry(instanceId: string, set: PerformedSet): void {
    entry = { instanceId, setId: set.id };
  }

  // `entering` derives from `entry`: read it before closing the panel clears it.
  function saveEntry(edit: SetEdit): void {
    const at = entering;
    if (!at) return;
    const exercise = byId.get(at.instance.exercise_id);
    const measure = exercise ? measureOf(exercise) : 'weight';
    const unit = exercise ? lastUnit(exercise, app.sessions, session.id) : 'kg';
    entry = null;
    change(editSet(session, at.instance.id, at.set.id, edit, measure, unit));
  }

  function skipEntry(): void {
    const at = entering;
    if (!at) return;
    entry = null;
    change(skipSet(session, at.instance.id, at.set.id, true));
  }

  // --- the session's own fields -----------------------------------------------------

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

  async function saveTemplate(): Promise<void> {
    const name = await promptDialog({
      title: 'Save as a template',
      label: 'Name',
      confirmLabel: 'Save template',
    });
    if (name) await app.saveAsTemplate(name);
  }
</script>

<article>
  <header class="head">
    <div class="top">
      <button
        class="icon-btn"
        aria-label="Back"
        onclick={() => app.back(open && !planned ? { name: 'train' } : { name: 'history' })}
        ><Icon name="back" /></button
      >
      <h1 class="date">{longDate(session.date)}</h1>
      {#if planned}
        <span class="pill">planned</span>
      {:else if minutes !== null}
        <span class="pill figure-num">{formatMinutes(minutes)}</span>
      {/if}
    </div>
    {#if label}<p class="meta label">{label}</p>{/if}
    <div class="stage">
      <Boulder progress={tally.total ? tally.done / tally.total : 0} arrived={!open} />
      {#if restClock && !restOpen}
        <button class="readout" onclick={() => (restOpen = true)} aria-label="Rest, {restClock}">
          <span class="caps rest">Rest</span>
          <b class="figure-num">{restClock}</b>
        </button>
      {:else}
        <div class="readout">
          <span class="caps">Sets</span>
          <span
            ><b class="figure-num">{tally.done}</b> <span class="meta">of {tally.total}</span></span
          >
        </div>
      {/if}
    </div>
    <Meander color="var(--figure)" />
  </header>

  {#if planned}
    <div class="start">
      <Button variant="primary" bench full onclick={() => app.startPlanned()}>Start</Button>
    </div>
  {/if}

  <div class="list">
    {#each session.exercises as instance (instance.id)}
      {@const exercise = byId.get(instance.exercise_id)}
      <ExerciseCard
        {session}
        {instance}
        {exercise}
        last={exercise ? lastTime(exercise, app.sessions, session.id) : null}
        unit={exercise ? lastUnit(exercise, app.sessions, session.id) : 'kg'}
        active={active?.set.id ?? null}
        onchange={change}
        onhistory={app.openExercise}
        onentry={(set) => openEntry(instance.id, set)}
      />
    {/each}
  </div>

  <div class="add">
    <AddExercise library={app.library} {recentIds} onpick={pick} oncreate={app.startCreating} />
  </div>

  <p class="sec caps">Session</p>
  <div class="details">
    <div class="field">
      <label for="session-date">Date</label>
      <input
        id="session-date"
        type="date"
        value={session.date}
        onchange={(e) => changeDate(e.currentTarget.value)}
      />
    </div>
    {#if hasBodyweightWork}
      <div class="field">
        <label for="session-bw">Bodyweight today, kg</label>
        <input
          id="session-bw"
          inputmode="decimal"
          placeholder="kg"
          value={session.bodyweight_kg ?? ''}
          onchange={(e) => setBodyweight(e.currentTarget.value)}
        />
      </div>
    {/if}
    <div class="field">
      <label for="session-notes">Notes</label>
      <textarea
        id="session-notes"
        rows="3"
        placeholder="How it went…"
        value={session.notes ?? ''}
        onchange={(e) => setNotes(e.currentTarget.value)}></textarea>
    </div>
  </div>

  <div class="end">
    {#if planned}
      <Button variant="link" class="danger" onclick={app.removeSession}>Discard plan</Button>
    {:else if open}
      <Button variant="primary" bench full onclick={app.finishSession}>Finish</Button>
    {:else}
      <Button full onclick={() => app.create(session, { planned: true })}>Do this again</Button>
      <Button full onclick={saveTemplate}>Save as template</Button>
      <Button variant="link" class="danger" onclick={app.removeSession}>Delete session</Button>
    {/if}
  </div>
</article>

{#if entering}
  {@const exercise = byId.get(entering.instance.exercise_id)}
  {@const t = targetsOf(entering.instance, entering.set)}
  {@const unit = exercise ? lastUnit(exercise, app.sessions, session.id) : 'kg'}
  <EntryPanel
    open
    exerciseName={exercise?.name ?? entering.instance.exercise_id}
    setLabel={entering.set.is_warmup
      ? 'Warm-up'
      : `Set ${entering.instance.performed.indexOf(entering.set) + 1}`}
    set={entering.set}
    prefill={entryPrefill(entering.instance, entering.set)}
    target={[t.reps, t.rpe && `@ ${t.rpe}`].filter(Boolean).join(' ') || null}
    targetRpe={entering.instance.prescribed.find((p) => p.id === entering.set.prescribed_id)
      ?.rpe?.[0] ?? null}
    suggestion={null}
    measure={exercise ? measureOf(exercise) : 'weight'}
    {unit}
    plateStep={plateStep(unit)}
    onsave={saveEntry}
    onskip={skipEntry}
    onclose={() => (entry = null)}
  />
{/if}

{#if restOpen && restFrom !== null && running}
  <RestTakeover
    startedAt={restFrom}
    targetS={null}
    context={restContext}
    next={restNext}
    {chime}
    {awake}
    onadjust={() => {}}
    onskip={skipRest}
    onclose={() => (restOpen = false)}
    onlognext={active
      ? () => {
          restOpen = false;
          if (active) openEntry(active.instance.id, active.set);
        }
      : undefined}
    onchime={(on) => (chime = on)}
    onawake={(on) => (awake = on)}
  />
{/if}

<style>
  .head {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    padding-top: calc(var(--safe-top) + var(--space-1));
    margin-top: calc(-1 * var(--safe-top));
    background: linear-gradient(180deg, var(--ground) 85%, transparent);
    color: var(--figure);
  }

  .top {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: var(--tap);
    padding: 0 var(--gutter) 0 var(--space-1);
    color: var(--ink);
  }

  .date {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: var(--fs-name);
    font-weight: var(--fw-strong);
    text-transform: uppercase;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    height: 32px;
    padding: 0 var(--space-3);
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-pill);
    font-size: var(--fs-body);
    white-space: nowrap;
  }

  .label {
    padding: 0 var(--gutter) 0 52px;
  }

  .stage {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: var(--space-4);
    height: 92px;
    padding: var(--space-2) var(--gutter);
  }

  .readout {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    min-width: 128px;
    color: var(--ink);
    text-align: right;
  }

  .readout .caps {
    color: var(--muted);
  }

  .readout .rest {
    color: var(--accent);
  }

  .readout b {
    font-size: var(--fs-readout);
    line-height: var(--lh-num);
  }

  .start {
    margin: var(--space-3) 12px 0;
  }

  .list {
    margin-top: var(--space-3);
  }

  .add {
    margin: var(--space-3) 12px 0;
  }

  .details {
    display: grid;
    gap: var(--space-3);
    margin: 0 var(--gutter);
  }

  textarea {
    resize: vertical;
  }

  .end {
    display: grid;
    gap: var(--space-2);
    margin: var(--space-6) 12px var(--space-8);
  }

  .end :global(.danger) {
    justify-self: center;
    color: var(--danger);
  }
</style>
