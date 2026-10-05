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

How the two are kept in step is the code in `src/storage/`, starting at
`sync.ts`; why it works that way is in [`DECISIONS.md`](DECISIONS.md#storage).

## Setup: you create the log repo

On github.com:

1. Create a private repository, any name (`sisyphos-log` is suggested), with
   "Add a README" ticked so it has a first commit.
2. Create a fine-grained personal access token: resource owner yourself,
   repository access only that repository, permissions Contents: read and write.
   GitHub adds Metadata: read by itself. The expiry is your choice.

In the app, enter `owner/repo` and paste the token. The app marks the repo as a
log by writing `sisyphos.json`, and its first sync restores whatever the repo
already holds. It refuses a public repository, and one holding anything but a
README, LICENSE or `.gitignore` without a `sisyphos.json`, which is somebody
else's repository.

A new token can be pasted at any time. Pointing the app at a different repo is a
fresh start with that repo: nothing from the old one is compared against it.

The token stays on the device: it is sent only to `api.github.com`, and never
logged or synced.

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
happens. If it doesn't, the app flags a conflict and you choose. The exact rule
is `src/library/assemble.ts`.

An id never leaves the shipped library once it is in it, since logs reference it
permanently.

## The log repo's files

This is a contract: you read these files on github.com, a notebook reads them,
and a newer version of the app must read what an older one wrote.

Every table has a **key**: the columns that identify a row, and there is exactly
one row per key. The data files only ever hold one version of anything. When
two devices disagree, the version already in the log stays, and the other waits
in `conflicts/` until you choose; no file carries any marker for it.

### Ids

Sessions, templates and conflict records are named by their ids, so those ids
are meant to be read.

| Record          | Id                                                                   | Example            |
| --------------- | -------------------------------------------------------------------- | ------------------ |
| Session         | The session's date when it was created, then four random characters  | `2026-09-14-k3f9`  |
| Template        | Its name when it was created, as a slug, then four random characters | `squat-day-a-k3f9` |
| Conflict record | The date it was found, then four random characters                   | `2026-09-27-7xq2`  |

- Dates are `YYYY-MM-DD`, so file listings sort chronologically.
- The random characters are lowercase Crockford base 32
  (`0123456789abcdefghjkmnpqrstvwxyz`): about a million possibilities per date or
  name, enough for two devices creating records on the same day without talking
  to each other.
- A slug is the name lowercased, every run of characters other than ASCII
  letters and digits replaced by one hyphen, trimmed of hyphens, and cut to 40
  characters (then trimmed again). A name that leaves nothing has the slug
  `template`.
- An id never changes. A session moved to another date, or a template renamed,
  keeps its id: the file name is a label, and the record's fields are the truth.
  A path therefore depends only on the id.
- Ids that never appear in a path (exercise instances, sets) are random UUIDs.

### Serialisation

The same data always produces the same bytes, because sync compares files by
their git blob hash.

- **All files:** UTF-8, no byte-order mark, `\n` line endings, ending in exactly
  one `\n`.
- **JSON:** two-space indentation, keys in a fixed order per type, absent values
  as `null`, never omitted. A file missing a key its format has does not parse:
  a key a newer format adds reaches the files written before it only by
  migrating them (The files).
- **CSV:** a header row, then one row per record, sorted by the table's key
  (numbers numerically, everything else by code point). A cell containing a
  comma, a double quote, `\r` or `\n`, starting with `#`, or starting or ending
  with whitespace, is wrapped in double quotes with inner quotes doubled
  (RFC 4180); no other cell is quoted. `null` is an empty cell, booleans are
  `true` or empty, numbers are JavaScript's shortest round-trip form, dates
  `YYYY-MM-DD`, instants ISO-8601 UTC with milliseconds.

A table whose header is not exactly its format's is unreadable, and so is any
file that does not parse: sync leaves it alone and the app names it. A file that
parses but is formatted differently (hand-edited JSON, say) is rewritten in the
app's form by the next sync.

### The files

`sisyphos.json` — `{ "format": 2 }`. Marks the repo as a log and says which
format its files are in. An app that finds a newer format stops syncing and asks
to be updated; logging on the device carries on. An older format is migrated, in
one commit, before anything else: every session, template and conflict record is
rewritten in the new format, with the marker; a file that does not parse is left
as it is. Nothing a device still on the old version logs is lost: it stops at the
migrated log, and once updated, syncs what it logged meanwhile into it like any
other change.

Format 2 added two keys, which a format-1 file means as null and is migrated
with:

- to every template, `label`: the program label (`name`, `block`, `week`, `day`,
  `weekday`, each nullable) that a session started from it copies;
- to every exercise, in a template and in a session, `rest_s`: the target rest
  between its sets, in whole seconds above zero, or null for its tier's default.

`sessions/<YYYY>/<id>.json` — one session, with its exercises and sets. The folder
is the year in the id, so moving a session to another date edits the file and
moves nothing. Nested, machine-written, never edited by hand. A session planned ahead
has `started_at` null until it starts; an app older than that rule leaves such a
file alone rather than misreading it. An exercise's `rest_s` is the session's own:
it starts as the template's and changes when the rest timer is nudged.

`templates/<id>.json` — one template: the skeleton a session starts from, with
the program label and target rests it hands on.

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
then `based_on`: empty for an exercise the shipped library didn't have, or the
first 12 hex characters of the SHA-1 of the shipped row you changed, as the app
writes that row. Key: `id`. The same parser reads both files, and apart from
`based_on` an addition is the very row the shipped library would hold. A format
change that alters how rows are written must recompute every `based_on`, or every
change you made becomes a false conflict.

`conflicts/<id>.json` — one per unresolved conflict, written once and only ever
deleted. Nothing that reads your data needs to look here.

| Field       | Meaning                                                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| `id`        | See Ids                                                                                               |
| `path`      | The file in conflict                                                                                  |
| `key`       | For a table, the row's key as `{ column: value }`; null for sessions and templates                    |
| `found_at`  | When the sync found it                                                                                |
| `device_id` | The device whose version this is                                                                      |
| `version`   | That device's version: the whole record, or the row as `{ column: value }`; null if it had deleted it |

The version that stands is not copied there: it is whatever the data holds now.

Any other file you put in the log repo is yours: the app never touches it.

## Exports

Not built yet; the screen that will make them is in `UI.md`, Sync and settings.
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
| `library/assemble.ts`    | The shipped library and the lifter's additions combined, and which version wins  |
| `library/submission.ts`  | The prefilled issue that proposes an exercise for everyone                       |
| `metrics/definitions.ts` | Reads `definitions.json`: weight presets and warm-up rules                       |
| `metrics/rpe-chart.ts`   | The RPE→%1RM chart, and `e1rm()`                                                 |
| `metrics/stress.ts`      | The fatigue chart, stress index, central balance                                 |
| `metrics/load.ts`        | Unit conversion, effective load, tonnage                                         |
| `metrics/volume.ts`      | Volume by muscle, by tier and by event                                           |
| `ui/session.ts`          | Every change the session screen makes, as pure functions over a session          |
| `ui/template.ts`         | The same for the template screen                                                 |
| `ui/conflicts.ts`        | A conflict as short lines to compare, for the sync screen                        |
| `ui/*.svelte`            | The screens; `App.svelte` at the root of `src/` wires them to the storage layer  |
| `storage/app.ts`         | What the UI calls: `startStorage()` wires everything below                       |
| `storage/log.ts`         | Sessions, templates, rows and conflicts, read and written as records             |
| `storage/formats.ts`     | Every log-repo file to and from its record (see Serialisation above)             |
| `storage/paths.ts`       | Which path holds what; `ids.ts` makes the readable ids; `hash.ts` the blob hash  |
| `storage/store/`         | The device's copy of the log repo, in IndexedDB, behind one write queue          |
| `storage/sync.ts`        | One sync, step by step; `decide.ts` is its three-way rule                        |
| `storage/remote/`        | GitHub (`github.ts`) and the in-memory GitHub the tests use (`memory.ts`)        |
| `storage/scheduler.ts`   | When syncs run, one at a time, with backoff                                      |
| `storage/setup.ts`       | Connecting a log repo                                                            |
| `storage/status.ts`      | Sync status for the UI; `durability.ts` exposure and persistent storage          |
