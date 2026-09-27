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

**Sync, which does nearly all the work.** Everything you record is synced to a
private repo you own, one commit per sync. Ending a session syncs it, so in
practice a session is in the remote the moment you finish it. The remote is the
archive; the phone holds a copy of it.

**Persistent storage.** `requestPersistence()` calls `navigator.storage.persist()`
at launch, which asks the browser not to evict this origin under disk pressure.
Safari generally grants it to installed apps and declines it for pages in a tab —
one more reason to install rather than bookmark. It does nothing about deliberate
deletion, and is not a substitute for sync.

**Manual export.** One tap, no network, hands you the file. For the moments when
you want a copy in your hand right now.

## Exposure

Exposure answers one question: _if this phone vanished right now, what would be
lost?_ It is one of four levels, and the UI shows it permanently rather than only
when something is wrong, so it is never a surprise.

- **safe** — everything here is in the remote
- **pending** — unsynced changes, minutes old, or a session in progress
- **at_risk** — unsynced changes older than an hour, worth acting on
- **unprotected** — sync was never set up, so the phone is the only copy

`unprotected` is deliberately impossible to escape by having a tidy local state:
zero unsynced changes on a device with nowhere to sync to means everything is
unsynced, not that everything is safe. First run therefore either sets up sync or
makes you explicitly choose to go without.

Age is measured from the first change that has not reached the remote, not the
latest, so repeated edits or failed syncs never make old work look new.

A session in progress keeps exposure at **pending** at most. Syncing pauses on
purpose while you train (below), so the session is safe on the phone and only on
the phone until you end it.

## When syncing happens

Every change is written to the phone the moment it is complete, with no network.
Your log reaches the repo when:

| Moment                               | Why                                                        |
| ------------------------------------ | ---------------------------------------------------------- |
| You end a session                    | The session is complete; this is the one that matters most |
| You tap sync                         | For when you want certainty now                            |
| You leave the app, outside a session | You are done for now                                       |
| You open the app, outside a session  | Finishes whatever the last sync could not                  |

Opening the app during a session only fetches what your other devices wrote.

A session counts as in progress until it is ended, or for three hours after its
last change if you forget to end it. While one is in progress, leaving the app
does not sync: the phone cannot tell closing the app from locking it between
sets, and a commit per set would be noise. The accepted cost: lose the phone
mid-session and that session is lost.

A failed sync retries from thirty seconds, doubling to a cap of fifteen minutes,
and at once when the connection returns. An expired or revoked token stops
syncing and asks for a new one rather than retrying forever. `STORAGE.md`
section 7 has the exact rules.

## Restoring

On a new device: install, and set it up with the same repo and a token for it.
The first sync brings back every session, your records, your reference maxes and
your bodyweight history, because they were never only on the old phone.

## Conflicts

If two devices change the same thing before either syncs, the version already in
the repo counts and the other is saved for you. The app tells you at once, full
screen, and keeps a banner up until you pick one; you lose nothing, and sync
never stops to ask. `STORAGE.md` section 5 has the rules.
