import { describe, it, expect } from 'vitest';
import { APP_REPO, submissionUrl, type SubmissionKind } from '../src/library/submission';
import { parseExercises, parseMuscles } from '../src/library/parse';
import { addExercise, muscleIds, readSubmission } from '../scripts/add-exercise-core.mjs';
import type { Exercise } from '../src/model';
import form from '../.github/ISSUE_TEMPLATE/new-exercise.yml?raw';
import musclesCsv from '../src/library/muscles.csv?raw';
import exercisesCsv from '../src/library/exercises.csv?raw';

interface FormField {
  type: string;
  id: string;
  label: string;
  placeholder: string;
  required: boolean;
}

/**
 * The fields of the issue form, in order. Reads this one file's layout (block
 * style, two-space indents) rather than YAML in general, which keeps a YAML
 * parser out of the dependencies.
 */
function formFields(yaml: string): FormField[] {
  const value = (block: string, key: string) =>
    (new RegExp(`\\n {4,6}${key}: (.+)`).exec(block)?.[1] ?? '').trim().replace(/^'(.*)'$/, '$1');
  return yaml
    .split(/\n {2}- type: /)
    .slice(1)
    .map((block) => ({
      type: block.slice(0, block.indexOf('\n')).trim(),
      id: value(block, 'id'),
      label: value(block, 'label'),
      placeholder: value(block, 'placeholder'),
      required: value(block, 'required') === 'true',
    }))
    .filter((f) => f.type !== 'markdown');
}

/**
 * What GitHub makes of a submitted issue form: one section per field under its
 * label, the value after a blank line, "_No response_" for an empty optional
 * field. Markdown elements are not part of the body.
 */
function renderIssueBody(fields: FormField[], params: URLSearchParams): string {
  return fields.map((f) => `### ${f.label}\n\n${params.get(f.id) || '_No response_'}`).join('\n\n');
}

const fields = formFields(form);
const muscles = muscleIds(musclesCsv);
const shipped = parseExercises(exercisesCsv, muscles);

/** Each shipped row as the file holds it, by id. */
const shippedLines = new Map(
  exercisesCsv
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('id,'))
    .map((l) => [l.split(',')[0], l]),
);

/** The issue a lifter would file by tapping Submit on the prefilled page. */
function fileIssue(exercise: Exercise, kind: SubmissionKind): string {
  return renderIssueBody(fields, new URL(submissionUrl(exercise, kind)).searchParams);
}

const paused: Exercise = {
  id: 'pause_squat_3ct',
  name: '3-Count Paused Squat',
  base_lift: 'squat',
  tier: 'high_spec',
  unilateral: false,
  load_type: 'external',
  default_unit: 'kg',
  muscles: { primary: ['quads', 'adductors'], aux: ['glutes', 'lower_back'] },
};

describe('the issue form', () => {
  it('has the fields the app fills in', () => {
    expect(fields.map((f) => f.id)).toEqual([
      'kind',
      'id',
      'name',
      'base_lift',
      'tier',
      'unilateral',
      'load_type',
      'default_unit',
      'primary',
      'aux',
    ]);
  });

  it('makes every field a text input, the kind GitHub documents filling in from a URL', () => {
    expect(fields.filter((f) => f.type !== 'input')).toEqual([]);
  });

  it('requires every field but the auxiliary muscles', () => {
    expect(fields.filter((f) => !f.required).map((f) => f.id)).toEqual(['aux']);
  });

  it('suggests muscles that exist', () => {
    for (const id of ['primary', 'aux']) {
      const placeholder = fields.find((f) => f.id === id)!.placeholder;
      expect(placeholder).not.toBe('');
      for (const m of placeholder.split('/')) expect(muscles).toContain(m);
    }
  });

  it('lists every muscle group for a lifter filling it in by hand', () => {
    for (const m of parseMuscles(musclesCsv)) expect(form).toContain(m.id);
  });
});

