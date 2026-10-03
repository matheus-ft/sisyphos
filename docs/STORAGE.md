# Storage and sync

The specification the storage layer is built from. `DESIGN.md` says why each
decision was made and what was rejected; `DATA.md` says what each file in the
log repo holds; `DURABILITY.md` says what the lifter sees. This file says exactly
how it works, precisely enough to implement and test against.

"Must" is a requirement. Anything this file does not specify is not decided yet,
and is listed under [Not decided yet](#not-decided-yet) rather than guessed at.

## The model in one paragraph

The device holds a working copy; a private GitHub repo, the **log repo**, is the
archive. Every change is written to the device the moment it is complete, with
no network. A sync compares three versions of every file in the log repo: the
**base** (what this device and the remote last agreed on), the **local** version
and the **remote** version. What changed on one side is taken from that side.
When both sides changed the same record differently, that is a **conflict**: the
log repo's version stands, this device's version is saved beside the data as a
conflict record, and the app puts it in front of the lifter until they pick one.
Everything a sync decides is written as one commit, and the branch moves by
fast-forward only, so a device that raced ahead is detected and merged, never
overwritten.

## 1. The log repo

### 1.1 Layout

```
sisyphos.json                      format marker, see 1.3
sessions/<YYYY>/<id>.json          one file per session
templates/<id>.json                one file per template
lifter/bodyweight.csv              one table per kind of lifter data
lifter/one-rm-history.csv
lifter/manual-records.csv
library/additions.csv              exercises the lifter created or changed, see 9
conflicts/<id>.json                one file per unresolved conflict, see 5
```

- A path must depend only on things that never change. `<YYYY>` is the year in
  the session's id (1.2), so moving a session to another date edits one file and
  moves nothing.
- Columns and keys of each table are listed in `DATA.md`. A table has exactly
  one row per key.
- Any other file in the repo (a README, the lifter's own notes) is not the app's.
  It must never be modified or deleted, and every commit must carry it forward
  unchanged.

### 1.2 Ids

Sessions, templates and conflict records are named by their ids, so those ids
are meant to be read.

| Record          | Id                                                                   | Example            |
| --------------- | -------------------------------------------------------------------- | ------------------ |
| Session         | The session's date when it was created, then four random characters  | `2026-09-14-k3f9`  |
| Template        | Its name when it was created, as a slug, then four random characters | `squat-day-a-k3f9` |
| Conflict record | The date it was found, then four random characters                   | `2026-09-27-7xq2`  |

- Dates are `YYYY-MM-DD`, so file listings sort chronologically.
- The random characters come from `0123456789abcdefghjkmnpqrstvwxyz`
  (lowercase Crockford base 32). They keep ids unique when two devices create
  records on the same day without talking to each other: about a million
  possibilities per date or name. A device never generates an id it already
  holds. If two devices ever did pick the same one, sync would see one file with
  two contents and treat it as a conflict (4.3), so even then nothing is lost.
- A slug is the name lowercased, with every run of characters other than ASCII
  letters and digits replaced by one hyphen, trimmed of hyphens, cut to 40
  characters, and trimmed of a trailing hyphen again, since the cut can end on
  one. A name that leaves nothing (empty, or only punctuation or letters outside
  ASCII) has the slug `template`. Either way the id is hyphen-separated runs of
  letters and digits: no doubled hyphen before the random characters, and none
  leading.
- An id never changes. A session moved to another date, or a template renamed,
  keeps its id: the file name is a label, and the record's fields are the truth.
- Ids that never appear in a path (exercise instances, sets) stay random UUIDs.

### 1.3 Format marker

`sisyphos.json` holds `{ "format": 1 }`. The app knows the highest format it can
read.

- **Same format:** sync normally.
- **Older:** the app migrates every file in one commit, through the normal sync
  (section 4), before anything else.
- **Newer:** the app stops syncing and tells the lifter to update. Logging on
  the device continues; nothing is lost, it just waits.

A log repo without `sisyphos.json` is handled by setup (section 8), never by
sync.

### 1.4 Serialisation

Every file must serialise **deterministically**: the same data always produces
the same bytes. Sync compares content by hash (section 3), so a serialiser that
emits the same data two ways makes an unchanged file look changed.

**All files:** UTF-8, no byte-order mark, `\n` line endings, ending in exactly
one `\n`.

**JSON files:** two-space indentation. Keys are emitted in a fixed order defined
by the serialiser for each type, never in whatever order an object happened to be
built. Absent values are `null`, never omitted.

**CSV files:**

- A header row, then one row per record, comma-separated.
- A cell containing a comma, a double quote, `\r` or `\n`, starting with `#`, or
  starting or ending with whitespace, is wrapped in double quotes, with inner
  quotes doubled (RFC 4180). No other cell is quoted. The reader trims unquoted
  cells (the shipped library relies on it), so whitespace a value really has
  must be quoted to survive.
- `null` is an empty cell. Booleans are `true` or empty. Numbers use JavaScript's
  shortest round-trip form (`String(n)`). Dates are `YYYY-MM-DD`; instants are
  ISO-8601 UTC with milliseconds.
- Rows are sorted by the table's key (listed in `DATA.md`), compared field by
  field in the order listed: numbers numerically, everything else by code point.

A table whose header row is not exactly the one its format defines is
unreadable (section 6). The CSV reader must accept everything the writer
produces, including quoted cells with embedded newlines. The current
`src/csv.ts` splits on newlines and does not handle quoting, so it must be
replaced. The shipped library files are read with the same reader and are
unaffected: they contain no quoted cells.

**Files the app did not write.** A remote file that parses but does not
serialise back to the same bytes (hand-formatted JSON, say) is taken, then
rewritten in the app's form by the next sync. That costs one commit and then
settles. A remote file that does not parse is **unreadable** (section 6).

## 2. On the device

### 2.1 What is stored

IndexedDB holds, per install:

| Store       | Contents                                                                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content`   | Every log-repo file the device holds, keyed by path, as the exact text it would push                                                                                               |
| `sync`      | One entry per log-repo path: `base_sha`, `local_sha`, `unsynced_since`, and for tables `base_body`                                                                                 |
| `sync_meta` | `last_synced_head`: the newest commit the bases were moved against, which the history check anchors at. `last_synced_tree`: its tree, recorded only when every base agrees with it |
| `inflight`  | At most one entry: the commit this device is trying to land (4.5)                                                                                                                  |
| `settings`  | Repo owner and name, branch, token, device id. Never synced                                                                                                                        |

The store keeps files, not records, and knows nothing about what they mean. That
is what lets the sync treat every path the same way. Sessions, rows and the rest
are parsed from the content by the log layer (`storage/log.ts`), which caches
each parsed file by its sha, so listing sessions reparses only what changed.

The device id is random, generated once per install and never copied between
devices. A restored device gets a new one.

Every write, from any tab, runs one at a time: the write queue (2.2) holds a Web
Lock across tabs where the browser has one, so another tab cannot write between
a sync's read and its write.

The IndexedDB schema is versioned. Opening an older version migrates it in the
upgrade transaction, and a migration never drops data.

### 2.2 Writing

Local writes are as fast as the device allows: every change goes to IndexedDB
the moment it is complete, and nothing waits for the network.

Every change goes through **one write queue**, first in, first out. A queued
operation resolves when its IndexedDB transaction has committed, and not before.
The UI must write when a change is complete (a set confirmed, a field left), not
per keystroke, and must not report something as saved before its write resolves.

There is no debounce and no in-memory holding area. A session is about 4KB and a
write per completed change is cheap. Holding changes back in memory is how the
first version of this layer lost them.

One queued operation:

1. Reads what it needs (for a table row: the table's current rows).
2. Computes the new record, the file's new serialisation and its hash (section
   3), **before** any transaction opens. Hashing is synchronous (a plain SHA-1,
   `storage/hash.ts`), because the browser's own is asynchronous only.
3. Opens one transaction and writes the record and its path's `sync` entry
   together. No `await` may separate two requests of one transaction: IndexedDB
   commits a transaction as soon as the microtask queue drains with nothing
   pending, and an `await` between requests can split one write into two.

Because the queue runs one operation at a time, the read in step 1 cannot go
stale before step 3.

Sessions and templates carry `updated_at`, set by the write that changes them. A
write whose only change would be a new `updated_at` is skipped. It is shown to
the lifter when resolving a conflict and never used to decide anything.

### 2.3 One row per key

The write API for a table replaces the row with the given key, so a table always
has exactly one row per key. Changing a key field, such as re-dating a weigh-in,
is a delete of the old key and an add of the new one.

## 3. Knowing what needs syncing

Nothing records "this is dirty". Whether a path needs syncing is **derived**:

- `local_sha` is the git blob hash of the path's current local serialisation,
  or null when the path has no local content. It is written in the same
  transaction as the content it describes, so the two cannot disagree.
- `base_sha` is the git blob hash of the content the remote held at the last
  point this device agreed with it, or null for a path it never agreed on.
- A path **needs syncing** when `local_sha` differs from `base_sha`.

An edit made while a sync is running leaves `local_sha` different from the base
the sync records, so the path simply still needs syncing afterwards. There is no
flag for a sync to clear at the wrong moment.

`unsynced_since` is set by the write that makes a path diverge from its base, is
left alone by later writes while it stays diverged, and is cleared when it stops
diverging. Exposure (section 7.3) uses the oldest one.

**Git blob hash:** SHA-1 over the bytes `blob <byte length>\0<content>`, with
`<byte length>` in decimal, which is what `git hash-object` computes. It lets
the device compare its files with the remote's tree without downloading
anything. Every blob fetched from the remote must hash to the sha it was fetched
by; a mismatch is a bug and stops syncing.

## 4. Sync

### 4.1 The remote

A **remote adapter** is the only code that talks to GitHub. The sync never sees
HTTP. It needs:

| Operation                  | GitHub API                                                                      |
| -------------------------- | ------------------------------------------------------------------------------- |
| Branch head                | `GET /repos/{o}/{r}/git/ref/heads/{branch}`                                     |
| Every path and blob sha    | `GET /repos/{o}/{r}/git/trees/{commit}?recursive=1`                             |
| One file's content         | `GET /repos/{o}/{r}/git/blobs/{sha}`                                            |
| Write a tree               | `POST /repos/{o}/{r}/git/trees`, with `base_tree` so untouched files carry over |
| Write a commit             | `POST /repos/{o}/{r}/git/commits`, one parent                                   |
| Move the branch            | `PATCH /repos/{o}/{r}/git/refs/heads/{branch}`, `force: false`                  |
| Is commit A in B's history | `GET /repos/{o}/{r}/compare/{A}...{B}`                                          |

Every request must be sent with `cache: 'no-store'`. GitHub marks API responses
cacheable for 60 seconds, and a cached branch head makes every commit fail as
though another device had moved the branch.

A tree listing that GitHub reports as `truncated` is an error. Silently syncing
part of the log is worse than not syncing.

An in-memory adapter with the same operations, a real commit graph and the same
fast-forward rule is what the sync is tested against (section 10).

### 4.2 One sync

A sync runs under the lock described in 7.2. In outline:

1. **Recover** an unfinished commit, if `inflight` holds one (4.5).
2. **Read the head.** If it equals `last_synced_head` and no path needs syncing,
   stop. The common case therefore costs one request.
   - **History check.** If the head moved, ask whether its history still
     contains `last_synced_head`. If it does not, the history was rewritten, or
     this is not the repo the device last synced with. The bases then describe
     files this remote never held, so the device forgets them all (as setup
     does, section 8), and the sync goes on as a first sync, which can take,
     push or conflict but never delete.
   - **Snapshot.** Read the sync entries, and the content of each table the
     device has changed, in one operation on the write queue, so that no write
     can land between the two reads. Step 5's "agreed" bases depend on the two
     describing the same moment.
3. **Read the remote tree**, recursively. When the head has not moved and
   `last_synced_tree` is recorded, no request is needed: the remote's files are
   exactly the bases, and the tree is `last_synced_tree`.
4. **Fetch** the content the decision needs (4.3): the remote version of every
   path whose remote sha differs from both its base and its local sha.
   Concurrency is capped at six requests.
5. **Decide**, as one operation on the write queue (2.2), every path whose base,
   local and remote versions are not all equal (4.3). Then, in the same
   operation:
   - write each result to the device where it differs from the local version,
     and write any conflict records the decision produced;
   - move each base to the remote version wherever the result equals it. The
     remote holds that version at this head whatever happens next, so this
     holds even if the push below fails. For a table this is done key by key:
     `base_body` takes the remote rows of every key whose result equals the
     remote's, and keeps its old rows for the rest;
   - collect every path whose result differs from the remote version, plus the
     new conflict records: that is what must be pushed.
6. In the same operation, set `last_synced_head` to the head: every base this
   moved describes it, and the history check must anchor at the newest such
   commit, or a rewrite could slip past it. Set `last_synced_tree` to the
   head's tree only if nothing must be pushed and every base agrees with the
   remote, and to null otherwise. If nothing must be pushed, stop.
7. **Write** the tree (on the head's tree) and the commit (parent: the head).
8. **Record** the commit and its tree in `inflight` (on the write queue), with
   the sha of every pushed path, and for tables the pushed body.
9. **Move the branch** to the commit, fast-forward only.
10. **Settle**, on the write queue: set each pushed path's base to what was
    pushed (for tables, `base_body` too), set `last_synced_head` to the new
    commit and `last_synced_tree` to its tree (null unless every base agrees,
    as in step 6), and clear `inflight`.

If step 9 is refused because the branch moved, clear `inflight` and go back to
step 2. The bases of pushed paths are still the old ones, so the next round
merges correctly against the new remote. After five rounds the sync stops with a
retryable error (section 6).

A refusal is only "the branch moved" if a fresh read of the head shows it
differs from the commit's parent. GitHub answers 422 both for a
non-fast-forward and for validation failures, and treating every 422 as the
former turns a real error into an endless retry.

### 4.3 Deciding one path

For files that hold one record (sessions, templates, conflict records), the
unit is the file. For tables, the unit is the row with a given key. Let **B**,
**L** and **R** be a unit's base, local and remote versions, each possibly
absent (no file, or no row with that key). Units are equal when their
serialisations are equal. The rows are checked in order, and the first that
matches applies.

| Case      | Result                                                            |
| --------- | ----------------------------------------------------------------- |
| L = R     | Nothing to change                                                 |
| L = B     | Take R                                                            |
| R = B     | Push L                                                            |
| Otherwise | **Conflict.** Take R, and save L as a conflict record (section 5) |

Absence covers deletion. Taking an absent R deletes locally; pushing an absent L
deletes remotely. In a conflict where R is absent (deleted elsewhere, edited
here), the deletion stands and the edit is saved; where L is absent (deleted
here, edited elsewhere), the edit stands and the deletion is saved. The rule is
the same every time: **the remote version stands, and this device's version is
saved.**

Because a deletion is detected by comparison with the base, nothing is ever kept
to mark a record as deleted. A device that never agreed on a path (null base)
takes what the remote has, pushes what it has, and records a conflict where both
have different content. That is exactly right for a first sync onto an existing
log.

**A known limit: a deletion can be undone by a concurrent write.** Comparing
three versions sees where a unit ended up, not the way it got there. When a
device creates a record and deletes it again between syncs, or restores one and
deletes it, its content ends where its base was. It then has no change to
offer. The same holds on the remote side. If another device wrote that same
record without having seen the deletion, its write simply stands: the deletion
is not honoured, and no conflict is raised.

Nothing is lost in this case: the record comes back, and deleting it again
works. Catching it would take state this design deliberately does not keep:

- a per-record marker that the device changed it since the last sync;
- deletion markers (tombstones) kept in the files, which would never shrink
  without a purge rule.

Neither is worth it for a race this narrow in a single lifter's log. The
simulation checks this limit exactly, and nothing wider (section 10).

For a table, the file's result is the combination of every key's result, and it
is pushed if it differs from R. A table's result is computed from the device's
current rows at step 5, so an edit made while step 4 was fetching is included,
not overwritten.

The decision is a pure function of B, L and R. It must be implemented, and
tested exhaustively, separately from everything that reads and writes them.

### 4.4 Pulling

A **pull** is a sync that pushes nothing. It decides every path as above, but
applies only units where L = B (take R) or L = R. Every unit with a local
change is left exactly as it is, base included, for the next full sync. A pull
therefore never finds a conflict and never reaches step 7. Launching the app
while a session is in progress pulls (7.1).

### 4.5 Recovering an unfinished commit

A device can be killed after step 9 (the branch moved) and before step 10 (the
device recorded it). Without a record, its next sync would compare its content
with a base from before its own commit, and could report its own work as a
conflict.

Step 8 prevents that. On the next sync, before anything else, if `inflight`
holds a commit:

1. Ask whether the current head's history contains it (the compare operation:
   `identical` or `ahead` means it does).
2. If it does, the commit landed: apply step 10 from the recorded shas, with
   `last_synced_head` set to that commit and `last_synced_tree` left null,
   since whether every base agreed is not in the record.
3. Either way, clear `inflight`. If the commit never landed, the device's
   content is still local and its bases are unchanged, so the sync that follows
   pushes it again.

## 5. Conflicts

The data only ever holds one version of anything: no markers, no copies, no
second row for a key. Everything that reads the data (analysis, records,
prescriptions, bodyweight hints, exports, a notebook) sees exactly one version
and needs no rule about conflicts.

The version that did not stand is kept in `conflicts/`, in the log repo. It
therefore syncs, shows on every device, survives losing the phone, and can be
resolved from any device. Sync never stops for a conflict and never asks: it
saves the other version and carries on. Choosing between them is the lifter's
job, by hand, and the app makes sure it happens promptly.

### 5.1 The conflict record

`conflicts/<id>.json`, one per conflict:

| Field       | Meaning                                                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| `id`        | See 1.2                                                                                               |
| `path`      | The file in conflict                                                                                  |
| `key`       | For a table, the row's key as `{ column: value }`; null for sessions and templates                    |
| `found_at`  | When the sync found it                                                                                |
| `device_id` | The device whose version this is                                                                      |
| `version`   | That device's version: the whole record, or the row as `{ column: value }`; null if it had deleted it |

The version that stands is not copied here. It is whatever the data holds now,
which may be nothing if the deletion stood.

A conflict record is written once and only ever deleted. Nothing edits one, so
conflict records never conflict with each other.

### 5.2 Telling the lifter

A conflict is easiest to settle while both versions are fresh in mind, so the
app is loud about it, from the first moment:

1. When a sync finds a conflict, or pulls one another device found, the app
   interrupts whatever is on screen with a full-screen notice listing every
   unresolved conflict. **Resolve now** is the default action.
2. While any conflict is unresolved, every screen carries a banner that cannot
   be dismissed, one tap from resolving.
3. Every launch shows the full-screen notice again while any conflict is
   unresolved.

The resolution screen shows the two versions side by side (the one in the log
and the saved one) with the device and time of each, differences highlighted.
Resolving is one tap.

Library conflicts (9.1) are announced and listed the same way, alongside these.

### 5.3 Resolving

| Choice                 | Effect                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| Keep the log's version | Delete the conflict record                                                                                 |
| Use the saved version  | Write `version` into the data (or delete the record or row, if it is null), and delete the conflict record |

Both happen in one operation on the write queue, and sync like any other change.
Two devices resolving the same conflict both delete its record, which agrees. If
they wrote different versions into the data, that is a new conflict under the
same rules: rare, and still nothing is lost.

## 6. Errors

Every failure falls in exactly one class, and the class decides what happens.

| Class               | Examples                                                                                                           | Behaviour                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Retryable**       | No network, timeout, 5xx, five rounds lost to other devices                                                        | Retry (7.2)                                                                                                                                                                           |
| **Rate limit**      | 403 or 429 with `x-ratelimit-remaining: 0` or `retry-after`                                                        | Wait until the time GitHub gives, then retry                                                                                                                                          |
| **Token**           | 401; 403 that is not a rate limit                                                                                  | Stop automatic syncing; tapping sync tries again. Status asks for a new token; syncing resumes once one is saved                                                                      |
| **Repo**            | 404 for the repo or branch (gone, renamed, or no longer visible to the token); format marker missing or unreadable | Stop automatic syncing; tapping sync tries again. Status says what is wrong                                                                                                           |
| **Update**          | Format newer than the app understands                                                                              | Stop automatic syncing; tapping sync tries again. Status asks the lifter to update the app                                                                                            |
| **Unreadable file** | A log-repo file that does not parse                                                                                | That path is left alone: not taken, not pushed, not overwritten. Every other path syncs, but the sync does not record the tree, so the next one reads it again. Status names the file |
| **Bug**             | A fetched blob whose hash does not match its sha; a serialiser that fails to round-trip                            | Stop automatic syncing; tapping sync tries again. Report it, and never guess past a broken invariant                                                                                  |

A failed sync never loses anything: the device's content is untouched by a sync
that did not reach step 5, and step 5 only applies decisions it has finished
computing.

## 7. When syncing happens

### 7.1 Triggers

Writing to the device is immediate and needs nothing (2.2). The log repo is
written only at these moments:

| Moment                                          | What happens                                           |
| ----------------------------------------------- | ------------------------------------------------------ |
| A session ends                                  | Full sync                                              |
| The lifter taps sync                            | Full sync                                              |
| The app is left while no session is in progress | Full sync                                              |
| The app launches, no session in progress        | Full sync                                              |
| The app launches, a session in progress         | Pull (4.4)                                             |
| A full sync failed                              | Retried (7.2), unless a session is in progress by then |

A **session in progress** is one with `ended_at` null that was written in the
last three hours.

**Leaving the app** is `visibilitychange` to hidden, or `pagehide`. The browser
cannot tell closing the app from locking the phone or switching to another app:
all three look the same. That is why leaving only syncs outside a session.
Locking the phone between sets pushes nothing.

**Launching** outside a session syncs because, outside a session, unsynced work
only exists if a sync failed or was cut off; launching finishes it. During a
session it only pulls, so the device shows what other devices wrote while the
session itself stays local.

There is no timer. The history gets about one commit per session. The accepted
risk: lose the phone mid-session, and that session is lost.

A sync started as the app is left may be cut off when iOS suspends the app. It
must never be relied on; the next launch finishes the job, and the in-flight
record (4.5) makes that safe.

### 7.2 One sync at a time

- Syncs run under the Web Locks API (`navigator.locks`), lock name
  `sisyphos-sync`, so two open tabs or windows never sync at once.
- A request arriving during a sync schedules exactly one more after it, however
  many arrive. A request for a full sync outranks a pull. The caller of a
  request folded into the next sync waits for that one.
- A failed full sync is retried after 30 seconds, doubling, capped at 15
  minutes, and immediately when the connection returns (`online`). The delay
  resets after a success. Retries stop while a session is in progress; the
  session ending syncs anyway.
- Stopping the scheduler (app teardown) cancels every timer and prevents any
  from being set again.

### 7.3 Status and exposure

The UI always shows two things.

**Sync status:** `syncing`, `idle`, `offline`, `retrying` (with the next
attempt's time), `needs token`, `repo problem`, `needs update`, `not set up`.
It also shows the number of unresolved conflicts, and names any unreadable file.

**Exposure:** what would be lost if this phone vanished now. The four levels
and their meaning are in `DURABILITY.md`. It is computed from how many paths
need syncing, and the oldest `unsynced_since` among them. While a session is in
progress, exposure is at most `pending`, because syncing is paused on purpose.

## 8. Setup

The lifter does two things on github.com, guided by the app:

1. **Create a private repository**, any name (`sisyphos-log` is suggested),
   with "Add a README" ticked so the repo has a first commit.
2. **Create a fine-grained personal access token**: resource owner = themselves;
   repository access = only that repository; permissions = Contents: read and
   write. Metadata: read is added by GitHub automatically. Expiry is their choice.

The app does not create the repo. A token allowed to create repositories has to
be allowed far more than one repo, and a token limited to selected repositories
can only name repositories that already exist.

In the app, the lifter enters `owner/repo` and pastes the token. The app then:

1. Reads the repo. Not found means a wrong name, or a token that cannot see it.
   A **public** repo is refused: this is training data.
2. Stores the repo's default branch.
3. Reads the head and tree.
   - **No commits:** writes `sisyphos.json` with
     `PUT /repos/{o}/{r}/contents/sisyphos.json`. The Git Data API cannot write
     to an empty repository, so this is the one use of the Contents API.
   - **No `sisyphos.json`, and nothing but README, LICENSE or .gitignore files:**
     commits `sisyphos.json`.
   - **No `sisyphos.json`, and other files:** refuses. This is not a log.
   - **`sisyphos.json` present:** checks the format (1.3).
4. Runs the first full sync. On a fresh install this is the restore; on a device
   that logged before setup, it merges what the device has with what the log
   holds (4.3, null bases).

Write access is proven by the first commit; a 403 then is a **Token** error
whose message names the Contents permission. A new token can be pasted at any
time, and nothing else changes. Pointing the device at a **different repo** is
another matter: it clears every base, `last_synced_head`, `last_synced_tree` and
`inflight`, so the first sync with the new repo is a first sync (null bases), and
never compares against the old repo's history. Skipping setup is allowed;
exposure is then `unprotected` until it is done.

A repo is identified by GitHub's repository id, stored at setup, not by its
name. A repo deleted and created again under the same name gets a new id, holds
another history, and so counts as a different repo. Setup runs while no sync
does (it holds the same lock, 7.2), so a sync of the old repo cannot write its
bases back over the cleared ones.

The token is stored in `settings` on the device only. It is sent only as an
`Authorization` header to `api.github.com`, and never logged or synced.

## 9. The exercise library

The **shipped library** is `src/library/exercises.csv` in the app's repository:
built into the app, the same for everyone, and changed only by merging a pull
request there. A lifter's **additions** are rows in `library/additions.csv` in
their log repo: exercises they created, and shipped exercises they changed.
Both work immediately and offline. An id never leaves the shipped library once
it is in it, since logs reference it permanently.

### 9.1 Which version of an exercise the app uses

Every addition records, in its `based_on` cell, which shipped row it was made
against: empty for an exercise the shipped library did not have, otherwise the
first 12 hex characters of the SHA-1 of that shipped row as the app serialises
it (1.4, shipped columns only). Editing an addition sets `based_on` to the
shipped row current at that moment.

Whenever the app assembles the library (at launch, which is when a new shipped
library arrives, and whenever `additions.csv` changes), each addition is
decided with the rule of 4.3. **B** is the shipped row it was based on, **L**
the addition, **R** the shipped row now; rows are equal when their hashes are.

| Case      | Meaning                                                              | Result                                                                               |
| --------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| L = R     | The shipped library now holds exactly this row (a merged submission) | The shipped row is used; `based_on` is moved to it                                   |
| L = B     | The addition carries no change of its own, and the shipped row moved | The shipped row is used; the addition is deleted                                     |
| R = B     | The shipped row has not changed since the addition was made          | **The addition is used.** A brand-new exercise is this case too (both absent)        |
| Otherwise | The shipped row changed after the addition was made                  | **Conflict**, flagged like every other (5.2). The shipped row is used until resolved |

The first two results are ordinary writes and sync like any other. A rebase is
only written when `based_on` actually changes, so assembling the library twice
writes nothing the second time.

An addition whose `based_on` names a shipped row this build does not have was
made on a newer version of the app. Ids never leave the shipped library, so this
build simply has not seen that row yet. The addition is used and nothing is
written: to this build the base is as absent as the shipped row. The newer
version decides it properly once this device updates.

A library conflict is not written to `conflicts/`: both versions already persist, one in
the app and one in the log, so the conflict is derived afresh every time the
library is assembled, identically on every device.

Resolving it:

| Choice               | Effect                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| Use the official one | Delete the addition                                                                                    |
| Keep mine            | Set `based_on` to the current shipped row, so the addition wins from now on, and open a new submission |

A format change that alters how rows serialise must recompute every `based_on`
in the same migration, or every override becomes a false conflict.

### 9.2 Submissions

Saving an addition that differs from the shipped row with its id (a new
exercise, or a change to a shipped one) opens its submission automatically:
GitHub's new-issue page for the `new-exercise` form, every field filled in
through the URL's query string, marked as a new exercise or as a change to an
existing id. The lifter only taps Submit, signed in on github.com. It cannot be
filed without that tap: the log token is scoped to the log repo, and a
fine-grained token cannot write to a repository its owner does not own.

The workflow validates the row as it does now, except that an id already in the
shipped library is accepted when the submission says it is a change: the pull
request then replaces that row instead of adding one. Only the shipped columns
are submitted; `based_on` never leaves the log.

The submission workflow runs with write access to the app's repository and reads
text anyone can type. Every value from the issue (title, body, or anything
derived from them, including the validated row) must reach its shell steps only
through `env:`, referenced as quoted variables, never interpolated with
`${{ }}` into a `run:` script. The workflow on `master` today interpolates the
issue title and the row, which lets any GitHub user run commands with that
access. This is fixed as part of the rebuild.

## 10. Tests

The first version of this layer was tested with hand-picked examples, and each
review found cases none of them covered. This one is tested against properties.

**Pure pieces, tested exhaustively:**

- Serialisers: parse(serialise(x)) = x, and serialise(parse(s)) = s for every s
  the writer produces. The CSV reader handles quoting, embedded newlines and
  empty cells.
- Blob hash: matches `git hash-object` on fixtures, including the empty file
  (`e69de29bb2d1d6434b8b29ae775ad8c2e48c5391`).
- Ids: the format of 1.2, slugs of awkward names, and no repeats against ids
  already held.
- The decision (4.3): every combination of absent, equal and different B, L and
  R, for files and for table rows, in both full syncs and pulls.
- The library rule (9.1): the same combinations, plus a submission merged as
  sent, one merged with corrections, and a shipped row changed by someone else.

**The sync, simulated:** two or three simulated devices share the in-memory
remote. A seeded random schedule makes edits, deletes, conflicting edits and
resolutions, starts and ends sessions, runs syncs and pulls, drops the network,
and kills a device at every step of section 4.2, then lets every device sync
until nothing changes. After every schedule:

1. **Convergence.** Every device and the remote hold identical content.
2. **Nothing lost.** Every version a device wrote survives, in the data or in a
   conflict record, unless it was replaced or deleted by a write made on a
   device that had already seen it. A deletion counts as a version too, with
   exactly one exception: the known limit in 4.3. A deletion may be undone by
   a write made without seeing it, when the deleting side's content returned to
   its base in between. The simulation reports those cases separately and
   fails on any other.
3. **Nothing comes back.** A record deleted on a device that had seen all its
   versions stays deleted.
4. **Conflicts only when concurrent.** A conflict record appears only where two
   devices changed the same unit without either having seen the other's change.
5. **Quiet when idle.** A sync with nothing to do makes no commit.
6. **Crash-safe.** None of the above depends on where a device was killed. In
   particular, a device killed between moving the branch and recording it does
   not later see its own commit as a conflict.

The simulator keeps its own record of which device had seen which version, which
is what properties 2 to 4 are checked against. A failing seed is kept as a
regular test.

**The GitHub adapter** is tested against recorded responses, including a 409 on
an empty repo, a 422 that is not a non-fast-forward, a truncated tree and a
rate-limit response.

## 11. Build order

1. Model changes: readable ids for sessions and templates (1.2); manual records
   keyed by date, exercise and reps instead of an id; `based_on` on additions
   (9.1); the conflict record type.
2. Formats: serialisers, the CSV reader with quoting, the blob hash, id
   generation.
3. The decision (4.3, 4.4), as pure functions.
4. The device store: records, the write queue, `sync` entries.
5. The sync (4.2, 4.5) against the in-memory remote, with the simulation.
6. The GitHub adapter and the error classes.
7. Setup, status, triggers and scheduling.
8. The conflict notice, banner and resolution screen (5.2, 5.3).
9. The library rule (9.1), the submission workflow fix, and the automatic
   prefilled-issue link (9.2).

The current `src/storage/` is replaced, not adapted: its interfaces are built
around a dirty queue that this design does not have.

## Not decided yet

- **Where the app is hosted.** Every Pages site under `matheus-ft.github.io`
  shares one origin, so any of them can read the tokens stored by this one. A
  custom domain, or a Pages site under a separate account or organisation, would
  isolate it.
