# Where things live

Two repositories, and the split is not arbitrary: it's the line between what the
app _is_ and what the app _records_.

```
sisyphos/                          ← this repo. Code and the shared library. AGPL.
└── src/, tests/, docs/, scripts/

sisyphos-log/                      ← your own PRIVATE repo. Your training.
├── sisyphos.json                  format marker
├── sessions/2026/<id>.json        one file per session
├── templates/<id>.json            one file per template
├── lifter/bodyweight.csv
├── lifter/one-rm-history.csv
├── lifter/manual-records.csv
└── library/additions.csv          exercises you made
```

Nothing personal is committed here. Your bodyweight is not a project asset.

How the two are kept in step — writing, syncing, conflicts — is specified in
[`STORAGE.md`](STORAGE.md).

## Setup: you create the log repo

On github.com you create a private repository (any name; `sisyphos-log` is
suggested) and a fine-grained token that can read and write Contents on that one
repository and nothing else. In the app you enter the repo's name and paste the
token. The app marks the repo as a log, and its first sync restores whatever the
repo already holds. `STORAGE.md` section 8 has the details.

The app never creates the repo: a token allowed to do that is allowed far more
than one repository.

## Shipped with the app

| File                           | What it holds                                                                                                                                                               | Who edits it                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/metrics/definitions.json` | Every metric definition: role and tier weight presets, which metrics count warm-ups, bodyweight and tonnage settings. Settings list their alternatives in an `_options` key | You, when you change your mind about a definition                                   |
| `src/library/muscles.csv`      | The 17 muscle groups exercises credit: `id`, `name`. See `docs/MUSCLES.md`                                                                                                  | Rarely. Adding one is additive; renaming an id breaks every exercise pointing at it |
| `src/library/exercises.csv`    | The shared exercise library                                                                                                                                                 | Everyone, through submissions (below)                                               |
| `src/metrics/rpe-chart.csv`    | `rpe, reps, factor`: the RPE/RIR chart. 232 rows, deliberately ragged: low-RPE rows stop short of 12 reps                                                                   | Nobody, unless you swap charts                                                      |
| `src/metrics/stress-chart.csv` | `rpe, reps, peripheral, central`: per-set fatigue. 252 rows, complete                                                                                                       | Nobody                                                                              |

## The exercise library

The exercises you can pick from are the shipped `src/library/exercises.csv` plus
your own additions in `library/additions.csv` in the log repo. The two are
combined when read, never copied into each other.

An exercise you create goes into your additions at once, so it works offline.
Proposing it for everyone opens a prefilled issue on github.com; a workflow
validates it and opens a pull request adding the row to the shipped file.

## The log repo's files

Every table has a **key**: the columns that identify a row. There is at most one
row per key, except while two versions of it are in conflict. Every table ends
with the same two columns:

- `updated_at` — when the row last changed. Shown when you resolve a conflict;
  never used to decide anything.
- `conflict` — empty, or `both_edited` / `edited_and_deleted` on a version kept
  because two devices disagreed. `STORAGE.md` section 5 says what each means.

`sisyphos.json` — `{ "format": 1 }`. Marks the repo as a log and says which
format its files are in.

`sessions/<YYYY>/<id>.json` — one session, with its exercises and sets. The year
is the year the session was created, so moving a session to another date edits
the file and moves nothing. Nested, machine-written, never edited by hand.

`templates/<id>.json` — one template: the skeleton a session starts from.

`lifter/bodyweight.csv` — `date, weight_kg, source, updated_at, conflict`. Key:
`date`, since there is at most one weigh-in a day. Needed for `bw_plus` loads.

`lifter/one-rm-history.csv` — `date, lift, weight_kg, note, updated_at,
conflict`. Key: `date, lift`. Effective-dated reference maxes that resolve
percentage prescriptions. Always set by hand.

`lifter/manual-records.csv` — `date, exercise_id, reps, weight_kg, rpe, context,
updated_at, conflict`. Key: `date, exercise_id, reps`. Records with **no session
behind them**: a competition lift, or anything from before you started logging
here.

Records that _do_ come from logged sets are not stored at all. They're derived by
scanning sessions, exactly like tonnage and e1RM, and each one points at the set
that made it (`session_id`, `exercise_instance_id`, `set_id`) so the UI can open
that session and show the sets around it. A stored PR is a derived value that can
fall out of agreement with the set that produced it.

Note this is a different thing again from the 1RM history. The 1RM history drives
prescriptions and is a decision you make; records are observations.

`library/additions.csv` — exactly the columns of the shipped
`src/library/exercises.csv`, then `updated_at, conflict`. Key: `id`. The parser
reads columns by name, so the same parser reads both files.

Any other file you put in the log repo is yours: the app never touches it.

## Exports

Generated on demand, never a source of truth, and they carry no library-derived
data — no muscles, no tier, no base lift. Exports reference `exercise_id` and the
consumer joins against `exercises.csv`, which is the whole point of having a
truth table. Anything marked as a conflict is left out.

```
sets.csv       session_id, date, exercise_id, set_n, reps, rpe, load_kg, is_warmup, state
sessions.csv   session_id, date, tz, duration_min, program labels, bodyweight_kg, notes
```

In a notebook that's one join:

```python
df = pd.read_csv('sets.csv').merge(pd.read_csv('exercises.csv'), on='exercise_id')
```

## Source layout

| Path                     | Contents                                                                         |
| ------------------------ | -------------------------------------------------------------------------------- |
| `model/primitives.ts`    | Scalars: ids, instants, dates, intervals, load units                             |
| `model/taxonomy.ts`      | Muscles and exercises: what `src/library/*.csv` describes                        |
| `model/records.ts`       | What you record: sessions, sets, templates, reference maxes, records, bodyweight |
| `model/index.ts`         | Re-exports the three; import from here, not from the parts                       |
| `csv.ts`                 | The CSV reader. No dependency                                                    |
| `library/parse.ts`       | CSV rows → `Muscle` and `Exercise`, with validation and defaults                 |
| `metrics/definitions.ts` | Reads `definitions.json`: weight presets and warm-up rules                       |
| `metrics/rpe-chart.ts`   | The RPE→%1RM chart, and `e1rm()`                                                 |
| `metrics/stress.ts`      | The fatigue chart, stress index, central balance                                 |
| `metrics/load.ts`        | Unit conversion, effective load, tonnage                                         |
| `metrics/volume.ts`      | Volume by muscle, by tier and by event                                           |
| `storage/`               | The device store, sync and scheduling, specified in `STORAGE.md`                 |
