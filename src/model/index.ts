/**
 * The data model, in three parts:
 *
 *   primitives  the scalars everything is built from — ids, dates, intervals,
 *               load units — and the operations on them
 *   taxonomy    how exercises are classified. This is what config/muscles.csv
 *               and config/exercises.csv describe, and none of it appears in a
 *               log: a set references an exercise by id and nothing more
 *   records     everything recorded about your training — sessions, sets,
 *               templates, reference maxes, records, bodyweight
 *
 * The seam that matters is the second one. Changing how an exercise is
 * classified changes every past analysis and rewrites no logs, which only works
 * because the two never mix.
 *
 * Import from here rather than from the parts, so moving a type between them is
 * not a breaking change.
 */
export * from './primitives';
export * from './taxonomy';
export * from './records';
