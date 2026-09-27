# Storage and sync

The specification the storage layer is built from. `DESIGN.md` says why each
decision was made and what was rejected; `DATA.md` says what each file in the
log repo holds; `DURABILITY.md` says what the lifter sees. This file says exactly
how it works, precisely enough to implement and test against.

"Must" is a requirement. Anything this file does not specify is not decided yet,
and is listed under [Not decided yet](#not-decided-yet) rather than guessed at.

## The model in one paragraph

The device holds a working copy; a private GitHub repo, the **log repo**, is the
archive. Every write lands on the device first, immediately, with no network.
A sync compares three versions of every file in the log repo: the **base** (what
this device and the remote last agreed on), the **local** version and the
**remote** version. What changed on one side is taken from that side. What
changed differently on both sides is a **conflict**: both versions are kept, in
the data itself, until the lifter picks one. Everything the sync decides is then
written as one commit and the branch is moved by fast-forward only, so a device
that raced ahead is detected and merged, never overwritten.

## 1. The log repo

### 1.1 Layout

```
sisyphos.json                      format marker, see 1.2
sessions/<YYYY>/<id>.json          one file per session
templates/<id>.json                one file per template
lifter/bodyweight.csv              one table per kind of lifter data
lifter/one-rm-history.csv
lifter/manual-records.csv
library/additions.csv              exercises the lifter created
```

- `<YYYY>` is the year of the session's `created_at`, which never changes. A
  path must depend only on fields that never change, so re-dating a session edits
  one file and moves nothing.
- Columns and keys of each table are listed in `DATA.md`.
- Any other file in the repo (a README, the lifter's own notes) is not the app's.
  It must never be modified or deleted, and every commit must carry it forward
  unchanged.

### 1.2 Format marker

`sisyphos.json` holds `{ "format": 1 }`. The app knows the highest format it can
read.

- **Same format:** sync normally.
- **Older:** the app migrates every file in one commit, through the normal sync
  (section 4), before anything else.
- **Newer:** the app stops syncing and tells the lifter to update. Logging on
  the device continues; nothing is lost, it just waits.

A log repo without `sisyphos.json` is handled by setup (section 8), never by
sync.

### 1.3 Serialisation

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
- A cell containing a comma, a double quote, `\r` or `\n`, or starting with `#`,
  is wrapped in double quotes, with inner quotes doubled (RFC 4180). No other
  cell is quoted.
- `null` is an empty cell. Booleans are `true` or empty. Numbers use JavaScript's
  shortest round-trip form (`String(n)`). Dates are `YYYY-MM-DD`; instants are
  ISO-8601 UTC with milliseconds.
- Rows are sorted by the table's key (listed in `DATA.md`), compared field by
  field in the order listed: numbers numerically, everything else by code point.
  Rows sharing a key, which happens only while they are in conflict (section 5),
  follow in this order: the row with an empty `conflict` cell first, then the
  rest ordered by their serialised text.

A table whose header row is not exactly the one its format defines is
unreadable (section 6). The CSV reader must accept everything the writer produces, including quoted
cells with embedded newlines. The current `src/csv.ts` splits on newlines and
does not handle quoting, so it must be replaced. The shipped library files are
read with the same reader and are unaffected: they contain no quoted cells.

**Files the app did not write.** A remote file that parses but does not
serialise back to the same bytes (hand-formatted JSON, say) is taken, then
rewritten in the app's form by the next sync. That costs one commit and then
settles. A remote file that does not parse is **unreadable** (section 6).

## 2. On the device

### 2.1 What is stored

IndexedDB holds, per install:

| Store                     | Contents                                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| One store per record type | Sessions, templates, and the rows of each table. Sessions are indexed by `date`                                               |
| `sync`                    | One entry per log-repo path: `base_sha`, `local_sha`, `unsynced_since`, and for tables `base_body`                            |
| `sync_meta`               | `last_synced_head` and `last_synced_tree`: the commit, and its tree, that every base agreed with when the last sync completed |
| `inflight`                | At most one entry: the commit this device is trying to land (section 4.4)                                                     |
| `settings`                | Repo owner and name, branch, token, device id. Never synced                                                                   |

The device id is random, generated once per install and never copied between
devices. A restored device gets a new one.

The IndexedDB schema is versioned. Opening an older version migrates it in the
upgrade transaction, and a migration never drops data.

### 2.2 Writing

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
   3). Hashing is asynchronous, so it happens here, **before** any transaction
   opens.
3. Opens one transaction and writes the record and its path's `sync` entry
   together. No `await` may separate two requests of one transaction: IndexedDB
   commits a transaction as soon as the microtask queue drains with nothing
   pending, and an `await` between requests can split one write into two.

Because the queue runs one operation at a time, the read in step 1 cannot go
stale before step 3. A write whose only change would be a new `updated_at` is
skipped entirely.

`updated_at` on a record is set by the write that changes it. It is shown to the
lifter when resolving a conflict and is never used to decide anything.

### 2.3 Tables have one standing row per key

The write API for a table replaces the row with the given key. There is at most
one row per key with an empty `conflict` cell (the **standing** row). Changing a
key field, such as re-dating a weigh-in, is a delete of the old key and an add
of the new one.

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

1. **Recover** an unfinished commit, if `inflight` holds one (4.4).
2. **Read the head.** If it equals `last_synced_head` and no path needs syncing,
   stop. The common case therefore costs one request.
3. **Read the remote tree**, recursively. When the head has not moved, no
   request is needed: the remote's files are exactly the bases, and the tree is
   `last_synced_tree`.
4. **Fetch** the content the decision needs (4.3): the remote version of every
   path whose remote sha differs from both its base and its local sha.
   Concurrency is capped at six requests.
5. **Decide**, as one operation on the write queue (2.2), every path whose base,
   local and remote versions are not all equal (4.3). Then, in the same
   operation:
   - write each result to the device where it differs from the local version;
   - where the result equals the remote version, set the path's base to it. The
     remote holds that version at this head whatever happens next, so this is
     true even if the push below fails;
   - collect every result that differs from the remote version: that is what
     must be pushed.
6. If nothing must be pushed, set `last_synced_head` and `last_synced_tree` to
   the head and stop.
7. **Write** the tree (on the head's tree) and the commit (parent: the head).
8. **Record** the commit and its tree in `inflight` (on the write queue), with
   the sha of every pushed path, and for tables the pushed body.
9. **Move the branch** to the commit, fast-forward only.
10. **Settle**, on the write queue: set each pushed path's base to what was
    pushed (for tables, `base_body` too), set `last_synced_head` and
    `last_synced_tree`, and clear `inflight`.

If step 9 is refused because the branch moved, clear `inflight` and go back to
step 2. The base of every pushed path is still the old one, so the next round
merges correctly against the new remote. After five rounds the sync stops with a
retryable error (section 6).

A refusal is only "the branch moved" if a fresh read of the head shows it
differs from the commit's parent. GitHub answers 422 both for a
non-fast-forward and for validation failures, and treating every 422 as the
former turns a real error into an endless retry.

### 4.3 Deciding one path

For files that hold one record (sessions, templates), the unit is the file. For
tables, the unit is the group of rows sharing a key: normally one row, more
during a conflict. Let **B**, **L** and **R** be a unit's base, local and remote
versions, each possibly absent. Units are equal when their serialisations are
equal. The rows are checked in order, and the first that
matches applies.

| Case                                        | Result                                                            |
| ------------------------------------------- | ----------------------------------------------------------------- |
| L = R                                       | Nothing to do                                                     |
| L = B, R ≠ B                                | Take R                                                            |
| R = B, L ≠ B                                | Push L                                                            |
| L, R and B all differ; L and R both present | **Both edited**: R stands; L is kept beside it as a conflict copy |
| L ≠ B, R absent                             | **Edited and deleted**: L is kept, marked                         |
| L absent, R ≠ B                             | **Edited and deleted**: R is kept, marked                         |

"Absent" for a table unit means no rows with that key. A deletion is detected by
comparison with the base, so nothing is ever kept to mark a record as deleted.
A device that never agreed on a path (null base) takes what the remote has and
pushes what it has, and conflicts where both have different content. That is
exactly right for a first sync onto an existing log.

For a table, the file's result is the combination of every key's result, and it
is pushed if it differs from R. A table's result is computed from the device's
current rows at step 5, so an edit made while step 4 was fetching is included,
not overwritten.

The decision is a pure function of B, L and R. It must be implemented, and
tested exhaustively, separately from everything that reads and writes them.

### 4.4 Recovering an unfinished commit

A device can be killed after step 9 (the branch moved) and before step 10 (the
device recorded it). Without a record, its next sync would compare its content
with a base from before its own commit, and could report its own work as a
conflict.

Step 8 prevents that. On the next sync, before anything else, if `inflight`
holds a commit:

1. Ask whether the current head's history contains it (the compare operation:
   `identical` or `ahead` means it does).
2. If it does, the commit landed: apply step 10 from the recorded shas.
3. Either way, clear `inflight`. If the commit never landed, the device's
   content is still local and its bases are unchanged, so the sync that follows
   pushes it again.

## 5. Conflicts

A conflict is recorded **in the data**, not in device state. It therefore syncs,
shows on every device, survives a reinstall, and can be resolved from any device.
Sync never stops for a conflict and never asks: it keeps both versions and
carries on. Resolving is the lifter's job, by hand.

### 5.1 How a conflict is written

| Kind                   | Session or template                                                                                                                | Table row                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Both edited**        | R stays at its path, unchanged. L is written as a new record with a new id and `conflict: { kind: "both_edited", of: "<R's id>" }` | R's rows stand unchanged. L's rows that R does not have are added with `conflict` = `both_edited` |
| **Edited and deleted** | The edited version is kept at its path with `conflict: { kind: "edited_and_deleted" }`                                             | The edited rows are kept with `conflict` = `edited_and_deleted`                                   |

Records not in conflict have `conflict: null` (JSON) or an empty `conflict`
cell (CSV).

A conflict copy is ordinary data. If it is edited on two devices in turn, the
same rules apply to it again, and repeating a merge that already produced a
copy produces the same copy. Merging is idempotent, so interrupted and retried
syncs converge.

### 5.2 What a conflict means while unresolved

- A record marked `both_edited` is excluded from every calculation: analysis,
  records, prescriptions, bodyweight hints, exports. The version it conflicts
  with stands and counts until the lifter decides.
- A record marked `edited_and_deleted` is also excluded: one device said it
  should not exist.
- The UI lists every marked record, showing both versions with their
  `updated_at` and, for sessions, their `device_id`.

### 5.3 Resolving

Resolving is an ordinary edit made through the write queue, and it syncs like
any other.

| Conflict           | Keep the standing version | Keep the copy                                                                                                                                                                 |
| ------------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Both edited        | Delete the copy           | Sessions and templates: write the copy's content over the original (same id, `conflict: null`) and delete the copy. Rows: delete the standing row and clear the copy's marker |
| Edited and deleted | Clear the marker          | Delete the record                                                                                                                                                             |

Two devices resolving the same conflict differently before syncing produce a new
conflict under the same rules. That is rare and still loses nothing.

## 6. Errors

Every failure falls in exactly one class, and the class decides what happens.

| Class               | Examples                                                                                                           | Behaviour                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Retryable**       | No network, timeout, 5xx, five rounds lost to other devices                                                        | Back off (7.2) and retry                                                                                                                                                                              |
| **Rate limit**      | 403 or 429 with `x-ratelimit-remaining: 0` or `retry-after`                                                        | Wait until the time GitHub gives, then retry                                                                                                                                                          |
| **Token**           | 401; 403 that is not a rate limit                                                                                  | Stop automatic syncing. Status asks for a new token; syncing resumes once one is saved                                                                                                                |
| **Repo**            | 404 for the repo or branch (gone, renamed, or no longer visible to the token); format marker missing or unreadable | Stop automatic syncing. Status says what is wrong                                                                                                                                                     |
| **Update**          | Format newer than the app understands                                                                              | Stop syncing. Status asks the lifter to update the app                                                                                                                                                |
| **Unreadable file** | A log-repo file that does not parse                                                                                | That path is left alone: not taken, not pushed, not overwritten. Every other path syncs, but the sync does not record the head as synced, so the next one reads the tree again. Status names the file |
| **Bug**             | A fetched blob whose hash does not match its sha; a serialiser that fails to round-trip                            | Stop syncing and report it. Never guess past a broken invariant                                                                                                                                       |

A failed sync never loses anything: the device's content is untouched by a sync
that did not reach step 5, and step 5 only applies decisions it has finished
computing.

## 7. When syncing happens

### 7.1 Triggers

A **session in progress** is one with `ended_at` null that was written in the
last 12 hours. The 12-hour limit matches the stale-session nudge, so a forgotten
session cannot pause syncing forever.

| Trigger                         | While a session is in progress |
| ------------------------------- | ------------------------------ |
| App launch                      | Syncs                          |
| Setup completed                 | Syncs                          |
| A session ended                 | Syncs                          |
| The lifter asks                 | Syncs                          |
| App hidden (`visibilitychange`) | Skipped                        |
| Connection regained (`online`)  | Skipped                        |
| Retry after a failure           | Skipped                        |

There is no timer-driven sync. iOS reports the app as hidden every time the
phone is locked, which between sets is constantly; syncing on each would put a
commit per set in the history. A session in progress is safe on the device, and
the accepted risk is losing the phone mid-session.

A sync started when the app is hidden may be cut off when iOS suspends it. It
must never be relied on; the next launch finishes the job, and the in-flight
record (4.4) makes that safe.

### 7.2 One sync at a time

- Syncs run under the Web Locks API (`navigator.locks`), lock name
  `sisyphos-sync`, so two open tabs or windows never sync at once.
- A trigger arriving during a sync schedules exactly one more sync after it,
  however many arrive. The caller of a sync that was folded into the next one
  waits for that one.
- After a retryable failure, retries back off from 30 seconds, doubling, capped
  at 15 minutes, and reset after a success. A trigger that is not skipped (7.1)
  and arrives while backing off runs a sync immediately.
- Stopping the scheduler (app teardown) cancels every timer and prevents any
  from being set again.

### 7.3 Status and exposure

The UI always shows two things.

**Sync status:** `syncing`, `idle`, `offline`, `retrying` (with the next
attempt's time), `needs token`, `repo problem`, `needs update`, `not set up`.
It also shows a count of unresolved conflicts, and names any unreadable file.

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
   - **No commits:** writes `sisyphos.json` with `PUT /repos/{o}/{r}/contents/sisyphos.json`.
     The Git Data API cannot write to an empty repository, so this is the one
     use of the Contents API.
   - **No `sisyphos.json`, and nothing but README, LICENSE or .gitignore files:**
     commits `sisyphos.json`.
   - **No `sisyphos.json`, and other files:** refuses. This is not a log.
   - **`sisyphos.json` present:** checks the format (1.2).
4. Runs the first sync. On a fresh install this is the restore; on a device
   that logged before setup, it merges what the device has with what the log
   holds (section 4.3, null bases).

Write access is proven by the first commit; a 403 then is a **Token** error
whose message names the Contents permission. A new token can be pasted at any
time, and nothing else changes. Pointing the device at a **different repo** is
another matter: it clears every base, `last_synced_head`, `last_synced_tree` and
`inflight`, so the first sync with the new repo is a first sync (null bases), and
never compares against the old repo's history. Skipping setup is allowed; exposure is then
`unprotected` until it is done.

The token is stored in `settings` on the device only. It is sent only as an
`Authorization` header to `api.github.com`, and never logged or synced.

## 9. Exercise submissions

Creating an exercise writes it to `library/additions.csv` so it works
immediately, offline. Proposing it for the shared library opens GitHub's
new-issue page for the `new-exercise` form, with every field filled in through
the URL's query string. The lifter submits it signed in on github.com. The log
token is not involved: a fine-grained token cannot write to a repository its
owner does not own.

The submission workflow runs with write access to the app's repository and reads
text anyone can type. Every value from the issue (title, body, or anything
derived from them, including the validated row) must reach its shell steps only
through `env:`, referenced as quoted variables, never interpolated with
`${{ }}` into a `run:` script. The workflow on `master` today interpolates the
issue title and the row, which lets any GitHub user run commands with that
access. This is fixed as part of the rebuild.

## 10. Tests

The previous storage layer was tested with hand-picked examples, and each review
found cases none of them covered. This one is tested against properties.

**Pure pieces, tested exhaustively:**

- Serialisers: parse(serialise(x)) = x, and serialise(parse(s)) = s for every s
  the writer produces. The CSV reader handles quoting, embedded newlines and
  empty cells.
- Blob hash: matches `git hash-object` on fixtures, including the empty file
  (`e69de29bb2d1d6434b8b29ae775ad8c2e48c5391`).
- The decision (4.3): every combination of absent, equal and different B, L and
  R, for files and for table units.

**The sync, simulated:** two or three simulated devices share the in-memory
remote. A seeded random schedule makes edits, deletes, conflicting edits and
resolutions, runs syncs, drops the network, and kills a device at every step of
section 4.2, then lets every device sync until nothing changes. After every
schedule:

1. **Convergence.** Every device and the remote hold identical content.
2. **Nothing lost.** Every version a device wrote survives, as the standing
   version or as a conflict copy, unless it was replaced or deleted by a write
   made on a device that had already seen it.
3. **Nothing comes back.** A record deleted on a device that had seen all its
   versions stays deleted.
4. **Conflicts only when concurrent.** A conflict mark appears only where two
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

1. Model changes: the `conflict` field on sessions and templates; `updated_at`
   and `conflict` on table rows; manual records keyed by exercise, reps and date
   instead of an id.
2. Formats: serialisers, the CSV reader with quoting, the blob hash.
3. The decision (4.3), as pure functions.
4. The device store: records, the write queue, `sync` entries.
5. The sync (4.2, 4.4) against the in-memory remote, with the simulation.
6. The GitHub adapter and the error classes.
7. Setup, status, triggers and scheduling.
8. The submission workflow fix and the prefilled-issue link.

The current `src/storage/` is replaced, not adapted: its interfaces are built
around a dirty queue that this design does not have.

## Not decided yet

- **Which exercise wins when upstream adopts an addition.** Today a local
  addition overrides a shipped exercise with the same id, so an accepted
  submission changes nothing. If a reviewer corrected the row before merging,
  the device keeps the uncorrected version forever. The alternative is that the
  shipped row wins once it exists and the addition is dropped.
- **Where the app is hosted.** Every Pages site under `matheus-ft.github.io`
  shares one origin, so any of them can read the tokens stored by this one. A
  custom domain, or a Pages site under a separate account or organisation, would
  isolate it.
