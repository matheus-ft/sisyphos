# Where things live

Two repositories, and the split is not arbitrary: it's the line between what the
app _is_ and what the app _records_.

```
sisyphos/                          ← this repo. Code and the shared library. AGPL.
└── src/, tests/, docs/, scripts/

sisyphos-log/                      ← your own PRIVATE repo. Your training.
├── sisyphos.json                  format marker
├── sessions/2026/2026-09-14-k3f9.json
├── templates/squat-day-a-k3f9.json
├── lifter/bodyweight.csv
├── lifter/one-rm-history.csv
├── lifter/manual-records.csv
├── library/additions.csv          exercises you made or changed
└── conflicts/                     versions waiting for you to choose
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
your own additions in `library/additions.csv` in the log repo: exercises you
created, and shipped ones you changed. The two are combined when read, never
copied into each other.

An exercise you create or change goes into your additions at once, so it works
offline, and the app opens a prefilled issue proposing it for everyone. You tap
Submit on github.com; a workflow validates it and opens a pull request adding
or replacing the row in the shipped file.

Your change to a shipped exercise wins until the shipped exercise itself
changes. If it then matches yours, your submission was merged and nothing
happens. If it doesn't, the app flags a conflict and you choose. `STORAGE.md`
section 9 has the exact rule.

## The log repo's files

Every table has a **key**: the columns that identify a row, and there is exactly
one row per key. The data files only ever hold one version of anything. When
two devices disagree, the version already in the log stays, and the other waits
in `conflicts/` until you choose; no file carries any marker for it.

`sisyphos.json` — `{ "format": 1 }`. Marks the repo as a log and says which
format its files are in.

`sessions/<YYYY>/<id>.json` — one session, with its exercises and sets. The id is
the session's date when it was created plus four random characters, such as
`2026-09-14-k3f9`, and the folder is that date's year. An id never changes, so
moving a session to another date edits the file and moves nothing. Nested,
machine-written, never edited by hand.

`templates/<id>.json` — one template: the skeleton a session starts from. The id
is its name when created plus four random characters, such as
`squat-day-a-k3f9`, and it survives renaming.

`lifter/bodyweight.csv` — `date, weight_kg, source`. Key: `date`, since there is
at most one weigh-in a day. Needed for `bw_plus` loads.

`lifter/one-rm-history.csv` — `date, lift, weight_kg, note`. Key: `date, lift`.
Effective-dated reference maxes that resolve percentage prescriptions. Always set
by hand.

`lifter/manual-records.csv` — `date, exercise_id, reps, weight_kg, rpe, context`.
Key: `date, exercise_id, reps`. Records with **no session behind them**: a
competition lift, or anything from before you started logging here.

Records that _do_ come from logged sets are not stored at all. They're derived by
scanning sessions, exactly like tonnage and e1RM, and each one points at the set
that made it (`session_id`, `exercise_instance_id`, `set_id`) so the UI can open
that session and show the sets around it. A stored PR is a derived value that can
fall out of agreement with the set that produced it.

Note this is a different thing again from the 1RM history. The 1RM history drives
prescriptions and is a decision you make; records are observations.

`library/additions.csv` — the columns of the shipped `src/library/exercises.csv`,
then `based_on`: empty for an exercise the shipped library didn't have, or a
short hash of the shipped row you changed. Key: `id`. The same parser reads both
files, and apart from `based_on` an addition is the very row the shipped library
would hold.

`conflicts/<id>.json` — one per unresolved conflict: which file (and for a
table, which row), when it was found, which device's version it is, and that
version. The app shows these the moment it finds them and until you choose;
`STORAGE.md` section 5 has the rules. Nothing that reads your data needs to look
here.

Any other file you put in the log repo is yours: the app never touches it.

## Exports

Not built yet; the screen that will make them is in `UI.md` section 10.
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

## Source layout

| Path                     | Contents                                                                         |
| ------------------------ | -------------------------------------------------------------------------------- |
| `model/primitives.ts`    | Scalars: ids, instants, dates, intervals, load units                             |
| `model/taxonomy.ts`      | Muscles and exercises: what `src/library/*.csv` describes                        |
| `model/records.ts`       | What you record: sessions, sets, templates, reference maxes, records, bodyweight |
| `model/index.ts`         | Re-exports the three; import from here, not from the parts                       |
| `csv.ts`                 | The CSV reader and writer (RFC 4180). No dependency                              |
| `library/parse.ts`       | CSV rows → `Muscle` and `Exercise`, with validation and defaults                 |
| `library/assemble.ts`    | The shipped library and the lifter's additions combined (`STORAGE.md` 9.1)       |
| `library/submission.ts`  | The prefilled issue that proposes an exercise for everyone (`STORAGE.md` 9.2)    |
| `metrics/definitions.ts` | Reads `definitions.json`: weight presets and warm-up rules                       |
| `metrics/rpe-chart.ts`   | The RPE→%1RM chart, and `e1rm()`                                                 |
| `metrics/stress.ts`      | The fatigue chart, stress index, central balance                                 |
| `metrics/load.ts`        | Unit conversion, effective load, tonnage                                         |
| `metrics/volume.ts`      | Volume by muscle, by tier and by event                                           |
| `storage/`               | The device store, sync and scheduling, specified in `STORAGE.md`                 |
