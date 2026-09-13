# Not losing your training

The short version: **the phone is a working copy, the repo is the archive.**

## What can actually destroy local data

| Event                           | Local data                                         | Mitigation                    |
| ------------------------------- | -------------------------------------------------- | ----------------------------- |
| Delete the home-screen icon     | **Gone**                                           | Sync. Nothing else helps      |
| Reset the phone, lose the phone | **Gone**                                           | Sync                          |
| Disk pressure eviction          | Gone                                               | `navigator.storage.persist()` |
| Clear Safari website data       | Survives (installed apps have their own container) | —                             |
| App update / republish          | Survives                                           | —                             |
| Airplane mode, dead signal      | Survives                                           | —                             |

The first row is the one worth being clear about. **Deleting an installed web app
deletes its storage — exactly as deleting a native app deletes its local data.**
This is not a weakness of the web: a native training log with local-only storage
loses just as much. The difference is that native apps can silently opt into
iCloud backup and a web app cannot, so the backup has to be explicit.

Making it explicit is the better outcome anyway. iCloud backup is opaque and you
find out whether it worked at the worst possible moment. A git repo is a thing
you can clone, inspect, and read in a notebook, and every session is a commit
with a date on it.

## The three mechanisms

**Sync, which does nearly all the work.** Every session is pushed as a commit to
a private repo. Pushes fire on ten minutes of quiescence, on switching away from
the app, on ending a session, on launch, and on demand. In practice a session is
in the remote within seconds of you leaving the gym. The remote is the archive;
the phone holds a copy of it.

**Persistent storage.** `requestPersistence()` calls `navigator.storage.persist()`
at launch, which asks the browser not to evict this origin under disk pressure.
Safari generally grants it to installed apps and declines it for pages in a tab —
one more reason to install rather than bookmark. It does nothing about deliberate
deletion, and is not a substitute for sync.

**Manual export.** One tap, no network, hands you the file. For the moments when
you want a copy in your hand right now.

## Exposure

`exposure()` in `storage/durability.ts` answers one question: _if this phone
vanished right now, what would be lost?_ It returns one of four levels, and the
UI shows it permanently rather than only when something is wrong, so the number
is never a surprise.

- **safe** — everything here is in the remote
- **pending** — unpushed work, minutes old, normal mid-session
- **at_risk** — unpushed work older than an hour, worth acting on
- **unprotected** — sync was never configured, so the phone is the only copy

`unprotected` is deliberately impossible to escape by having a tidy local state:
zero unsynced documents on a device with nowhere to sync to means everything is
unsynced, not that everything is safe. First run therefore either sets up sync or
makes you explicitly choose to go without.

## Restoring

On a new device: install, point it at the same repo, pull. Every session, your
records, your reference maxes and your bodyweight history come back, because they
were never only on the old phone.

## What the scheduler actually does

`storage/scheduler.ts` holds both cadences, because they are two halves of one
decision and splitting them across files would let them drift apart.

**Local**: one second after the last change. At most a second of input is ever
at risk, and a change is on disk long before it is anywhere else.

**Remote**, on any of:

| Trigger                     | Why                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| Ten minutes of quiet        | You stopped. Every change pushes this deadline back, so mid-session typing never fires a push |
| Switching away from the app | The strongest signal that you are done. Leaving the gym is exactly this                       |
| Ending a session            | The session is complete; there is nothing left to batch                                       |
| Launch                      | Flushes whatever the last run could not send                                                  |
| Regaining signal            | The gym basement ends                                                                         |
| Asking                      | For when you want certainty now                                                               |

Every push saves locally first, so an interrupted push never loses the change it
was carrying. A failed push keeps its pending flag _and its original timestamp_ —
exposure grows with the age of the change rather than resetting on each failed
attempt, which is the difference between a warning that means something and one
that never fires. Retries back off from thirty seconds, doubling to a cap of
fifteen minutes.

In practice: a session is in the remote seconds after you leave the gym, and at
worst ten minutes after your last edit.
