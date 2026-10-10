# Decisions

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

How it works is the code in `src/storage/`, mapped in `DATA.md` (Source layout),
and the log repo's format is in `DATA.md`. What follows is why.

**JSON on device, one document per session.** A session is roughly 4KB; five
sessions a week is about 1MB a year. SQLite-in-the-browser was considered and
dropped: it means a ~1MB wasm payload plus OPFS handling on iOS, and it buys
query performance this dataset will never need.

**The log repo holds one file per session and per template, and one table per
kind of lifter data.** Sessions and templates are nested documents, edited as a
whole; bodyweight, reference maxes, manual records and custom exercises are
rows, and read as tables. Two devices editing different sessions never touch the
same file.

Rejected: a file per bodyweight entry. It would make sync uniform, but a daily
time series as hundreds of files a year is the wrong shape for the data.
Rejected: one JSON file per kind of lifter data. It shares a file between
devices exactly as a CSV does, so it needs the same row merge, and gives up the
table.

**Sync works the way git does: one commit per sync, and the branch only moves
forward.** A sync reads what the remote changed since this device last agreed
with it, merges, writes everything as one commit, and moves the branch only if
nothing else moved it first. That refusal is the compare-and-swap: it needs no
coordination and cannot lose data. Restoring a reinstalled app is just a first
sync.

Rejected: the Contents API, file by file. It made a commit per file with no way
to push several atomically, had no cheap way to ask what changed, and answers
422 both for "someone else wrote this" and for plain validation errors.

**Rejected: file locking.** Acquiring a lock needs the network, and the moment
you most need to write — mid-session, no signal — is the moment you cannot
acquire one. Stale locks after a dead phone have no clean recovery either.

**What needs syncing is derived, never stored.** Each file's content hash is
compared with the hash both sides last agreed on; a difference is what needs
syncing. Rejected: a dirty queue. A flag has to be cleared at exactly the right
moment, and every way of clearing it at the wrong one (an edit during a save, an
edit during a push, a failed write) lost a change in the first version of this
layer. A hash cannot fall out of step with the content it is computed from. It
is the same rule as everything else here: nothing derived is stored.

**Conflicts are resolved by hand, and the app insists on it early.** When two
devices change the same record differently, the version already in the log
stands, the other is saved in `conflicts/` in the log repo, and sync carries on.
The app interrupts with the conflict the moment it is found, and keeps a banner
up until it is resolved, because it is easiest to settle while both versions are
fresh in mind.

The data files never carry the conflict. Rejected: marking conflicting versions
inside the data, with a flag on a session or a second row for a key in a table.
Every reader of the data (analysis, exports, a notebook) would then need to know
to skip them, and a table could no longer promise one row per key. Kept in the
log repo rather than on the device, the saved version still syncs, shows on
every device and survives losing the phone.

Rejected: the later write wins. It silently replaces a weigh-in or a reference
max with whichever device synced last. Rejected: asking at sync time. It blocks
sync on a decision, and keeps the pending decision on one device, where a
reinstall loses it.

**Accepted: a deletion can be undone by a concurrent write.** The three-way
comparison sees where a record ended up, not how. Create-then-delete, or
restore-then-delete, between syncs looks like no change at all, so another
device's write of the same record stands and the deletion is not flagged.
Nothing is lost: the record comes back, and it can be deleted again. Rejected: a
per-record changed-since-sync marker, which reintroduces the kind of stored
flag this design removed, and only covers the deleting device's side. Rejected:
tombstones in the files, which catch both sides but make every file carry its
deleted entries forever, and need a purge rule. Neither is worth it for a race
this narrow in one lifter's log. The simulation (`tests/sim/`) allows exactly
this case and fails on anything wider.

**Local writes are immediate; the log repo is written at three moments.** Every
change is on the device the moment it is complete. The log repo is written when
a session ends, when the lifter asks, and when the app is left outside a
session; launching finishes anything a previous sync did not. The browser cannot
tell closing the app from locking the phone, and iOS reports a lock between sets
as leaving the app, so leaving syncs only when no session is in progress (none
written in the last three hours). The history gets about one commit per session.
Losing the phone mid-session loses that session, and that risk is accepted.
Rejected: a timer that syncs after ten minutes of quiet, which pushed
mid-session, on mobile data.

**Sessions and templates have readable ids.** Their ids name their files, so a
session is `2026-09-14-k3f9`: its date when created, then four random
characters. Rejected: UUIDs, which make the log repo unreadable. Rejected: the
date alone, which collides for two sessions on one day or two devices working
offline. Rejected: `14Sep26`-style dates, which do not sort. An id never
changes, so re-dating a session or renaming a template moves no file.

