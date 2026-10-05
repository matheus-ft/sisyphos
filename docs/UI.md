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
(`DECISIONS.md`).

## v0: logging a session

Built, in `src/App.svelte` and `src/ui/`: logging a session, planned ahead or
started at once, with a rest timer counting up, skipped sets, notes per exercise
and each exercise's history; past sessions, repeated with "do this again";
templates with exact targets; creating an exercise; setup, the status line, and
a sync screen that resolves conflicts.

## v0.5: the bridge

### Shell

Four tabs: **Train** (the v0 screen), **History**, **Analysis**, **More** (lifter
data, library, templates, conflicts, settings). Routes live in the URL hash,
since GitHub Pages cannot serve a deep link with a real path.

A new app version takes over only outside a session, or at the next launch: a
reload mid-session would lose the open set and the rest timer.

### Entering a set

Both ways, as the lifter prefers at the moment: typing into the row, as in v0;
or a button at the row's end, which opens a panel from the bottom with large −
and + buttons for load and reps and one-tap RPE buttons from 6 to 10 in halves.

The − and + buttons step by the plate increment, set per unit in settings (for
example 2.5 kg, or 1.25 kg where the gym has the plates), which also rounds
percentage prescriptions.

The panel is pre-filled from the set itself, then the prescription (a
percentage resolved against the reference max in force on the session's date),
then the previous set. RPE is never pre-filled.

### Rest timer

v0's counts up from the last completed set. v0.5 adds a target rest per
exercise, counted down instead and turning red at zero. An iPhone web app cannot
ring or vibrate, so it never claims to.

### Templates

v0 builds them with exact targets. v0.5 adds a program label (program name,
block, week, day, weekday), which a session started from it copies:
"Block 2, week 3" is a property of the plan, not something typed per session.
This adds `label` to `Template`, a change to the log format.

Targets become intervals (`3-5 reps`, `≥5`), with loads absolute, as a
percentage of a reference max, RPE-driven or bodyweight plus.

### History and past sessions

Every session by week, newest first, filtered by exercise, with a marker on any
still holding pending sets. v0 lists the 30 most recent.

### Lifter data

- **Bodyweight:** a weigh-in per date. A session's bodyweight, when entered for
  a bodyweight-plus set, is offered as that day's weigh-in, one tap.
- **Reference maxes:** set by hand, dated. The best recent e1RM is shown beside
  each as a suggestion, never written.
- **Records:** per exercise, the best weight at 1 to 10 reps, from sessions and
  entered by hand together.

### Library

v0 creates exercises. v0.5 adds filtering the search by base lift, tier and
muscle, and changing an existing exercise, which opens a proposal to change the
shipped row.

### Analysis

One date range, from presets, a custom range or a template's label. Per lift:
best e1RM over time, sets by tier, tonnage. Per muscle: volume, with the
counting preset switchable in place. Stress per week and per muscle. Sets keep
the unit they were logged in; analysis shows kilograms.

### Conflicts

v0 lists them on the sync screen, each version as short lines, with a button to
keep either. v0.5 announces them: a full-screen notice when a sync finds or
brings one, again at every launch, and a banner on every screen until none is
left; during a session only the banner. Differences are highlighted, and each
version's device is shown by name: every device can be named in settings, a
name kept on that device.

### Settings and sync

v0's sync screen has the status, **Sync now**, the repo and masked token, a way
to change either, and the files left alone because they do not parse. v0.5
adds the device's name, plate increments, persistent storage, and export of
`sets.csv` and `sessions.csv`.

### Decided against

**Recording when each set was done.** Nothing needs it: the rest timer runs on
screen only, and rest analysis was never asked for.
