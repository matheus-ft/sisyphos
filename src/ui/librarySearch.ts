import type { CompetitionLift, Exercise, Tier } from '../model';

/**
 * Searching and filtering the exercise library, for Agora's Library page and
 * the picker for a record's exercise.
 */

/** Lowercased and stripped of accents, so "romanian" finds "Romanian". */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** What the tier pill reads: the lifter's words, not the library's keys. */
export const TIER_LABEL: Record<Tier, string> = {
  comp: 'Main',
  high_spec: 'Variant',
  low_spec: 'Distant',
  acc: 'Accessory',
};

export const TIERS: readonly Tier[] = ['comp', 'high_spec', 'low_spec', 'acc'];

/** The base-lift filter's choices: the three lifts, or exercises that serve none. */
export type LiftFilter = CompetitionLift | 'none';

export const LIFT_FILTERS: readonly { value: LiftFilter; label: string }[] = [
  { value: 'squat', label: 'Squat' },
  { value: 'bench', label: 'Bench' },
  { value: 'deadlift', label: 'Deadlift' },
  { value: 'none', label: 'No competition lift' },
];

export interface LibraryFilter {
  query: string;
  lift: LiftFilter | null;
  tier: Tier | null;
  /** A muscle id, matching an exercise that credits it as primary or aux. */
  muscle: string | null;
}

export const NO_FILTER: LibraryFilter = { query: '', lift: null, tier: null, muscle: null };

/** The exercises matching every word typed and every chip set, by name. */
export function filterLibrary(library: readonly Exercise[], filter: LibraryFilter): Exercise[] {
  const words = fold(filter.query).split(/\s+/).filter(Boolean);
  return library
    .filter((e) => {
      if (!words.every((w) => fold(`${e.name} ${e.id}`).includes(w))) return false;
      if (filter.lift !== null && (e.base_lift ?? 'none') !== filter.lift) return false;
      if (filter.tier !== null && e.tier !== filter.tier) return false;
      if (filter.muscle !== null) {
        if (!e.muscles.primary.includes(filter.muscle) && !e.muscles.aux.includes(filter.muscle))
          return false;
      }
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** True when anything narrows the list. */
export function isFiltered(filter: LibraryFilter): boolean {
  return (
    filter.query.trim() !== '' ||
    filter.lift !== null ||
    filter.tier !== null ||
    filter.muscle !== null
  );
}

/** "quads, glutes": the primary muscles in the lifter's names. */
export function muscleLine(exercise: Exercise, names: ReadonlyMap<string, string>): string {
  return exercise.muscles.primary.map((m) => (names.get(m) ?? m).toLowerCase()).join(', ');
}

/**
 * Whether the typed name is worth offering as a new exercise: something was
 * typed and no exercise already has exactly that name.
 */
export function canCreate(library: readonly Exercise[], query: string): boolean {
  const typed = fold(query.trim());
  return typed !== '' && !library.some((e) => fold(e.name) === typed);
}
