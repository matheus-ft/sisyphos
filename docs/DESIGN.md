# Design decisions

What was settled and why, so the reasoning survives past the point where anyone
remembers having the argument.

## Platform

**Installable PWA, no backend.** A native iOS app needs a signing certificate;
without a paid Apple developer account those last seven days and must be
re-deployed from Xcode weekly, forever. That applies identically to Swift, React
Native, Flutter and Capacitor, so the constraint collapses the choice to PWA,
weekly re-signing, or $99/year.

The cost is WebKit on the phone — every iOS browser is Safari underneath,
whatever the user has installed. Accepted knowingly.

**Rejected: Vite 8 / Rolldown.** Its native binding would not install on
darwin-arm64. Vite 7 is Rollup-based, mature, and what `vite-plugin-pwa` is
tested against. A bleeding-edge bundler is a bad trade in a project meant to last
years.

## Storage

**JSON on device, one document per session.** A session is roughly 4KB; five
sessions a week is about 1MB a year. SQLite-in-the-browser was considered and
dropped: it means a ~1MB wasm payload plus OPFS handling on iOS, and it buys
query performance this dataset will never need.

Per-session documents make sync granular. Two devices editing different sessions
never conflict, which is what made a locking scheme unnecessary.

**Rejected: file locking.** Acquiring a lock needs the network, and the moment
you most need to write — mid-session, no signal — is the moment you cannot
acquire one. Stale locks after a dead phone have no clean recovery either. The
GitHub Contents API's sha requirement provides compare-and-swap instead, which
needs no coordination and cannot lose data.

**Rejected: iCloud Drive.** No web API exists. Safari has no File System Access
API, so a PWA cannot write to a user folder without a Share Sheet tap each time.
Google Drive was possible but costs an OAuth client and eventual verification;
GitHub needs one pasted token and yields version history as a side effect.

## Layout

Data files sit beside the code that reads them: `muscles.csv` and
`exercises.csv` next to the parser in `src/library/`, the two lookup charts next
to the modules that load them in `src/metrics/`. A separate config tree at the
repo root would only be a second place to keep in step with the first.

Saving locally and pushing remotely are one concern, not two, so they share
`src/storage/` rather than sitting in adjacent directories that must agree.

## Taxonomy

Exercises carry objective facts: base lift, specificity tier, muscles by role.
Tiers are `comp`, `high_spec`, `low_spec`, `acc`, and specificity is relative to
one base lift — a squat accessory contributes squat volume and never deadlift
volume, regardless of transfer.

**Reclassification rewrites history.** Effective-dated classification was
considered and rejected as more machinery than the problem deserves. Retag an
exercise and every past analysis reads the new way.

**The muscle vocabulary is not user-editable.** There is no writer for it in
`StorageAdapter`, on purpose: exercises reference muscle ids permanently, so a
rename would silently break every exercise pointing at it. Adding an exercise is
a submission that becomes a pull request; changing the vocabulary is a change to
the app.

**Seventeen flat muscle groups, no finer level.** Exercises credit groups like
`hamstrings` and `front_side_delts` directly; `docs/MUSCLES.md` defines each one.
The provisional vocabulary had 37 anatomical leaves with overlapping tags rolled
up above them. Rejected: tagging an exercise at the level of individual heads
claims a precision nobody has, and overlapping tags produce totals that cannot be
summed. Flat groups add up, and a group is still fine enough to show an
imbalance.

## Two weighting axes, and the breakdown always survives

Muscle roles (`primary` / `secondary` / `aux`) and specificity tiers get the same
treatment: named weight presets, switchable live, with the numbers in config
rather than in code. Tonnage defaults to `competition` (1 / 1 / 0 / 0) because an
accessory kilogram is not a competition kilogram; set counts and stress default
to `graded` (1 / .75 / .5 / .25) because specificity decays rather than cutting
off.

The weighted total never replaces the discrete breakdown. `setsByTierForLift`
answers "for the squat: 6 comp, 2 high-spec, 3 accessory", which is usually the
more useful sentence; `eventVolume` collapses that to one number only when you
need to compare blocks. Building the weighted version first would have made the
discrete one hard to recover, so both exist from the start.