**You create the log repo; the app does not.** A token allowed to create
repositories must be allowed far more than one repo, and a token limited to
selected repositories can only name ones that already exist. Creating it by hand
is one click, and keeps the token scoped to Contents on that one repo.

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

**The muscle vocabulary is not user-editable.** Nothing in the storage layer
writes it, on purpose: exercises reference muscle ids permanently, so a
rename would silently break every exercise pointing at it. Adding an exercise is
a submission that becomes a pull request; changing the vocabulary is a change to
the app.

**Submitting an exercise opens a prefilled issue in the browser**, which the
lifter submits signed in on github.com. Rejected: filing it with the log token.
A fine-grained token cannot write to a repository its owner does not own, so
that would work for the app's author and nobody else.

**Your change to a shipped exercise wins until the shipped exercise changes.**
Disagreeing with the library is ordinary: you fix a row locally and it applies
at once, and a submission proposing the fix opens by itself. Each addition
records which shipped row it was made against, so the library gets the same
three-way rule as sync. A shipped row that has not moved since your change
loses to it. One that now matches yours means your fix was merged, and nothing
is flagged. One that changed differently is a conflict, flagged like any other,
because a reviewer's correction should neither silently override you nor be
silently ignored. Rejected: the addition always winning, which ignores every
later correction. Rejected: the shipped row always winning, which would undo
your fix at the next app update.

**Seventeen flat muscle groups, no finer level.** Exercises credit groups like
`hamstrings` and `front_delts` directly; `docs/MUSCLES.md` defines each one.
The provisional vocabulary had 37 anatomical leaves with overlapping tags rolled
up above them. Rejected: tagging an exercise at the level of individual heads
claims a precision nobody has, and overlapping tags produce totals that cannot be
summed. Flat groups add up, and a group is still fine enough to show an
imbalance.

## Two weighting axes, and the breakdown always survives

Muscle roles (`primary` / `aux`) and specificity tiers get the same
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

**Two muscle roles, not three.** A `secondary` role between primary and aux was
dropped. The counting schemes worth having are `fractional` (1 / .5), `direct`
(1 / 0) and `1:1` (1 / 1), and none of them needs a middle value.

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

**Records are kept for the lifts taken to the platform only**, each stance its
own. They are what a record measures progress in; a laurel on every accessory,
or on the squat stance only trained, made one on the real lift mean less. Which
lifts those are is the lifter's choice, so it is config (`definitions.json`),
not the library's tier: high-bar squat is a competition lift, but not this
lifter's.

**A meet's best is a fourth thing, in a table of its own**
(`lifter/competition-bests.csv`). A single made on a platform is peaked for and
judged, so it is neither a training record nor a reference max, and the app
shows all three side by side rather than letting one stand for another.
Rejected: a `competition` flag on a hand-entered record. Adding a column to a
table changes the log's format, so every device's copy and every sync base
would need migrating, and an older app could no longer read the file at all; a
new file is additive, since an older app leaves a file it does not know alone.

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
but never install it. `.github/workflows/ci.yml` checks and publishes every push to
master; the manifest uses relative `start_url` and `scope` so the same build works
at the domain root or under `/<repo>/`.

## Hosting

The app is served from `https://matheus-ft.github.io/sisyphos/`, and the GitHub
token lives in that origin's storage. Every GitHub Pages site under
`matheus-ft.github.io` shares the origin, so the JavaScript of any of them could
read the token.

**It stays there while it is the only Pages site on that account.** It is today,
so the risk is nil, and moving costs a setup on every device.

**Before any other Pages site is published under `matheus-ft.github.io`**,
including a personal site in a repo named `matheus-ft.github.io`, the app moves
to an origin of its own: a free GitHub organisation (`<org>.github.io`), or a
custom domain. In this order:

1. On every device, sync until the status says synced. Storage does not follow
   the app to a new origin, so anything only on the device stays behind.
2. Transfer the repository, and update what names `matheus-ft/sisyphos`:
   `APP_REPO` in `src/library/submission.ts`, and the README's address.
3. On each device, install from the new address and connect the same log repo.
   The first sync restores everything.
4. Delete the old home-screen app, which deletes its storage and the token in it,
   and replace the token. GitHub does not redirect a project site whose
   repository moved, and the old app keeps running from its cache until deleted.

The log repo is untouched: only the app's repository moves.