describe('submissionUrl', () => {
  it("opens the form on the app's repository", () => {
    const url = new URL(submissionUrl(paused, 'new'));
    expect(url.origin + url.pathname).toBe(`https://github.com/${APP_REPO}/issues/new`);
    expect(url.searchParams.get('template')).toBe('new-exercise.yml');
    expect(url.hash).toBe('');
  });

  it('opens it on another repository when asked', () => {
    const url = new URL(submissionUrl(paused, 'new', 'someone/fork'));
    expect(url.origin + url.pathname).toBe('https://github.com/someone/fork/issues/new');
  });

  it('passes one parameter per form field, and no labels', () => {
    const keys = [...new URL(submissionUrl(paused, 'new')).searchParams.keys()];
    expect(keys).toEqual(['template', 'title', ...fields.map((f) => f.id)]);
  });

  it('fills in each field as the form expects it', () => {
    const params = new URL(submissionUrl(paused, 'new')).searchParams;
    expect(Object.fromEntries(params)).toEqual({
      template: 'new-exercise.yml',
      title: 'exercise: 3-Count Paused Squat',
      kind: 'new',
      id: 'pause_squat_3ct',
      name: '3-Count Paused Squat',
      base_lift: 'squat',
      tier: 'high_spec',
      unilateral: 'false',
      load_type: 'external',
      default_unit: 'kg',
      primary: 'quads/adductors',
      aux: 'glutes/lower_back',
    });
  });

  it('titles and marks a change as a change', () => {
    const params = new URL(submissionUrl(paused, 'change')).searchParams;
    expect(params.get('title')).toBe('exercise change: 3-Count Paused Squat');
    expect(params.get('kind')).toBe('change');
  });

  it('spells out no base lift as none, and passes an empty list as an empty field', () => {
    const plank: Exercise = {
      ...paused,
      id: 'plank',
      base_lift: null,
      unilateral: true,
      load_type: 'none',
      default_unit: 'pins',
      muscles: { primary: ['abs'], aux: [] },
    };
    const params = new URL(submissionUrl(plank, 'new')).searchParams;
    expect(params.get('base_lift')).toBe('none');
    expect(params.get('unilateral')).toBe('true');
    expect(params.get('load_type')).toBe('none');
    expect(params.get('default_unit')).toBe('pins');
    expect(params.get('primary')).toBe('abs');
    expect(params.get('aux')).toBe('');
  });

  it.each([
    "Meadow's Row",
    'Press & Hold #2 (50% + 5)',
    'Zercher Squat, Über-Deep', // a comma the workflow will reject, but the link must carry it intact
    'a/b?c=d&e=f#g',
    'Leerzeichen  doppelt',
  ])('carries the name %j through the query string intact', (name) => {
    const url = submissionUrl({ ...paused, name }, 'change');
    const parsed = new URL(url);
    expect(parsed.hash).toBe('');
    expect(parsed.searchParams.get('name')).toBe(name);
    expect(parsed.searchParams.get('title')).toBe(`exercise change: ${name}`);
    // Nothing in a value may be read as a separator.
    expect(url.split('?')[1].split('&')).toHaveLength(fields.length + 2);
  });

  it('percent-encodes reserved characters and writes spaces as +', () => {
    const url = submissionUrl({ ...paused, name: 'A&B #1 + 50%' }, 'new');
    expect(url).toContain('&name=A%26B+%231+%2B+50%25&');
  });
});

describe('from the link to the library row, without GitHub', () => {
  it('turns every shipped exercise back into its own row', () => {
    expect(shipped.length).toBeGreaterThan(50);
    for (const exercise of shipped) {
      const { submission, problems } = readSubmission(fileIssue(exercise, 'change'), muscles);
      expect(problems, exercise.id).toEqual([]);
      expect(submission?.kind).toBe('change');
      expect(submission?.row, exercise.id).toBe(shippedLines.get(exercise.id));
    }
  });

  it.each([
    'pullup',
    'single_leg_press',
    'plank',
    'leg_extension',
    'meadows_row',
    'adductor_machine',
  ])('adds %s back as new after it is taken out', (id) => {
    const exercise = shipped.find((e) => e.id === id)!;
    const without = exercisesCsv
      .split('\n')
      .filter((l) => l !== shippedLines.get(id))
      .join('\n');
    const result = addExercise({
      body: fileIssue(exercise, 'new'),
      exercises: without,
      muscles: musclesCsv,
    });
    if (!result.ok) throw new Error(result.problems.join('\n'));
    expect(result.submission).toEqual({
      kind: 'new',
      id,
      name: exercise.name,
      row: shippedLines.get(id),
    });
    const library = parseExercises(result.exercises, muscles);
    expect(library.find((e) => e.id === id)).toEqual(exercise);
    expect(library).toHaveLength(shipped.length);
  });

  it('proposes a change to a shipped exercise in place', () => {
    const before = shipped.find((e) => e.id === 'lat_pulldown')!;
    const changed: Exercise = {
      ...before,
      name: 'Lat Pulldown (Neutral)',
      muscles: { primary: ['lats'], aux: ['biceps', 'upper_back', 'rear_delts'] },
    };
    const result = addExercise({
      body: fileIssue(changed, 'change'),
      exercises: exercisesCsv,
      muscles: musclesCsv,
    });
    if (!result.ok) throw new Error(result.problems.join('\n'));

    const lines = exercisesCsv.split('\n');
    const after = result.exercises.split('\n');
    const at = lines.indexOf(shippedLines.get('lat_pulldown')!);
    expect(after).toHaveLength(lines.length);
    expect(after[at]).toBe(result.submission.row);
    expect(after.filter((_, i) => i !== at)).toEqual(lines.filter((_, i) => i !== at));
    expect(parseExercises(result.exercises, muscles).find((e) => e.id === 'lat_pulldown')).toEqual(
      changed,
    );
  });

  it('adds a new exercise with an awkward name', () => {
    const exercise: Exercise = {
      ...paused,
      name: "Meadow's Press & Hold #2 (50% + 5)/side",
      base_lift: null,
      unilateral: true,
      load_type: 'bw_plus',
      default_unit: 'lb',
      muscles: { primary: ['pecs'], aux: [] },
    };
    const result = addExercise({
      body: fileIssue(exercise, 'new'),
      exercises: exercisesCsv,
      muscles: musclesCsv,
    });
    if (!result.ok) throw new Error(result.problems.join('\n'));
    expect(result.submission.row).toBe(
      "pause_squat_3ct,Meadow's Press & Hold #2 (50% + 5)/side,,high_spec,true,bw_plus,lb,pecs,",
    );
    expect(parseExercises(result.exercises, muscles).find((e) => e.id === exercise.id)).toEqual(
      exercise,
    );
  });
});