Those same muscle weights scale per-muscle **stress**, not just volume, so
switching preset moves both together. Movement-level stress is never scaled: the
set cost what it cost, and only attributing it to individual muscles is a
modelling choice.

## Config holds only genuine choices

Three kinds of setting were removed rather than documented.

**Derivable.** The highest rep count e1RM can speak to is a property of the
chart. `MAX_CHART_REPS` is read off the chart itself, where it cannot disagree
with the data.

**Settled.** A unilateral set moved twice what was logged and is still one set.
There is no defensible alternative, so the multipliers are constants. Records run
to 10 reps for the same reason: above that a best-ever is a conditioning result
the RPE chart cannot price.

**Already determined elsewhere.** There is no null policy. A set's state says
whether it counts, and `isComplete()` defines what `done` requires — reps, a
load, and an RPE unless it was a warm-up. A set with no RPE simply is not `done`,
so no metric has to ask what a missing RPE means and the two can never disagree.

Also deleted: an AMRAP switch (a set of 8 is a record at 8 whatever the
prescription said), a "sum the components" stress variant (the same number
doubled), and the SI component variants — `totalStress` already returns
peripheral and central separately, so a definition was never needed to see them.

`include_warmups` was repeated inside four metrics; now one `warmups.counted_in`
list names which metrics count them.

## Time

Sessions store a UTC instant plus an IANA zone name. The instant gives true
elapsed hours across travel; the zone gives correct local wall-clock for
time-of-day analysis. A fixed offset would break across DST and cannot do both.

`time_precision` distinguishes a real clock time from a date entered after the
fact, so retroactive logs are excluded from time-of-day analysis rather than
filling it with fake midnights.

## Records come from two places, and one of them is stored

`PersonalRecord` is a discriminated union. `source: 'session'` records are
derived by scanning sessions and point at the set that made them — a stored
record is a derived value that can fall out of agreement with its own source.
`source: 'manual'` records are stored, because nothing can derive a competition
lift from years ago, and entering your existing records on day one is exactly
what they are for. No recompute touches them.

Reference maxes are a third thing again: `OneRmEntry` drives percentage
prescriptions, is set by hand, and is effective-dated so raising it never
rewrites what a past session asked for.

## Rejected: storing anything twice

`ExerciseInstance` had an `order` field. Removed — array position already carries
it, and a stored index can end up disagreeing with the array that holds it.

The lookup charts were nested JSON keyed by RPE with arrays indexed by reps-1.
Now long-format CSV, which is the actual shape of the data, diffs one cell at a
time, and greps.

`PerformedSet` carried `load`, `unit`, `duration_s` and `distance_m` as four
nullable fields, which permitted a timed set measured in kilograms. Replaced by a
discriminated union: `{kind: 'weight', value, unit} | {kind: 'time', seconds} |
{kind: 'distance', meters}`.

## Pins is a unit, not a scale

`LoadUnit` is `'kg' | 'lb' | 'pins'`, where kg and lb convert freely and pins
converts to nothing. `toKg()` returns null for pins, which structurally prevents
a stack position being summed into a tonnage total — the check lives in the type
rather than in a flag somebody could turn off.

The unit belongs to the set, not the exercise: two gyms label the same cable
machine differently. `Exercise.default_unit` survives only as a hint for the
entry form.

## Rejected: relative_previous prescriptions

"Last week plus 2.5kg" is something you do in your head. As a stored prescription
mode it needs a rule for what "last time" means when you miss a session, run the
exercise twice in a week, or change templates — and every answer is wrong
sometimes.

## Durability is a feature, not a caveat

See `docs/DURABILITY.md`. Deleting an installed app deletes its storage, the same
as deleting a native app, so the design answer is that the phone is never the
only place a session exists. `storage/durability.ts` requests persistent storage
and computes an `exposure()` level the UI shows permanently — and `unprotected`
cannot be escaped by a tidy local state, because no unsynced documents on a
device with nowhere to sync to means everything is unsynced.

## Deployment is a hard requirement

Logging from the phone has to be reliable and hassle-free, so the Pages workflow
exists before any UI does. A service worker only registers in a secure context,
which means HTTPS, which means a real deploy — a LAN address will load the page
but never install it. `.github/workflows/deploy.yml` publishes on every push to
master; the manifest uses relative `start_url` and `scope` so the same build works
at the domain root or under `/<repo>/`.
