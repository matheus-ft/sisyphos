<script lang="ts">
  import musclesCsv from './library/muscles.csv?raw';
  import exercisesCsv from './library/exercises.csv?raw';
  import { parseMuscles, parseExercises } from './library/parse';
  import { e1rm } from './metrics/rpe-chart';
  import { setStressIndex, centralBalance, stressByMuscle } from './metrics/stress';
  import {
    volumeByMuscle,
    setsByTierForLift,
    eventVolume,
    type CountedSet,
  } from './metrics/volume';
  import {
    muscleWeights,
    tierWeights,
    MUSCLE_PRESET_NAMES,
    TIER_PRESET_NAMES,
    CONFIG,
  } from './metrics/definitions';
  import type { PerformedSet } from './model';

  // No logging UI yet. This page reads the real library and charts so a broken
  // reference shows up now rather than in three weeks, and it demonstrates the
  // one interaction that matters for analysis: switching how muscles are counted.
  const muscles = parseMuscles(musclesCsv);
  const nameOf = new Map(muscles.map((m) => [m.id, m.name]));
  const exercises = parseExercises(exercisesCsv, new Set(muscles.map((m) => m.id)));
  const byId = new Map(exercises.map((e) => [e.id, e]));

  // A plausible session, so the numbers below are of something rather than nothing.
  const SAMPLE: Array<[string, number, number, number]> = [
    ['low_bar_squat', 4, 5, 8],
    ['paused_squat', 3, 3, 7.5],
    ['romanian_deadlift', 3, 8, 8],
    ['leg_curl_seated', 3, 12, 9],
    ['chest_supported_row', 3, 10, 8],
  ];

  const set = (reps: number, rpe: number): PerformedSet => ({
    id: crypto.randomUUID(),
    prescribed_id: null,
    state: 'done',
    reps,
    rpe,
    load: { kind: 'weight', value: 100, unit: 'kg' },
    is_warmup: false,
    notes: null,
  });

  const counted: CountedSet[] = SAMPLE.flatMap(([id, n, reps, rpe]) =>
    Array.from({ length: n }, () => ({ set: set(reps, rpe), exercise: byId.get(id)! })),
  );
  const stressSets = SAMPLE.flatMap(([id, n, reps, rpe]) =>
    Array.from({ length: n }, () => ({ reps, rpe, exercise: byId.get(id)! })),
  );

  let preset = $state(CONFIG.activeMuscleWeights);
  let tierPreset = $state(CONFIG.activeTierWeights);
  const weights = $derived(muscleWeights(preset));
  const tw = $derived(tierWeights(tierPreset));
  const perLift = $derived(setsByTierForLift(counted));
  const eventTotals = $derived(eventVolume(counted, tw));
  const byMuscle = $derived(volumeByMuscle(counted, weights));
  const stress = $derived(stressByMuscle(stressSets, weights));

  const ranked = $derived([...byMuscle.entries()].sort((a, b) => b[1] - a[1]).slice(0, 9));
  const peak = $derived(ranked.length ? ranked[0][1] : 1);

  const worked: Array<[string, number, number, number]> = [
    ['150kg × 3 @ RPE 7.5', 150, 3, 7.5],
    ['200kg × 1 @ RPE 9', 200, 1, 9],
    ['100kg × 10 @ RPE 8', 100, 10, 8],
    ['100kg × 15 @ RPE 8', 100, 15, 8],
  ];

  const fmt = (n: number | null | undefined, d = 1) =>
    n === null || n === undefined ? '—' : n.toFixed(d);
</script>

