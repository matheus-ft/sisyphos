# Branch rulesets

Import through **Settings → Rules → Rulesets → New ruleset → Import a ruleset**.
Only one of these should be active at a time; they both target the default
branch, and where two rulesets overlap the stricter one wins.

## `master-solo.json` — use this now

Blocks deletion and force pushes. Nothing else, because nothing else earns its
cost while one person is pushing several times a day.

Note what is deliberately absent:

**No required approvals.** You cannot approve your own pull request. Requiring
one while you are the only maintainer locks you out of your own repository, and
the only way out is a bypass, at which point it was never protection.

**No required status checks.** A commit cannot have passing checks before it
exists, so requiring them rejects direct pushes outright — it does not merely
gate merges. That is correct discipline later and pure drag now.

## `master-team.json` — use this once someone else contributes

Adds the pull request workflow the solo ruleset leaves out:

- one approving review, dismissed when new commits land
- the `build` job must pass, and the branch must be current with master
- review threads resolved before merge
- linear history, and merges by squash or rebase only

`build` is the job name in `.github/workflows/deploy.yml`, which runs
`npm run check` and the full test suite. It only becomes available as a required
check after it has run at least once on the repository.

Switching to this is also the moment to give yourself a bypass actor if you want
an escape hatch for an emergency fix — add it in the UI under **Bypass list**
rather than hand-editing an actor id in here.

## Why rulesets rather than classic branch protection

They are what you are holding: a ruleset exports and imports as JSON, so it lives
in the repository and gets reviewed like anything else. Classic branch protection
is only ever a set of checkboxes in a settings page.

Beyond that: rulesets layer, so several can apply at once and you can add a
stricter one without rewriting the existing rule; they can target tags and pushes
rather than branches alone; `~DEFAULT_BRANCH` tracks whatever the default is
instead of naming a branch that might get renamed; the rejection message names
the rule that blocked you; and bypass is an explicit list of actors rather than a
single "include administrators" checkbox. Rulesets are free on public
repositories.

Classic branch protection still works and is not going away tomorrow, but
GitHub's documentation now leads with rulesets and new capabilities land there.
