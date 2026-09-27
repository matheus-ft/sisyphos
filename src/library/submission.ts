import type { Exercise } from '../model';

/**
 * Proposing an exercise for the shared library (docs/STORAGE.md 9.2): GitHub's
 * new-issue page for the `new-exercise` form, every field filled in through the
 * query string. The lifter taps Submit, signed in on github.com.
 *
 * GitHub fills an issue form field from the query parameter named by the
 * field's `id`: "If provided, the `id` is the canonical identifier for the field
 * in URL query parameter prefills" (Syntax for GitHub's form schema, Keys,
 * https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-githubs-form-schema#keys),
 * and "You can also use URL query parameters to fill custom text fields that you
 * have defined in issue form templates" (Creating an issue from a URL query,
 * https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue#creating-an-issue-from-a-url-query).
 * That promise covers text fields only, which is why every field of the form is
 * an input.
 *
 * There is deliberately no `labels` parameter. The same page says a query
 * parameter needs the permission its action needs, and answers 404 without it,
 * so it would break the link for everyone but the maintainers. The form applies
 * its label itself.
 */

export type SubmissionKind = 'new' | 'change';

/** The app's repository, where the shared library lives. */
export const APP_REPO = 'matheus-ft/sisyphos';

/** The form, in .github/ISSUE_TEMPLATE/. */
const TEMPLATE = 'new-exercise.yml';

/**
 * One value per field of the form, keyed by field id, written the way
 * scripts/add-exercise-core.mjs reads it back: the row the library would hold.
 */
function formFields(exercise: Exercise, kind: SubmissionKind): [string, string][] {
  return [
    ['kind', kind],
    ['id', exercise.id],
    ['name', exercise.name],
    // Serving no competition event is spelled out, since the field is required.
    ['base_lift', exercise.base_lift ?? 'none'],
    ['tier', exercise.tier],
    ['unilateral', String(exercise.unilateral)],
    ['load_type', exercise.load_type],
    ['default_unit', exercise.default_unit],
    ['primary', exercise.muscles.primary.join('/')],
    ['aux', exercise.muscles.aux.join('/')],
  ];
}

export function submissionUrl(
  exercise: Exercise,
  kind: SubmissionKind,
  repo: string = APP_REPO,
): string {
  const title = kind === 'new' ? `exercise: ${exercise.name}` : `exercise change: ${exercise.name}`;
  // URLSearchParams encodes as HTML forms do, a space as "+", which is how
  // GitHub's own examples write it (`title=New+bug+report`).
  const query = new URLSearchParams([
    ['template', TEMPLATE],
    ['title', title],
    ...formFields(exercise, kind),
  ]);
  return `https://github.com/${repo}/issues/new?${query}`;
}
