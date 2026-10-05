# User interface

What the lifter sees, in three stages:

- **v0** replaced a notes app: type in the session being trained, saved at once,
  synced when it ends.
- **v0.5** is the bridge to v1: every screen the lifter asked for, in the look
  they chose. This document states what they want from each screen. Most of it
  is built; where it is not yet, the section says so.
- **v1** is shaped by a designer. This document is their brief: v0.5 shows one
  answer to it, not the only one.

The intent is written here once. How each rule is computed lives in the code
the sections point at.

## The lifter

- A powerlifter rebuilding after time off, with a competition far away. They
  train from a loose plan now; RPE targets and percentages of a reference max
  come back nearer a competition.
- They log each set right after racking it, with an RPE on every working set.
- Between sets the phone lies on the bench or the floor, read from one or two
  metres away.
- Outside the gym they plan the next session ahead (at lunch, filling in
  tonight's weights), check last time's numbers on the way to the gym, review
  progress about weekly, and show the app to friends and coaches.
- They build the next session by copying the last one and adjusting it, from a
  template, or from the weights the app suggests.
- Someone shown the app should notice three things equally: it looks like no
  other gym app, logging is fast, and the progress views are striking.

## Principles

**Built for the gym.** One hand, a phone in portrait, a glance from the bench.
Tap targets are at least 44 points, 56 mid-session; the numbers being entered,
and the rest timer, are the largest things on screen.

**Nothing waits for the network.** A change is written to the device when it is
complete (a field left, a set saved), and shown as saved only once that write
resolves. Only setup waits on GitHub.

**Derived numbers are computed where they are shown,** never saved
(`DECISIONS.md`): e1RM, records, volume, tonnage, suggestions.

## Identity

**Red-figure, with the polish of a museum.** Attic vase painting: in light mode
the unglazed clay with black-glaze ink and a fired terracotta accent; in dark
mode the black glaze, with type and figures reserved in clay. The phone's
setting decides. Titles, exercise names, labels and buttons are inscription
capitals (Cinzel); text and every number are a book serif (EB Garamond) with
tabular figures. Greek-key bands are the rules. The fonts ship with the app, so
it works offline.

The design system is code: the tokens in `src/app.css` and the shared
components in `src/ui/kit/`.

**The myth, dry and rare.** A session's progress is a boulder climbing a hill,
one notch per set; at the finish it reaches the top: "The boulder is at the
top." and, small, "One must imagine Sisyphos happy." (Camus). With no session,
Train says "The boulder is at the bottom again." Nothing else jokes.

**Tabs:** a Greek word large, the English small beneath it: Askēsis (Train),
Historia (History), Athloi (Progress), Agora (More). Everything else is plain
English.

## In the gym

**Saving a set.** Both ways, as the lifter prefers at the moment: typing into
the set's row, as in v0; or a panel from the bottom with − and + for load (by
the plate increment) and reps, and one-tap RPE buttons from 6 to 10 in halves.
Tapping an RPE saves the set. The panel starts from the set itself, else its
target (a percentage resolved against the reference max in force on the
session's date, rounded to the plates), else the suggested weight, else the
previous set. RPE is never pre-filled. A warm-up takes Done instead of an RPE.

**The rest takes over.** Saving a working set turns the screen into the rest: a
countdown to the exercise's target rest, readable from the bench, with the next
set's numbers, −15 s and +15 s (which change that exercise's target rest in
the session, and so sync), skip, and the way back to the list. At zero it turns
terracotta, pulses slowly and counts up. An optional bell rings at zero while
the app is open; an iPhone web app cannot ring in the background, so the app
never claims to. The rest is timed from the wall clock, so a locked phone shows
the right time on return. When the rest started is not saved to the log (see
Decided against).

**Target rest** is set per exercise in a template and carried into each
session; unset, it follows the exercise's tier (`REST_BY_TIER` in
`src/ui/rest.ts`).

**Warm-ups** are optional and quiet: smaller and muted, never counted for RPE,
volume or records. The app suggests a ladder toward the first working weight,
which the lifter adds whole, adds one rung of, or hides (`src/ui/warmup.ts`).

