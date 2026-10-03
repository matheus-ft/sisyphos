# User interface

What the app shows and does, screen by screen. `STORAGE.md` is how data gets
onto the device and into the log repo; this is everything the lifter touches on
top of it. Where a decision was made, the reason is next to it. What is not
decided yet is listed at the end, with a recommendation for each.

The storage API the screens use is `startStorage()` in `src/storage/app.ts`:
`log` for reading and writing records, `scheduler` for triggers and status,
`connect()` for setup.

## 1. Principles

**Built for the gym.** One hand, a phone in portrait, sweat, a glance between
sets. Tap targets are at least 44 points. Numbers being entered or read mid-set
are the largest thing on screen. Nothing needed during a set sits behind a menu.

**Nothing waits for the network.** Every change is written to the device the
moment it is made (`STORAGE.md` 2.2), and no screen shows a spinner for a local
action. The only thing that ever waits on GitHub is setup.

**Undo instead of confirm.** Recording a set, skipping one, removing an exercise
from a session: done at once, with an undo for a few seconds. Confirmation is
kept for what undo cannot cover: deleting a whole session or template, and
pointing the device at a different repo.

**Derived numbers are computed where they are shown.** e1RM, tonnage, records,
stress and volume are calculated from sets when a screen needs them, never
saved. That is the data model's rule (`DESIGN.md`), and the UI does not get to
break it with a cache.

**The lifter always knows what is safe.** Sync status and exposure are on every
screen (`STORAGE.md` 7.3). A conflict is loud from the moment it is found
(`STORAGE.md` 5.2).

## 2. Shell

### 2.1 Navigation

A bottom tab bar with four tabs:

| Tab      | Holds                                                         |
| -------- | ------------------------------------------------------------- |
| Train    | The session in progress, or how to start one (section 4)      |
| History  | Past sessions (section 5)                                     |
| Analysis | Trends over a date range (section 8)                          |
| More     | Lifter data, library, templates, conflicts, sync and settings |

Routes are in the URL hash (`#/history/2026-09-14-k3f9`). GitHub Pages cannot
send every path to `index.html`, so a reloaded deep link with a real path would
be a 404; a hash never reaches the server. Rejected: one screen with no routes,
which loses the back gesture and reload position.

No UI framework beyond Svelte, and no component library: the bundle is what a
phone with no signal launches from.

### 2.2 The status strip

A thin strip at the top of every screen, showing sync status and exposure in one
line. Tapping it opens Sync (section 10).

| State                                         | Strip says                                                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `safe`, `idle`                                | Nothing alarming; a quiet "Synced"                                                                          |
| Session in progress                           | "Saved on this phone · syncs when you finish". Syncing is paused on purpose, so this is calm, not a warning |
| `pending`                                     | "Not synced yet"                                                                                            |
| `at_risk`                                     | "Not synced for 2 h", in the accent colour                                                                  |
| `unprotected`                                 | "Only on this phone · set up sync", in the accent colour, always                                            |
| `syncing`                                     | "Syncing…"                                                                                                  |
| `offline`, `retrying`                         | "Offline · will retry" with the next attempt's time                                                         |
| `needs_token`, `repo_problem`, `needs_update` | The status's own `message`, which is written to be shown as is, and a tap leads to the fix                  |

The strip takes its wording from `StatusSnapshot` and `Exposure.message`; it
does not invent its own.

### 2.3 Conflicts are loud

Exactly as `STORAGE.md` 5.2 says: a full-screen notice when a sync finds or
pulls a conflict (`onConflicts`, `onLibraryConflicts`), again at every launch
while any is unresolved, and a banner that cannot be dismissed on every screen
until none is left. **Resolve now** is the default button. Section 9 is the
resolution screen.

### 2.4 App updates

