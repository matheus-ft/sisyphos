# Where things live

Two repositories, and the split is not arbitrary: it's the line between what the
app _is_ and what the app _records_.

```
sisyphos/                      ← this repo. Code and the shared library. AGPL.
└── config/, src/, tests/, docs/

sisyphos-log/                  ← a separate PRIVATE repo. Your training.
├── sessions/2026/2026-09-14_01J8X.json
├── library/additions.csv      ← exercises you made that aren't upstream yet
├── lifter/one-rm-history.csv
├── lifter/manual-records.csv
├── lifter/bodyweight.csv
└── templates/*.json
```

Nothing personal is committed here. Your bodyweight is not a project asset.

## First run: the log repo creates itself

You paste one fine-grained GitHub token into settings. The app then:

1. Checks whether the log repo exists.
2. If not, creates it as **`sisyphos-log`** — `POST /user/repos` with
   `private: true` — under your own
   account. Nobody else can see it, including whoever wrote this app.
3. Writes the directory skeleton and an initial commit.

So the setup is: paste a token, pick a name, done. No repository to create by
hand, no directory structure to get right. The token needs `contents: write` on
that one repo and `issues: write` on the public app repo, which is what lets the
app file an exercise submission for you.

If you would rather create the repo yourself, point the app at an existing empty
one and it will use that instead.

## config/ — ships with the app, effectively fixed

| File                    | What it holds                                                                                                                                                            | Who edits it                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `metrics.json`          | Every metric definition: role weights, null policies, which chart drives e1RM, whether warm-ups count. Each setting lists its alternatives in a matching `_options` key. | You, when you change your mind about a definition                                   |
| `muscles.csv`           | The muscle vocabulary exercises point at: `id`, `name`, grouping `tags`.                                                                                                 | Rarely. Adding one is additive; renaming an id breaks every exercise pointing at it |
| `metrics/rpe-chart.csv` | `rpe, reps, factor` — the RPE/RIR chart. 232 rows, deliberately ragged: low-RPE rows stop short of 12 reps.                                                              | Nobody, unless you swap charts                                                      |
| `stress-factors.csv`    | `rpe, reps, peripheral, central` — per-set fatigue. 252 rows, complete.                                                                                                  | Nobody                                                                              |

These are configuration in the strict sense: the app cannot function without them
and the lifter does not routinely change them.

## The exercise library is shared

`exercises.csv` is imported once on first run and then belongs to you. The moment
you add an exercise in the app, the live library is your data, not this file. It
lives here so a fresh install isn't an empty screen, and so the format has a
worked example.

The exercise library is therefore _not_ config, even though it looks like it:
config is what the app needs, and the exercise library is what the lifter builds.

## src/lib/ — what each file contains

| Path                        | Contents                                                           |
| --------------------------- | ------------------------------------------------------------------ |
| `model/primitives.ts`       | Scalars: ids, instants, dates, intervals, load units               |
| `model/library.ts`          | The taxonomy — what `src/library/*.csv` describes                  |
| `model/log.ts`              | What you record: sessions, sets, templates                         |
| `model/lifter.ts`           | Reference maxes, records, bodyweight                               |
| `model/intervals.ts`        | Prescription ranges: AMRAP detection, display formatting           |
| `model/index.ts`            | Re-exports the four; import from here, not from the parts          |
| `csv.ts`                    | A ~30-line CSV reader. Our files need no quoting, so no dependency |
| `library/parse.ts`          | CSV rows → `Muscle` and `Exercise`, with validation and defaults   |
| `metrics/rpe-chart.ts`      | The RPE→%1RM chart, and `e1rm()`                                   |
| `metrics/stress.ts`         | The fatigue chart, stress index, central balance                   |
| `metrics/load.ts`           | Unit conversion, effective load, tonnage                           |
| `storage/StorageAdapter.ts` | The persistence interface. IndexedDB implements it                 |
| `sync/SyncAdapter.ts`       | The remote interface. A private git repo implements it             |

## The log repo's files

`sessions/YYYY/<date>_<id>.json` — one document per session, so two devices
editing different sessions never collide. Nested, machine-written, never edited
by hand.

`library/additions.csv` — exercises you created that haven't merged upstream yet.

`lifter/one-rm-history.csv` — `date, lift, weight_kg, note`. Effective-dated
reference maxes that resolve percentage prescriptions. Always set by hand.

`lifter/manual-records.csv` — `exercise_id, reps, weight_kg, date, rpe, context`.
Records with **no session behind them**: a competition lift, or anything from
before you started logging here.

Records that _do_ come from logged sets are not stored at all. They're derived by
scanning sessions, exactly like tonnage and e1RM, and each one points at the set
that made it (`session_id`, `exercise_instance_id`, `set_id`) so the UI can open
that session and show the sets around it. A stored PR is a derived value that can
fall out of agreement with the set that produced it.

Note this is a different thing again from the 1RM history. The 1RM history drives
prescriptions and is a decision you make; records are observations.

`lifter/bodyweight.csv` — `date, weight_kg, source`. Needed for `bw_plus` loads.

## Exports

Generated on demand, never a source of truth, and they carry no library-derived
data — no muscles, no tier, no base lift. Exports reference `exercise_id` and the
consumer joins against `exercises.csv`, which is the whole point of having a
truth table.

```
sets.csv       session_id, date, exercise_id, set_n, reps, rpe, load_kg, is_warmup, state
sessions.csv   session_id, date, tz, duration_min, program labels, bodyweight_kg, notes
```

In a notebook that's one join:

```python
df = pd.read_csv('sets.csv').merge(pd.read_csv('exercises.csv'), on='exercise_id')
```
