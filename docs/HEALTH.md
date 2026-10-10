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

In the steps below, `<token>` is that token, `OWNER/REPO` is your log repo, and
`lifter/bodyweight.csv` is the file in it.

## The automation

1. Open Shortcuts and go to **Automation**. Tap **+**, then **Personal
   Automation**.
2. Choose **App**, pick **Happy Scale**, and select **Is Closed**. Tap **Next**.
3. Choose **Run Immediately**. Turn off anything that asks before running.

The trigger is leaving Happy Scale, not a time of day. Health cannot be read
while the phone is locked, and a time-based automation can fire while it is.
Leaving the app after a weigh-in means the weigh-in is already in Health.

## The actions

Add these in order. Names in quotes are the action titles; some may read
differently on your iOS version (see the last section).

1. **Find Health Samples.** Type is Weight, Source is Happy Scale, Start Date is
   today. Sort by Start Date, latest first, Limit 1. If none, **Stop**.
2. **Get Details of Health Sample.** Take Value, Unit and Start Date.
3. If Unit is `lb`, multiply Value by `0.45359237`. Round to 2 decimal places.
4. **Replace Text** `,` with `.`, and trim. Store the result as `kg`.
5. **Format Date** from Start Date, custom format `yyyy-MM-dd`. Store as `day`.
6. **Get Contents of URL**: GET `https://api.github.com/repos/OWNER/REPO/contents/lifter/bodyweight.csv`
   with headers `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`,
   and `X-GitHub-Api-Version: 2022-11-28`.
7. If the response has no `sha`, the file is absent: set `csv` to
   `date,weight_kg,source` followed by a newline, and leave `sha` empty.
   Otherwise, take `sha`, remove the newlines from `content`, Base64 Decode it,
   and store the result as `csv`.
8. **Match Text** `(?m)^<day>,` in `csv`. If it matches, **Stop**. Never
   overwrite a day.
9. **Text**: `csv` (with a newline added if it does not end in one), then
   `<day>,<kg>,import`, then a newline.
10. **Base64 Encode**, with Line Breaks set to None.
11. **Get Contents of URL**: PUT to the same URL, with a JSON body of
    `message` set to `health: bodyweight <day>`, `content` set to the encoded
    text, and `sha` set to the value from step 7. Omit `sha` when creating the
    file.
12. If the response has no `commit`, **Show Notification** "Weigh-in not sent".
    The next run retries.

The Shortcut writes `source` as `import` only. The app writes `manual` for
weigh-ins typed in it (see `DATA.md`, Serialisation).

## What can go wrong

- **A 409 response.** The app wrote to the file between step 6 and step 11, so
  the `sha` is stale. Nothing is written. The next run retries from the start.
- **The same day weighed in the app before it synced.** Step 8 finds the day in
  the file and stops, so the Shortcut does not overwrite it. If the app's
  weigh-in is unsynced and the Shortcut's row lands first, the conflict screen
  asks which to keep when the app next syncs. Pick one; sync does not stop for it.
- **A malformed row** makes the whole bodyweight table unreadable until someone
  fixes it by hand. The steps above guard against each cause: a decimal comma
  (step 4 turns it into a point), a second row for one day (step 8), a quote
  (no step writes one), and a source other than `manual` or `import` (step 9
  always writes `import`).

## Why there is no .shortcut file

Since iOS 15 an imported Shortcut must be signed, and signing needs a Mac. A
shared file would also carry the token inside it. So you build it once from the
steps above, with your own token.

## Not verified on a device

These steps have not been run on a phone. Action names, option labels and the
order of settings may differ by iOS version. The logic is what matters: find the
latest weigh-in for today, convert it to kg, append it only if the day is absent,
and write the file with its `sha`.
