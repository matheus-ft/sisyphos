# Weigh-ins from Apple Health

Happy Scale writes each weigh-in to Apple Health. A personal automation in the
iOS Shortcuts app can copy that weigh-in into your log repo, so it reaches
Sisyphos on the next sync without you typing it. The app needs no code for this:
the Shortcut writes a row to `lifter/bodyweight.csv` in the repo, and sync picks
it up like any other change.

## Why a Shortcut

A home-screen web app cannot read Health. Only native apps and Shortcuts can.

The other route, opening a Sisyphos link from Shortcuts, lands in Safari, which
keeps its own storage separate from the installed app. A row written that way
would never reach the phone's copy of the log. So the Shortcut does not hand
anything to the app. It writes to the repo directly, and the app reads the repo.

## A token

Make a fine-grained GitHub token for the log repo only:

- **Repository access:** only the log repo
- **Permissions:** Contents, Read and write

Use a token of its own, not the one the app uses. Then you can revoke the
Shortcut's access without signing the app out, and the other way round. Keep
the token in the Shortcut only. Never paste it anywhere you would not paste a
password.

## Making the Shortcut

On a Mac signed in to an Apple Account, from the repo root:

```sh
python3 scripts/health-shortcut.py unsigned.shortcut
shortcuts sign --mode anyone --input unsigned.shortcut --output "Sisyphos weigh-in.shortcut"
```

The first command builds the Shortcut unsigned; the second signs it, since
iOS imports only signed ones. `shortcuts sign` can sit on after it has written
the file: once `Sisyphos weigh-in.shortcut` exists, stop it with Ctrl-C. The
file holds no token and no repo name, so it is safe to share.

1. AirDrop it to the iPhone and open it there. The Mac's Shortcuts has no Health
   actions, so do not import it on the Mac.
2. On import it asks for the token and for the log repo as `OWNER/REPO`.
3. Open it once and check that **Find Health Samples** reads **Type is Weight**.

## The automation

The file cannot carry its trigger, so make it on the phone:

1. In Shortcuts, go to **Automation**, tap **+**, choose **App**, pick
   **Happy Scale** and select **Is Closed**.
2. Choose **Run Immediately**, and turn off anything that asks before running.
3. For the action, choose **Run Shortcut** with **Sisyphos weigh-in**.

The trigger is leaving Happy Scale, not a time of day. Health cannot be read
while the phone is locked, and a time-based automation can fire while it is.
Leaving the app after a weigh-in means the weigh-in is already in Health.

## What it writes

Today's latest weight sample, from any source, as `<day>,<kg>,import`. It
writes nothing when:

- there is no weight sample from today;
- the file already has a row for today, since it never overwrites a day;
- the weight is not 20 to 399 kg, with at most 2 decimals. You get a
  notification showing the value it read.

It writes `source` as `import` only. The app writes `manual` for weigh-ins typed
in it (see `DATA.md`, Serialisation). How each step does this, and why, is in
`scripts/health-shortcut.py`.

## What can go wrong

- **A 409 response.** The app wrote to the file between the Shortcut's read and
  its write, so its `sha` is stale. Nothing is written, a notification says so,
  and the next run retries.
- **The same day weighed in the app before it synced.** The Shortcut finds the
  day in the file and stops. If the app's weigh-in is unsynced and the
  Shortcut's row lands first, the conflict screen asks which to keep when the
  app next syncs. Pick one; sync does not stop for it.
- **An "Unknown action" after an iOS update.** The file format is Shortcuts'
  private one, and iOS may rename an action. Fix the identifier in the script
  and build again.

## Why it is generated, not shipped

Since iOS 15 an imported Shortcut must be signed, and signing needs a Mac. A
signed file would be an opaque binary in the repo, where nobody can review what
it does with the token. The script is the reviewable source, and anyone with a
Mac can build the same file.
