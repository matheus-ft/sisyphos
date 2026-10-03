#!/usr/bin/env node
/**
 * Turns a submitted issue into a row in src/library/exercises.csv: a new row
 * after the last one, or, when the submission is a change, a replacement for the
 * row with its id. The checks themselves are in add-exercise-core.mjs.
 *
 * Reads the issue body on stdin and runs from the repository root. On success it
 * writes the file and prints the row, or with --json the kind, id, name and row
 * as one JSON object. Otherwise it prints the problems, one Markdown list item
 * each, to stderr and exits 1.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { addExercise } from './add-exercise-core.mjs';

const CSV = 'src/library/exercises.csv';
const MUSCLES = 'src/library/muscles.csv';

const result = addExercise({
  body: readFileSync(0, 'utf8'),
  exercises: readFileSync(CSV, 'utf8'),
  muscles: readFileSync(MUSCLES, 'utf8'),
});

if (!result.ok) {
  console.error(result.problems.map((p) => `- ${p}`).join('\n'));
  process.exit(1);
}

writeFileSync(CSV, result.exercises);
console.log(
  process.argv.includes('--json') ? JSON.stringify(result.submission) : result.submission.row,
);
