<script lang="ts">
  import type { Exercise, Id, LoadUnit, PerformedSet, Session } from '../../model';
  import AddExercise from '../AddExercise.svelte';
  import { app } from '../app.svelte';
  import { entryContext, entryPrefill } from '../entry';
  import { screenAwake, restBell } from '../device';
  import { formatMinutes, longDate, programLabel, sessionMinutes } from '../format';
  import Boulder from '../kit/Boulder.svelte';
  import Button from '../kit/Button.svelte';
  import Icon from '../kit/Icon.svelte';
  import Meander from '../kit/Meander.svelte';
  import Switch from '../kit/Switch.svelte';
  import { dismissToast, promptDialog, showToast } from '../overlays.svelte';
  import { adjustRest, parseRest, serializeRest } from '../rest';
  import { bellAt, type BellState } from '../restview';
  import {
    addExercise,
    editSet,
    isLive,
    lastInstance,
    measureOf,
    parseNumber,
    planSet,
    setDate,
    setRest,
    skipSet,
    type SetEdit,
  } from '../session';
  import { cardMode, firstPending, recordSetIds } from './cards';
  import EntryPanel from './EntryPanel.svelte';
  import ExerciseCard from './ExerciseCard.svelte';
  import {
    climb,
    parseUnits,
    restContext,
    restFresh,
    restKey,
    restNext,
    restNextSet,
    restReadout,
    restStarted,
    savedSet,
    sessionsBefore,
    savedToast,
    sameRest,
    serializeUnits,
    startsRest,
    targetOf,
    undoSet,
    unitsKey,
    weighInOffer,
  } from './flow';
  import { activeSetId, ringedRpe, setLabel, suggestionLine, targetText } from './panel';
  import RestTakeover from './RestTakeover.svelte';
  import { hiddenKey, parseHidden, serializeHidden } from './warmups';

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

  const byId = $derived(new Map(app.library.map((e) => [e.id, e])));
  /**
   * What the tab keeps for the session (the rest, hidden warm-ups, picked units)
   * reloads when another session comes on screen, not at every edit of this one.
   */
  const sessionId = $derived(session.id);
  const open = $derived(session.ended_at === null);
  const planned = $derived(session.started_at === null);
  /** Lifted now: only then does a set start a rest, the rest ring, the screen stay on. */
  const live = $derived(isLive(session));
  const hasBodyweightWork = $derived(
    session.exercises.some((e) => byId.get(e.exercise_id)?.load_type === 'bw_plus'),
  );
  /** Exercises of recent sessions first: most days repeat a recent one. */
  const recentIds = $derived([
    ...new Set([...app.sessions].reverse().flatMap((s) => s.exercises.map((e) => e.exercise_id))),
  ]);
  /** What came before this session's date: "last time" and suggestions for a past session look back from it, not from today. */
  const earlier = $derived(sessionsBefore(app.sessions, session.date));
  const progress = $derived(climb(session, app.sessions));
  const label = $derived(programLabel(session.label));
  const records = $derived(recordSetIds(session, app.sessions, app.library, app.manualRecords));
  const weighIn = $derived(weighInOffer(session, app.bodyweights));

  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 1_000);
    return () => clearInterval(timer);
  });
  const minutes = $derived(sessionMinutes(session, now));

  /** Scrolled past the top, the header gives back room to the list. */
  let collapsed = $state(false);
  function scrolled(): void {
    // Two thresholds, so a header that has just shrunk does not shrink the scroll back under itself.
    const y = window.scrollY;
    collapsed = collapsed ? y > 8 : y > 24;
  }

  // Awake while the session is lifted and the lifter asked for it.
  $effect(() => {
    const wake = screenAwake();
    wake.set(live && app.prefs.keepAwake);
    return () => wake.dispose();
  });

  // --- the entry panel --------------------------------------------------------------

  /** The set the panel is open on, and the unit it was switched to, if it was. */
  let entry = $state<{ instanceId: Id; setId: Id; unit?: LoadUnit } | null>(null);
  const entering = $derived.by(() => {
    if (!entry) return null;
    const instance = session.exercises.find((e) => e.id === entry?.instanceId);
    const set = instance?.performed.find((s) => s.id === entry?.setId);
    return instance && set ? { instance, set } : null;
  });
  const enteringContext = $derived.by(() => {
    if (!entering) return null;
    return entryContext({
      session,
      instance: entering.instance,
      set: entering.set,
      exercise: byId.get(entering.instance.exercise_id),
      sessions: earlier,
      oneRms: app.oneRms,
      prefs: app.prefs,
      chosen: units.get(entering.instance.exercise_id),
      unit: entry?.unit,
    });
  });

  /** The set the lifter is on: the open panel's, else the first still pending. */
  const active = $derived(
    activeSetId(open, entering?.set.id ?? null, firstPending(session)?.set.id ?? null),
  );

  function openEntry(instanceId: Id, set: PerformedSet): void {
    // A toast sits over the panel's foot, where the chips are.
    dismissToast();
    entry = { instanceId, setId: set.id };
  }

  // --- saving -----------------------------------------------------------------------

  /**
   * Every edit goes through here: a set that just became done gets its undo
   * toast and, if it was a working set, starts the rest. The bell is primed
   * inside the tap, since iOS lets sound start only from one.
   */
  function change(next: Session, options: { toast?: boolean } = {}): void {
    if (app.prefs.chime) restBell().prime();
    // The undo toast outlives this screen, whose `session` is gone once the lifter leaves.
    const savedIn = session.id;
    const saved = open ? savedSet(session, next) : null;
    // The set as it was, taken before the save: `session` shows the new one the moment it is saved.
    const before = saved
      ? session.exercises
          .find((e) => e.id === saved.instance.id)
          ?.performed.find((s) => s.id === saved.set.id)
      : undefined;
    void app.save(next);
    if (!saved) return;
    const rested =
      live && startsRest(saved, next)
        ? restStarted(saved, byId.get(saved.instance.exercise_id), Date.now())
        : null;
    if (rested) startRest(rested);
    if (options.toast === false) return;

    const exercise = byId.get(saved.instance.exercise_id);
    showToast({
      ...savedToast(saved, exercise),
      action: before
        ? {
            label: 'Undo',
            run: () => {
              const undone = undoSet(app.current, savedIn, saved.instance.id, before);
              if (undone) void app.save(undone);
              // Only the rest this save started goes with it; one already running stays.
              if (rested !== null && sameRest(rest, rested)) endRest(savedIn);
            },
          }
        : undefined,
    });
  }

  // `entering` derives from `entry`: read it before closing the panel clears it.
  function saveEntry(edit: SetEdit): void {
    const at = entering;
    if (!at) return;
    const exercise = byId.get(at.instance.exercise_id);
    const measure = exercise ? measureOf(exercise) : 'weight';
    const unit = enteringContext?.unit ?? 'kg';
    const apply = planned ? planSet : editSet;
    const next = apply(session, at.instance.id, at.set.id, edit, measure, unit);
    entry = null;
    // A warm-up is followed by the next warm-up of the ladder, with no tap to reopen the panel between,
    // and no toast either: it would cover that panel's Done.
    const after = at.set.is_warmup
      ? next.exercises
          .find((e) => e.id === at.instance.id)
          ?.performed.slice(at.instance.performed.findIndex((s) => s.id === at.set.id) + 1)
          .find((s) => s.state === 'pending')
      : undefined;
    const chain = after?.is_warmup ? after : null;
    change(next, { toast: chain === null });
    if (chain) openEntry(at.instance.id, chain);
  }

  function skipEntry(): void {
    const at = entering;
    if (!at) return;
    entry = null;
    change(skipSet(session, at.instance.id, at.set.id, true));
  }

  // --- rest -------------------------------------------------------------------------

  /** The rest in progress, kept for the tab so a reload between sets keeps counting; never saved to the log. */
  let rest = $state.raw<ReturnType<typeof parseRest>>(null);
  let restOpen = $state(false);
  $effect(() => {
    try {
      const kept = parseRest(sessionStorage.getItem(restKey(sessionId)));
      rest = kept && restFresh(kept, Date.now()) ? kept : null;
    } catch {
      rest = null;
    }
  });

  function startRest(state: NonNullable<typeof rest>): void {
    rest = state;
    restOpen = true;
    try {
      sessionStorage.setItem(restKey(sessionId), serializeRest(state));
    } catch {
      // The timer still runs; it only forgets on reload.
    }
  }

  /** Takes the session's id rather than reading `session`: an undo may end a rest after the screen is gone. */
  function endRest(of: Id): void {
    rest = null;
    restOpen = false;
    try {
      sessionStorage.removeItem(restKey(of));
    } catch {
      // Nothing kept, nothing to forget.
    }
  }

  const restInstance = $derived(
    rest ? (session.exercises.find((e) => e.id === rest?.instanceId) ?? null) : null,
  );
  /** The target is the exercise's now, so −15 s / +15 s (saved into the session) reaches the clock at once. */
  const restTarget = $derived(
    restInstance ? targetOf(restInstance, byId.get(restInstance.exercise_id)) : null,
  );
  const restReading = $derived(
    live && rest && restTarget !== null ? restReadout(rest.startedAt, restTarget, now) : null,
  );
  const restUp = $derived(restOpen && live && rest !== null && restInstance !== null);

  const restFollowing = $derived.by(() => {
    if (!rest) return null;
    const next = restNextSet(session, rest);
    if (!next) return null;
    const exercise = byId.get(next.instance.exercise_id);
    const ctx = entryContext({
      session,
      instance: next.instance,
      set: next.set,
      exercise,
      sessions: earlier,
      oneRms: app.oneRms,
      prefs: app.prefs,
      chosen: units.get(next.instance.exercise_id),
    });
    return { next, view: restNext(next, exercise, ctx) };
  });

  // The bell at zero rings from here, whether the takeover is up, closed, or never
  // opened since a reload; the takeover has none, so it cannot ring twice.
  let bell: BellState = { rung: false };
  $effect(() => {
    if (!live || !rest || restTarget === null) return;
    const kept = { startedAt: rest.startedAt, targetS: restTarget };
    function tick(): void {
      const visible = document.visibilityState === 'visible';
      const step = bellAt(bell, kept, Date.now(), visible, app.prefs.chime);
      bell = step.state;
      if (step.ring) restBell().play();
    }
    tick();
    const timer = setInterval(tick, 250);
    // iOS suspends a backgrounded app: timers stop, and the first thing back is one of these.
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('pageshow', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('pageshow', tick);
    };
  });

  function adjustTarget(delta: number): void {
    if (!restInstance || restTarget === null) return;
    void app.save(setRest(session, restInstance.id, adjustRest(restTarget, delta)));
  }

  // --- warm-ups the lifter hid, for this session only ---------------------------------

  let hidden = $state.raw<Set<Id>>(new Set());
  $effect(() => {
    try {
      hidden = parseHidden(sessionStorage.getItem(hiddenKey(sessionId)));
    } catch {
      hidden = new Set();
    }
  });

  function hideWarmups(instanceId: Id): void {
    hidden = new Set([...hidden, instanceId]);
    try {
      sessionStorage.setItem(hiddenKey(sessionId), serializeHidden(hidden));
    } catch {
      // Hidden until the card is next drawn; nothing worse.
    }
  }

  // --- units picked for an exercise, for this session only ----------------------------

  let units = $state.raw<Map<string, LoadUnit>>(new Map());
  $effect(() => {
    try {
      units = parseUnits(sessionStorage.getItem(unitsKey(sessionId)));
    } catch {
      units = new Map();
    }
  });

  function pickUnit(exerciseId: string, unit: LoadUnit): void {
    units = new Map([...units, [exerciseId, unit]]);
    try {
      sessionStorage.setItem(unitsKey(sessionId), serializeUnits(units));
    } catch {
      // Picked until the screen is next drawn; a number typed in it keeps it in the log.
    }
  }

  function switchEntryUnit(unit: LoadUnit): void {
    const at = entering;
    if (!entry || !at) return;
    entry = { ...entry, unit };
    pickUnit(at.instance.exercise_id, unit);
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

  async function saveWeighIn(): Promise<void> {
    const offer = weighIn;
    if (!offer) return;
    if (await app.saveRow('bodyweight', offer)) {
      showToast({ message: 'Weigh-in saved', strong: `${offer.weight_kg} kg` });
    }
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

<svelte:window onscroll={scrolled} />

<article>
  <header class="head" class:collapsed>
    <div class="top">
      <button
        class="icon-btn"
        aria-label="Back"
        onclick={() => app.back(open && !planned ? { name: 'train' } : { name: 'history' })}
        ><Icon name="back" /></button
      >
      <h1 class="date">{longDate(session.date)}</h1>
      {#if planned}
        <span class="pill">Planned</span>
      {:else if minutes !== null}
        <span class="pill figure-num" aria-label="Running {formatMinutes(minutes)}"
          >{formatMinutes(minutes)}</span
        >
      {/if}
    </div>
    {#if label}<p class="meta label">{label}</p>{/if}
    <div class="stage">
      <div class="hill"><Boulder progress={progress.fraction} arrived={!open} label={null} /></div>
      {#if restReading && !restOpen}
        <button
          class="readout resting"
          class:over={restReading.over}
          onclick={() => (restOpen = true)}
          aria-label="Rest, {restReading.text} of {restReading.of}. Open the rest timer"
        >
          <span class="cap-line"
            ><span class="caps rest">Rest</span><span class="meta of">of {restReading.of}</span
            ></span
          >
          <b class="figure-num">{restReading.text}</b>
          <span class="rule" aria-hidden="true"
            ><span style:width="{Math.round(restReading.fraction * 100)}%"></span></span
          >
        </button>
      {:else}
        <div class="readout" aria-label="{progress.done} of {progress.of} sets done" role="group">
          <span class="caps">Sets</span>
          <span class="count"
            ><b class="figure-num">{progress.done}</b>
            <span class="meta">of {progress.of}</span></span
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
        mode={cardMode(instance, active)}
        last={exercise ? lastInstance(exercise.id, earlier, session.id) : null}
        chosenUnit={units.get(instance.exercise_id) ?? null}
        {active}
        {records}
        warmupsHidden={hidden.has(instance.id)}
        onchange={change}
        onhidewarmups={() => hideWarmups(instance.id)}
        onhistory={app.openExercise}
        onentry={(set) => openEntry(instance.id, set)}
        onunit={(unit) => pickUnit(instance.exercise_id, unit)}
      />
    {/each}
  </div>

  <div class="add">
    <AddExercise library={app.library} {recentIds} onpick={pick} oncreate={app.startCreating} />
  </div>

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
        {#if weighIn}
          <Button variant="link" onclick={saveWeighIn}>Save as this day's weigh-in</Button>
        {/if}
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
    {#if live}
      <div class="switch-row">
        <span id="awake-label">Keep screen on</span>
        <Switch
          labelledby="awake-label"
          checked={app.prefs.keepAwake}
          onchange={(on) => app.setPrefs({ keepAwake: on })}
        />
      </div>
    {/if}
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

{#if entering && enteringContext}
  {@const exercise = byId.get(entering.instance.exercise_id)}
  <EntryPanel
    open
    exerciseName={exercise?.name ?? entering.instance.exercise_id}
    setLabel={setLabel(entering.instance, entering.set)}
    set={entering.set}
    prefill={entryPrefill(entering.instance, entering.set, enteringContext)}
    target={targetText(entering.instance, entering.set)}
    targetRpe={ringedRpe(entering.instance, entering.set)}
    suggestion={entering.set.state === 'pending'
      ? suggestionLine(enteringContext.suggestion)
      : null}
    measure={exercise ? measureOf(exercise) : 'weight'}
    unit={enteringContext.unit}
    plateStep={enteringContext.step}
    planning={planned}
    onunit={switchEntryUnit}
    onsave={saveEntry}
    onskip={skipEntry}
    onclose={() => (entry = null)}
  />
{/if}

{#if restUp && rest && restInstance}
  <RestTakeover
    startedAt={rest.startedAt}
    targetS={restTarget}
    context={restContext(
      restInstance,
      byId.get(restInstance.exercise_id)?.name ?? restInstance.exercise_id,
    )}
    next={restFollowing?.view ?? null}
    chime={app.prefs.chime}
    awake={app.prefs.keepAwake}
    onadjust={adjustTarget}
    onskip={() => endRest(sessionId)}
    onclose={() => (restOpen = false)}
    onlognext={restFollowing
      ? () => {
          const at = restFollowing.next;
          restOpen = false;
          openEntry(at.instance.id, at.set);
        }
      : undefined}
    onchime={(on) => app.setPrefs({ chime: on })}
    onawake={(on) => app.setPrefs({ keepAwake: on })}
  />
{/if}

<style>
  .head {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    padding-top: calc(var(--safe-top) + var(--space-1));
    margin-top: calc(-1 * var(--safe-top));
    background: var(--ground);
    color: var(--figure);
  }

  /* The list slides under the header and fades out beneath its meander, not behind it. */
  .head::after {
    content: '';
    position: absolute;
    right: 0;
    bottom: -10px;
    left: 0;
    height: 10px;
    background: linear-gradient(180deg, var(--ground), transparent);
    pointer-events: none;
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
    letter-spacing: var(--ls-display);
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
    font: var(--fw-num) 1.0625rem / 1 var(--font-num);
    white-space: nowrap;
  }

  .label {
    margin: 0;
    padding: 0 var(--gutter) 0 52px;
    max-height: 24px;
    overflow: hidden;
    transition:
      max-height var(--dur-base) var(--ease-out),
      opacity var(--dur-base) var(--ease-out);
  }

  .stage {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: var(--space-4);
    height: 92px;
    padding: var(--space-2) var(--gutter);
    transition: height var(--dur-base) var(--ease-out);
  }

  .hill {
    width: 100%;
    max-width: 200px;
    transition: max-width var(--dur-base) var(--ease-out);
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

  .readout b {
    font-size: var(--fs-readout);
    line-height: var(--lh-num);
  }

  .count {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }

  .resting {
    min-height: var(--tap);
    padding: 0;
  }

  .resting .cap-line {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }

  .resting .rest {
    color: var(--accent);
  }

  .resting .rule {
    width: 100%;
    height: 3px;
    background: var(--line);
  }

  .resting .rule span {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .resting.over b {
    color: var(--accent);
  }

  /* Scrolled: the header keeps the hill and the readout, in one thin band. */
  .collapsed .label {
    max-height: 0;
    opacity: 0;
  }

  .collapsed .stage {
    height: 48px;
    align-items: center;
    padding-block: 0;
  }

  .collapsed .hill {
    max-width: 120px;
  }

  .collapsed .readout {
    flex-direction: row;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }

  .collapsed .readout b {
    font-size: 1.75rem;
  }

  .collapsed .resting {
    align-items: center;
  }

  .collapsed .resting .cap-line .of,
  .collapsed .resting .rule {
    display: none;
  }

  /* Clear of the header's fade, which would otherwise wash over the button's ring. */
  .start {
    margin: var(--space-5) 12px 0;
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
    margin: var(--space-6) var(--gutter) 0;
  }

  .switch-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: var(--tap);
  }

  /* The link's words, not its padding, line up with the field above. */
  .field :global(.button-link) {
    justify-self: start;
    margin-left: calc(-1 * var(--space-2));
  }

  textarea {
    resize: vertical;
  }

  /* Room below for the undo toast each set leaves for 5 s, so Finish can scroll clear of it. */
  .end {
    display: grid;
    gap: var(--space-2);
    margin: var(--space-6) 12px calc(var(--space-8) + 64px);
  }

  .end :global(.danger) {
    justify-self: center;
    color: var(--danger);
  }
</style>