<main>
  <h1>Sisyphos</h1>
  <p class="sub">
    Schema and metric layer wired up; no logging UI yet. Everything below is computed live from
    <code>config/</code> — {exercises.length} exercises, {muscles.length} muscle groups.
  </p>

  <section>
    <h2>Muscle counting</h2>
    <p class="lede">
      Every scheme people argue about is the same calculation with different role weights, so
      switching is the whole mechanism. Nothing recomputes from storage, because nothing was stored.
    </p>
    <div class="switcher" role="group" aria-label="Muscle weighting preset">
      {#each MUSCLE_PRESET_NAMES as name}
        <button
          type="button"
          class="chip"
          aria-pressed={preset === name}
          onclick={() => (preset = name)}
        >
          {name}
        </button>
      {/each}
    </div>
    <p class="weights tabular">
      primary {weights.primary} · secondary {weights.secondary} · aux {weights.aux}
    </p>

    <ul class="bars">
      {#each ranked as [group, sets]}
        <li>
          <span class="bar-label">{nameOf.get(group)}</span>
          <span class="bar-track"
            ><span class="bar-fill" style="width:{(sets / peak) * 100}%"></span></span
          >
          <span class="bar-value tabular">{fmt(sets)}</span>
          <span class="bar-stress tabular">{fmt(stress.get(group), 0)}</span>
        </li>
      {/each}
    </ul>
    <p class="note">
      Sets per muscle group from one sample session, and the stress attributed to it. Both use the
      same weights, so they move together instead of telling different stories.
    </p>
  </section>

  <section>
    <h2>Specificity</h2>
    <p class="lede">
      The same mechanism on a second axis: how much a variation counts toward its event. The
      discrete breakdown never goes away — it is usually the more useful sentence.
    </p>
    <div class="switcher" role="group" aria-label="Tier weighting preset">
      {#each TIER_PRESET_NAMES as name}
        <button
          type="button"
          class="chip"
          aria-pressed={tierPreset === name}
          onclick={() => (tierPreset = name)}
        >
          {name}
        </button>
      {/each}
    </div>
    <p class="weights tabular">
      comp {tw.comp} · high_spec {tw.high_spec} · low_spec {tw.low_spec} · acc {tw.acc}
    </p>
    <table>
      <thead>
        <tr><th>Event</th><th>comp</th><th>high</th><th>low</th><th>acc</th><th>weighted</th></tr>
      </thead>
      <tbody>
        {#each [...perLift.entries()] as [lift, tiers]}
          <tr>
            <td>{lift}</td>
            <td class="tabular">{tiers.get('comp')}</td>
            <td class="tabular">{tiers.get('high_spec')}</td>
            <td class="tabular">{tiers.get('low_spec')}</td>
            <td class="tabular">{tiers.get('acc')}</td>
            <td class="tabular"><strong>{fmt(eventTotals.get(lift))}</strong></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <section>
    <h2>Charts</h2>
    <table>
      <thead>
        <tr><th>Set</th><th>e1RM</th><th>Stress index</th><th>CS balance</th></tr>
      </thead>
      <tbody>
        {#each worked as [label, kg, reps, rpe]}
          <tr>
            <td>{label}</td>
            <td class="tabular">{fmt(e1rm(kg, rpe, reps))}</td>
            <td class="tabular">{fmt(setStressIndex(rpe, reps), 2)}</td>
            <td class="tabular">{fmt(centralBalance([{ rpe, reps }]), 2)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="note">
      The 15-rep row reads <strong>—</strong> for e1RM on purpose: the chart stops at 12 and there is
      no formula fallback. Stress clamps instead, because its edges are plateaus. CS balance is central
      ÷ SI.
    </p>
  </section>
</main>

<style>
  main {
    max-width: 46rem;
    margin: 0 auto;
    padding-inline: 1.25rem;
    padding-block: 2.5rem 4rem;
  }
  h1 {
    margin: 0 0 0.35rem;
    font-size: 1.9rem;
    letter-spacing: -0.02em;
  }
  h2 {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--muted);
    border-bottom: 1px solid var(--line);
    padding-bottom: 0.4rem;
    margin: 0 0 0.9rem;
  }
  .sub,
  .lede {
    color: var(--ink-2);
    max-width: 40rem;
  }
  .sub {
    margin: 0 0 2rem;
  }
  .lede {
    margin: 0 0 1rem;
    font-size: 0.92rem;
  }
  section {
    margin-bottom: 2.5rem;
  }
  .switcher {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .chip {
    font: inherit;
    font-size: 0.8rem;
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink-2);
    border-radius: 999px;
    cursor: pointer;
  }
  .chip[aria-pressed='true'] {
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }
  .chip:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .weights {
    font-size: 0.78rem;
    color: var(--muted);
    margin: 0.6rem 0 1rem;
  }
  ul.bars {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  ul.bars li {
    display: grid;
    grid-template-columns: 7.5rem 1fr 2.6rem 3rem;
    gap: 0.6rem;
    align-items: center;
    padding: 0.28rem 0;
    font-size: 0.86rem;
  }
  .bar-label {
    color: var(--ink-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bar-track {
    background: var(--surface);
    border: 1px solid var(--line);
    height: 0.85rem;
  }
  .bar-fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .bar-value {
    text-align: right;
    font-weight: 600;
  }
  .bar-stress {
    text-align: right;
    color: var(--muted);
  }
  @media (max-width: 30rem) {
    ul.bars li {
      grid-template-columns: 6rem 1fr 2.2rem 2.6rem;
      font-size: 0.8rem;
    }
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
  }
  th,
  td {
    text-align: left;
    padding: 0.42rem 0.6rem 0.42rem 0;
    border-bottom: 1px solid var(--line);
  }
  th {
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--muted);
  }
  td.tabular,
  th:not(:first-child) {
    text-align: right;
  }
  .note {
    font-size: 0.8rem;
    color: var(--muted);
    margin: 0.8rem 0 0;
    max-width: 42rem;
  }
  code {
    font-family: var(--mono);
    font-size: 0.88em;
    background: var(--surface);
    border: 1px solid var(--line);
    padding: 0 0.25em;
  }
</style>
