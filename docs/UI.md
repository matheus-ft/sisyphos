# User interface

What the lifter sees, in three stages:

- **v0** replaces a notes app: type in the session being trained, saved at once,
  synced when it ends. It is what ships now.
- **v0.5** is the bridge to v1: every screen the app needs, specified here, built
  after v0.
- **v1** is shaped by a designer, starting from v0.5.

This is a spec for screens not built yet. Each section is pruned as its screen
ships, down to what the code cannot say.

The screens sit on the storage layer: `startStorage()` in `src/storage/app.ts`
gives `log` (records), `scheduler` (syncing and its status) and `connect()`
(setup).

## Principles

**Built for the gym.** One hand, a phone in portrait, a glance between sets. Tap
targets are at least 44 points, and the numbers being entered are the largest
thing on screen.

**Nothing waits for the network.** A change is written to the device when it is
complete (a set's field left, a set marked done), not per keystroke, and is
shown as saved only once its write resolves. Only setup waits on GitHub.

**Derived numbers are computed where they are shown,** never saved
(`DESIGN.md`).

## v0: logging a session

Built, in `src/App.svelte` and `src/ui/`: the session screen, setup, the status
line, and templates with exact targets.

## v0.5: the bridge

### Shell

Four tabs: **Train** (the v0 screen), **History**, **Analysis**, **More** (lifter
data, library, templates, conflicts, settings). Routes live in the URL hash,
since GitHub Pages cannot serve a deep link with a real path.

A new app version takes over only outside a session, or at the next launch: a
reload mid-session would lose the open set and the rest timer.

### Entering a set

Both ways, as the lifter prefers at the moment: typing into the row, as in v0;
or tapping the set's number, which opens a panel from the bottom with large −
and + buttons for load and reps and one-tap RPE buttons from 6 to 10 in halves.

The − and + buttons step by the plate increment, set per unit in settings (for
example 2.5 kg, or 1.25 kg where the gym has the plates), which also rounds
percentage prescriptions.

The panel is pre-filled from the set itself, then the prescription (a
percentage resolved against the reference max in force on the session's date),
then the previous set. RPE is never pre-filled.

### Rest timer

After a set is ticked, a timer shows on screen, large enough to read from a
bench. It counts up by default; an exercise can have a target rest, counted
down instead and turning red at zero. It is not saved. An iPhone web app cannot
ring or vibrate, so it never claims to.

### Templates

v0 builds them with exact targets. v0.5 adds a program label (program name,
block, week, day, weekday), which a session started from it copies:
"Block 2, week 3" is a property of the plan, not something typed per session.
This adds `label` to `Template`, a change to the log format.

Targets become intervals (`3-5 reps`, `≥5`), with loads absolute, as a
percentage of a reference max, RPE-driven or bodyweight plus.

### History and past sessions

Sessions by week, newest first, with a marker on any still holding pending
sets. **Log a past session** picks a date and saves it with
`time_precision: 'date_only'`, ended on saving, so it never counts as a session
in progress.

### Lifter data

- **Bodyweight:** a weigh-in per date. A session's bodyweight, when entered for
  a bodyweight-plus set, is offered as that day's weigh-in, one tap.
- **Reference maxes:** set by hand, dated. The best recent e1RM is shown beside
  each as a suggestion, never written.
- **Records:** per exercise, the best weight at 1 to 10 reps, from sessions and
  entered by hand together.

### Library

Search and filter by base lift, tier and muscle. Creating or changing an
exercise saves it at once and opens its prefilled submission on github.com.
Safari opens a window only within the tap, so the tap opens it empty and the
save then points it at the submission.

### Analysis

One date range, from presets, a custom range or a template's label. Per lift:
best e1RM over time, sets by tier, tonnage. Per muscle: volume, with the
counting preset switchable in place. Stress per week and per muscle. Sets keep
the unit they were logged in; analysis shows kilograms.

### Conflicts

When a sync finds or brings conflicts, a full-screen notice lists them, again at
every launch, with a banner on every screen until none is left. During a
session only the banner shows. The resolution screen sets the log's version
beside the saved one, differences highlighted, set by set for a session and
field by field for a row, with each version's device by name: every device can
be named in settings, a name kept on that device.

### Settings and sync

Sync status and exposure in full, **Sync now**, the files left alone because
they do not parse, the repo and the masked token, replacing the token, moving
to another repo (confirmed: the device forgets what it shared with the old
one), the device's name, plate increments, persistent storage, and export of
`sets.csv` and `sessions.csv`.

### Decided against

**Recording when each set was done.** Nothing needs it: the rest timer runs on
screen only, and rest analysis was never asked for.