`vite-plugin-pwa` installs a new version in the background. The new version
takes over only when no session is in progress, or at the next launch. A reload
mid-session loses nothing, since everything is in IndexedDB, but it throws away
an open set editor and the rest timer, which is not acceptable between sets.
`needs_update` (the log's format is newer than this app) is the exception: the
strip says so and offers to reload at once.

## 3. Setup

### 3.1 First launch

1. **Install.** If the app is running in a Safari tab rather than from the home
   screen (`display-mode: standalone` does not match), a screen explains Share →
   Add to Home Screen, and why: an installed app gets persistent storage and its
   own container, a tab gets neither (`DURABILITY.md`). It can be skipped, and
   then shows again at the next launch from a tab.
2. **Sync or not.** Two choices of equal weight: **Connect a log repo**, or
   **Use without sync**. The second leads straight to Train, with the strip at
   `unprotected` until sync is set up. `DURABILITY.md` asks for this to be an
   explicit choice, not a default.

`requestPersistence()` runs at every launch, silently.

### 3.2 Connecting

A three-step guide, each step with a button that opens the right page on
github.com:

1. **Create a private repository.** Opens `github.com/new` with the name
   `sisyphos-log` and private visibility filled in. The step says to tick
   "Add a README", which the link cannot do.
2. **Create a token.** Opens the fine-grained token page. The step lists exactly
   what to choose: only that repository; Contents, read and write; any expiry.
   Pre-filling these from the link is done if GitHub supports it, and checked
   against the live page before relying on it.
3. **Paste.** One field for the repo, taking `owner/repo` or the repo's URL
   (`parseRepo`), one for the token, and **Connect**.

Connect calls `connect()`. Every `SetupFailure` reason gets its own message
naming the fix: wrong name or invisible to the token (`not_found`), public repo
(`public`, refused: this is training data), not a log (`not_a_log`: other files,
no `sisyphos.json`), a format this app is too old for (`needs_update`), a bad
token (`token`), no connection (`network`), and anything else wrong with the
repo (`repo_problem`, shown in GitHub's words). On success, the first sync starts and the strip
follows it; on a fresh install this is the restore, and Train shows what came
back.

The token field is a password field. Afterwards the token is only ever shown
masked (`maskToken`).

## 4. Train

### 4.1 Starting

Train opens on the session in progress if there is one (`listOpenSessions()`,
the newest of them). Otherwise it offers:

- **Start from a template**: the templates, most recently edited first. A
  session does not record which template it came from, so "most recently used"
  cannot be derived.
- **Start empty.**
- **Log a past session**: section 4.7.

Starting creates the session at once: `newSessionId(today)`, `started_at` now,
`tz` from `Intl.DateTimeFormat().resolvedOptions().timeZone`, `date` today in
that zone, `time_precision: 'instant'`, `device_id` from settings. From a
template, each exercise is copied with its prescribed sets, and one `pending`
performed set per prescribed set, linked by `prescribed_id`.

### 4.2 The session screen

From the top:

- **Header**: date, time elapsed since `started_at`, the label if any, and the
  rest timer (4.4).
- **Exercise cards**, in array order. Each shows the exercise name, the
  prescription in one line (`3 × 5 @ 8`, `80% · 5 reps`, read with
  `formatInterval`), and one row per set. A row shows the load, reps and RPE,
  or what the prescription asks for in a lighter colour while still `pending`.
  The first `pending` set in the session is highlighted: it is the one being
  worked on.
- **Add exercise**, at the bottom: search the library (section 7) by name.
- **Finish**, below everything, so it is never tapped by accident.

Cards can be reordered and removed (with undo). Sets can be added to a card
(copying the previous set's values) and removed. Notes on a set, an exercise or
the session are behind a small notes button, not always on screen.

Every change calls `putSession` at once. Text fields write when they lose focus,
not on every keystroke.

### 4.3 Entering a set

Tapping a set row opens a sheet from the bottom with three large controls:

- **Load**: the number, with − and + buttons stepping by the plate increment,
  and the unit next to it (kg, lb, pins). Tapping the number opens the numeric
  keypad. For `bw_plus` exercises the number is the added load, and may be
  negative for assistance.
- **Reps**: the number, with − and +.
- **RPE**: a row of chips from 6 to 10 in steps of 0.5, one tap. **Warm-up** is
  a toggle beside it; a warm-up needs no RPE.

Time and distance sets show seconds (as minutes and seconds) or metres instead
of load and reps.

The sheet opens pre-filled, in this order of preference: the set's own values if
it has any; the prescription, resolved (an absolute load as is, a percentage
against the reference max in force on the session's date, rounded to the plate
increment); otherwise the previous set of the same exercise in this session.
RPE is never pre-filled: it is what the lifter felt, not what was planned.

**Done** marks the set `done`. It is enabled only when `isComplete()` holds, and
while it is not, the sheet says what is missing ("RPE needed, or mark as
warm-up"), so a half-entered set stays honestly `pending`. **Skip** marks it
`skipped`. Both close the sheet, show an undo, and start the rest timer.

The unit starts as the unit this exercise was last logged in, or its
`default_unit` the first time. "Last logged in" is read from past sessions, not
stored anywhere.

**Bodyweight.** The first time a `bw_plus` set is marked done in a session with
no `bodyweight_kg`, the sheet asks for it. It is never pre-filled (the data
model's rule), because yesterday's weight is a guess.

### 4.4 Rest timer

Marking a set done or skipped starts a timer counting up from zero, shown in the
header, large enough to read from a bench. It is not recorded: it lives in
memory and survives a reload through `sessionStorage`. It counts up rather than
down because no target is configured yet (open question 3).

A PWA on iOS cannot schedule a local notification or vibrate, so the timer is
only on screen. Rejected: promising an alert the platform cannot deliver.

### 4.5 Finishing

**Finish** opens a summary: sets done, skipped and still pending, duration, and
any record set today (from the session-derived records). If any set is still
`pending`, it offers **Skip the rest** and **Leave them pending**; a session with
pending sets shows in History as needing input, which is the data model's own
description of it.

Confirming sets `ended_at` to now, saves, and triggers `session_ended`, which
syncs. Train then shows the start options again.

### 4.6 Editing a finished session

From History, the same screen and the same set sheet, with the header showing
the date instead of a clock. Changes are saved at once and reach the log repo at
the next sync: leaving the app, the sync button, or the next session's end.

The date can be changed (the id and file stay; `DESIGN.md`). Deleting the session
asks for confirmation and is synced as a deletion.

### 4.7 Logging a past session

A date picker, then the same screen. The session is saved with
`time_precision: 'date_only'`, `started_at` at noon of that date in the current
zone, and `ended_at` set when the lifter taps **Save**. Without `ended_at` it
would count as a session in progress (`STORAGE.md` 7.1) and hold syncing back for
three hours. Its duration means nothing, and analysis already ignores the clock
time of `date_only` sessions.

## 5. History

Sessions newest first, grouped by week. Each row shows the date, the label, the
exercises in brief, the heaviest set of each competition lift, and a marker if
any set is still `pending`. A filter narrows the list to sessions containing one
exercise.

Tapping a session opens it read-only, with **Edit** leading to 4.6.

Sessions are read with `listSessions(from, to)` one month at a time as the list
scrolls, not all at once.

## 6. Lifter data

Under More, one screen each:

- **Bodyweight**: a small chart and the list of weigh-ins. Adding one for a date
  that already has one replaces it: one row per date (`DATA.md`).
- **Reference maxes**: the current value for each competition lift, and its
  history. A new value is a new dated entry; old ones stay, because past
  percentage prescriptions resolve against them. The screen shows the best
  recent e1RM and record next to each lift as a suggestion, and never writes it:
  a reference max is always set by hand (`DESIGN.md`).
- **Records**: per exercise, the best weight at each rep count from 1 to 10,
  session-derived and manual together, heavier wins at each rep count. A
  session record opens the session at that set. **Add a record** writes a manual
  one, with an optional RPE and context ("Nationals 2026").

## 7. Library

Search by name, filter by base lift, tier and muscle. Shipped exercises and the
lifter's additions are one list (`log.library()`); an addition is marked.

An exercise's page shows its facts (base lift, tier, muscles by role, load type,
unit) and its history: the heaviest set and best e1RM per session over time.

**New exercise** and **Change** open the same form. The name follows the
submission rule (no commas, double quotes, `#` or `@`), checked as it is typed,
not on save. Saving calls `saveExercise`, which works offline at once, and then
opens the prefilled submission (`submissionUrl`) on github.com.

Safari only opens a new window from inside the tap itself, and saving is
asynchronous. So the tap opens an empty window first, and points it at the
submission once the save is done. If the window was blocked anyway, the
confirmation offers a **Propose on GitHub** button instead.

## 8. Analysis

One date range drives every view. It is picked from presets (last 4, 8 or 12
weeks; this year), from a custom range, or from a label: choosing "Block 2"
selects from the first to the last session carrying it (`README.md`).

Views:

- **Per lift**: best e1RM per session over time; sets by tier
  (`setsByTierForLift`), shown as the discrete breakdown first ("6 comp, 2
  high-spec, 3 accessory"); tonnage.
- **Muscles**: volume by muscle group (`volumeByMuscle`), with the counting
  preset (fractional, direct, 1:1) switchable in place.
- **Stress**: peripheral and central per week (`totalStress`), and per muscle
  (`stressByMuscle`).
- **Records**: when each record was set.

Switching a preset recomputes in place (`DESIGN.md`: presets are switchable
live). The active presets are remembered on the device only; they are a viewing
choice, not training data.

Charts are small Svelte components drawing SVG. Line and bar charts over a few
hundred points are all this needs, and each one is shown on purpose. Rejected
for now: a charting library, which costs bundle size for features nothing uses.

## 9. Conflicts

Under More, and wherever the notice or banner leads (2.3). The list shows each
conflict with what it is (a session by date and label, a template by name, a
table row by its key), when it was found, and from which device.

Resolving one shows the two versions side by side: the one in the log and the
saved one, differences highlighted. A table row compares field by field; a
session compares exercise by exercise and set by set, so "set 3: 140 × 3 @ 8 vs
140 × 3 @ 8.5" is visible without reading JSON. A deleted version shows as
"deleted".

| Button                 | Calls                                               |
| ---------------------- | --------------------------------------------------- |
| Keep the log's version | `resolveConflict(id, 'keep_log')`                   |
| Use the saved version  | `resolveConflict(id, 'use_saved')`                  |
| Use the shipped one    | `resolveLibraryConflict(exerciseId, 'use_shipped')` |
| Keep mine              | `resolveLibraryConflict(exerciseId, 'keep_mine')`   |

The device is shown as "this phone" when `device_id` matches this device, and as
"another device" otherwise (open question 7).

## 10. Sync and settings

Under More:

- **Sync**: the status and exposure in full, with the exposure's message, the
  number of files waiting, and **Sync now** (the `manual` trigger). Files left
  alone because they do not parse are listed by path, with what to do: fix or
  remove them in the repo on github.com.
- **Log repo**: the repo and the masked token. **Replace token** changes only
  the token. **Use a different repo** asks for confirmation, because the device
  then forgets everything it shared with the old repo (`STORAGE.md` 8).
- **Storage**: whether the browser granted persistent storage, and how much
  space is used.
- **Export**: `sets.csv` and `sessions.csv` (`DATA.md`), generated on the device
  with no network, and handed over as downloads.

## 11. Order of building

Each step ends with something usable on the phone:

1. The shell (2), setup (3) and the sync screen (10). The dev panel goes.
2. Train (4): starting empty, the set sheet, finishing.
3. Conflicts (2.3, 9), before anything else writes data from two devices.
4. History (5) and editing finished sessions (4.6, 4.7).
5. Lifter data (6), then templates: listing them, editing them, starting from one.
6. The library (7).
7. Analysis (8).

## Not decided yet

Each has a recommendation; the spec above assumes it until decided otherwise.

1. **How a set is entered.** Recommended: the bottom sheet (4.3). The
   alternative is editing in the row, which is faster for a lifter who changes
   nothing and harder to hit with sweaty thumbs.
2. **Plate increment and rounding.** Recommended: 2.5 kg and 5 lb, one setting
   per unit, used for the − and + buttons and for rounding resolved
   percentages. Some gyms have 1.25 kg plates.
3. **Rest targets.** Recommended: count up only, for now. A target per exercise
   or per template can come later; without notifications it can only change a
   colour.
4. **When a set was done.** `PerformedSet` has no timestamp, so rest times and
   session pacing cannot be analysed. Recommended: add `done_at` to performed
   sets, which is a change to the data model and its format.
5. **Where labels come from.** `ProgramLabel` is copied from a prescription
   source, but templates carry no program, block or week. Recommended: type the
   label on the session, with the previous session's label offered as one tap.
   The alternative is a program layer above templates.
6. **Session bodyweight and weigh-ins.** Entering a session's bodyweight for a
   `bw_plus` set does not add a weigh-in. Recommended: offer to also record it
   as the day's weigh-in, one tap, not automatic. These are two facts that
   happen to share a value, so this stores nothing twice.
7. **Device names.** Conflicts can only say "this phone" or "another device".
   Recommended: let each device be named in settings, stored on the device with
   its `device_id`, and shown in conflicts. It is not synced, so a name only
   shows on the device that gave it.
8. **Interrupting during a session.** `STORAGE.md` 5.2 interrupts the moment a
   conflict is found. During a session only a launch pull can find one.
   Recommended: interrupt anyway; it is rare and it is the rule.
9. **Display units.** Recommended: each set keeps the unit it was logged in, and
   analysis shows kilograms. A setting to show pounds everywhere can come later.
10. **Hosting origin.** `STORAGE.md` lists it. It decides where the token lives,
    and it must be settled before the first real token goes on a phone.
