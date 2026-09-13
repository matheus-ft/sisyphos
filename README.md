# Sisyphos

A powerlifting training log built for analysis, not just record-keeping.

**Sisyphos** — Σίσυφος, transliterated from the Greek rather than Latinised to
_Sisyphus_. He rolls the boulder up, watches it come back down, and starts again
tomorrow. There is no more honest description of a training block.

The premise: logs should capture everything you might want to ask later, without
repeating what a lookup table already knows. A set records that you did paused
squats at 150kg for 3 at RPE 7.5. It does not record that paused squats are a
squat variation working quads and glutes — that lives in the exercise library and
is resolved when you query.

**Status: pre-alpha.** Schema and metric layer are in place; no logging UI yet.

Live at **<https://matheus-ft.github.io/sisyphos/>**, deployed from `master` on
every push. On iOS, open it in Safari and use Share → Add to Home Screen; it then
launches full screen and works with no signal.

## Design in one page

Runs as an installable PWA. No backend, no app store, no Apple developer account.
Once installed it launches and logs with no network at all, which is the only
requirement that actually matters in a gym.

Data lives on device as one JSON document per session and syncs to a private
repo. That gives cloud backup, complete version history of your training, and
conflict detection for free — GitHub's Contents API requires the file's current
sha on write, so a second device that changed the same document is detected
rather than silently overwritten.

Nothing derived is ever stored. Not e1RM, not tonnage, not stress, not personal
records. Every number is computed from raw sets plus `src/metrics/definitions.json`,
so changing how a metric is defined re-reads all history with no backfill.

### Analysis aggregates by date, never by program structure

A session copies whatever label its prescription source carried — `Block 1`,
`Week 2`, `Wednesday`. Those labels are descriptive. Analysis groups by calendar
date range, always. Selecting "Block 1" resolves to the first and last dates
carrying that label, and everything inside those bounds belongs to it whether or
not it was labelled. A block has no existence in the data; it lives in the
analysis and prescription layers only.

## Layout

Data files sit beside the code that reads them, rather than in a separate config
tree that has to be kept in step with it.

```
src/
  model/      the schema — primitives, taxonomy, records
  library/    muscles.csv, exercises.csv, and the parser for them
  metrics/    definitions.json, the two lookup charts, and the code reading them
  storage/    getting data onto disk and off the device: adapters, scheduler,
              durability
```

**No training data lives in this repo.** Sessions, bodyweight, reference maxes
and records go in a separate private log repo the app creates for you. See
[`docs/DATA.md`](docs/DATA.md).

Sessions are JSON because they are nested and machine-written. The library and
the charts are CSV because they are read by humans in diffs, where one changed
line beats a reindented block.

## Running it

Requires Node 22.12 or newer.

```sh
npm install
npm run dev      # dev server
npm run build    # production bundle + service worker
npm run verify   # typecheck, tests, formatting
npm run hooks:install   # formatting on commit
```

## Data model

The schema and its invariants are in [`src/model/`](src/model/); the decisions
behind it, and what was rejected, are in [`docs/DESIGN.md`](docs/DESIGN.md).

Four things worth knowing up front.

Prescribed values are intervals, realized values are scalars. `[6, 8]` is six to
eight reps; `[5, null]` is at least five then AMRAP. There is no separate AMRAP
flag — an open upper bound is what AMRAP means.

Every working set carries an RPE, or it is flagged as a warm-up. e1RM comes from
the RPE chart rather than a formula, so a set without an RPE has no e1RM at all,
and above 12 reps it stays null rather than falling back to Epley.

Session completeness is derived from set states, not tracked separately. A
session with no `pending` sets needs no further input; `ended_at` is a separate
nullable field carrying only duration.

There is no exercise called "deadlift". Sumo and conventional are different
movements that compete under the same event, so they are separate exercises, both
at tier `comp`, both with `base_lift: deadlift`. The same applies anywhere one
event admits more than one legal technique.

## Credits

The peripheral and central fatigue values in `src/metrics/stress-chart.csv` are
derived from the per-set fatigue model surfaced in
[Reactive Training Systems](https://www.reactivetrainingsystems.com/)' training
log, and are reproduced here for personal analysis. The load chart in
`src/metrics/rpe-chart.csv` is the classic RPE/RIR chart popularised by Helms et
al.

## License

AGPL-3.0. See [LICENSE](LICENSE).