**Suggested weights** come from last time's RPE on that exercise against the
target RPE: a bigger jump when it was well under, a small one when on target,
the same weight when over. The suggestion says why ("+2.5: last @7.5 for a
target of 8"). Never for pins or timed sets (`src/ui/suggest.ts`).

**Screen awake** is a switch: the screen stays on for the session where the
phone allows it (`src/ui/device.ts`).

**Records in the moment.** A set that beats the best weight at its rep count
gets the laurel.

**The finish.** The boulder arrives. Duration, sets, tonnage and records set
today, then each exercise's top set. Save as template, share, done. Share draws
the session as a red-figure image for the phone's share sheet.

## Outside the gym

**Askēsis (Train).** A session in progress comes first. Otherwise today's plan
with the screen's one primary button, plans for later in the week, start an
empty session, plan one ahead, log a past session, and the templates.

**Planning ahead.** A planned session is filled in without starting the clock;
Start sets the time. "Do this again" copies a past session as a plan; a
template starts or plans one.

**Templates** carry a program label (name, block, week, day, weekday), which a
session started from them copies, since "block 2, week 3" belongs to the plan,
not to each session. Targets take rep ranges (3–5, 5+), loads absolute, as a
percentage of a reference max, RPE-driven or bodyweight plus, a target RPE or
range, and a target rest per exercise.

**Historia (History).** Every session by week, newest first, marking any still
holding pending sets; filtered by exercise, each row shows that exercise's best
set and e1RM. A calendar shows the month: a disc per session, a ring for a plan,
a dot for a record day, today ringed.

**Athloi (Progress).**

- **Body:** a kouros, front and back, painted red-figure, its muscles shaded by
  working sets this week or over the last four, auxiliary muscles counting half
  (the active counting preset). Each muscle opens the sets behind it. The
  figure's regions are in `src/ui/statue.ts`.
- **Strength:** each lift's best e1RM over time, drawn as the hill the boulder
  climbs, record days gilded. e1RM comes from the RPE chart when a set has an
  RPE, and from Epley otherwise (`src/metrics/e1rm.ts`).
- **Labours:** per exercise, the best weight at 1 to 10 reps, from sessions and
  entered by hand together (`src/metrics/records.ts`); a record from the last
  30 days carries the laurel.

**Agora (More).** The lifter's data: weigh-ins; reference maxes, set by hand and
dated, with the best recent e1RM beside each as a suggestion that is never
written by itself; records entered by hand. The templates. The library: search
filtered by base lift, tier and muscle; create an exercise; change one, which
saves it and opens its proposal on github.com. Settings: the device's name,
screen awake, the bell, plate increments per unit (`PLATE_CHOICES` in
`src/ui/prefs.ts`), persistent storage, sync, and export of `sets.csv` and
`sessions.csv`. Preferences stay on the device and never sync.

**Conflicts.** When a sync finds or brings one, a full-screen notice says so,
again at every launch, with a banner on every screen until none is left; during
a session only the banner. Resolving sets the two versions side by side with
the differences marked. This device is named; the other version is "another
device", since device names never leave their device.

**Updates** take over only outside a session, or at the next launch: a reload
mid-session would lose the open set and the rest.

## Where the screens live

- `src/App.svelte` is the shell: tab bar, banner, notices, the screen for the
  route.
- `src/ui/route.ts`: every screen's address. Routes live in the URL hash, since
  GitHub Pages cannot serve a deep link with a real path.
- `src/ui/app.svelte.ts`: the app's state and every action a screen can take.
- `src/ui/screens/`: one file per tab and page; `src/ui/session/`: the session,
  the entry panel, the rest and the finish; `src/ui/kit/`: shared components.
- Every rule and number is a tested pure module beside them (`src/ui/*.ts`,
  `src/metrics/`).

## Decided against

**Recording when each set was done.** Nothing needs it: the rest is timed on
screen only, and rest analysis was never asked for.

## For the designer

Open questions v0.5 answered provisionally:

- The statue is a first drawing; an illustrator's pass would refine its
  proportions and face.
- The share card follows the phone's mode (clay by day, glaze by night) rather
  than offering a choice.
- The bell and screen awake depend on the iPhone: screen awake needs iOS 18.4 or
  later in a home-screen app, and the bell sounds only while the app is open.
