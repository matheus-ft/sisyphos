# Branch rulesets

Import through **Settings → Rules → Rulesets → New ruleset → Import a ruleset**.
Only one of these should be active at a time; they both target the default
branch, and where two rulesets overlap the stricter one wins.

## `master-solo.json` — use this now

Every change reaches master through a pull request that `build` has passed:

- no deletion, no force push, linear history
- a pull request, merged by squash, with no approval required
- the `build` check passing

**No required approvals.** You cannot approve your own pull request, so requiring
one while you are the only maintainer locks you out of your own repository.

**The branch need not be current with master.** Requiring it makes every pull
request opened alongside another wait for an update and a second run. A merge
that breaks master is still caught: master's own run fails before deploying.

## `master.json` — use this once someone else contributes

The same, plus what review needs:

- one approving review, dismissed when new commits land, and the last push
  approved by someone other than its author
- review threads resolved before merge
- the branch current with master before merging

Switching to this is also the moment to give yourself a bypass actor if you want
an escape hatch for an emergency fix: add it in the UI under **Bypass list**
rather than hand-editing an actor id in here.

## The `build` check

`build` is the job in `.github/workflows/ci.yml` that runs the checks and the
Pages build on every pull request. GitHub offers it as a required check only
after it has run once on the repository, which it has.

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
