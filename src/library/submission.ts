import type { Exercise } from '../model';

/**
 * Proposing an exercise for the shared library (docs/STORAGE.md 9.2): GitHub's
 * new-issue page for the `new-exercise` form, every field filled in through the
 * query string. The lifter taps Submit, signed in on github.com.
 *
 * STUB — implemented by the submissions work package.
 */

export type SubmissionKind = 'new' | 'change';

/** The app's repository, where the shared library lives. */
export const APP_REPO = 'matheus-ft/sisyphos';

export function submissionUrl(
  _exercise: Exercise,
  _kind: SubmissionKind,
  _repo: string = APP_REPO,
): string {
  throw new Error('not implemented: library/submission');
}
