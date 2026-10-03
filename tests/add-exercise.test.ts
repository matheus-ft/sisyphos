import { describe, it, expect } from 'vitest';
import {
  addExercise,
  applySubmission,
  parseIssueForm,
  type Submission,
} from '../scripts/add-exercise-core.mjs';
import workflow from '../.github/workflows/exercise-submission.yml?raw';
import musclesCsv from '../src/library/muscles.csv?raw';

const LIBRARY = `# A library in the shipped file's shape.
id,name,base_lift,tier,unilateral,load_type,default_unit,primary,aux

# --- squat ---
low_bar_squat,Low-Bar Squat,squat,comp,,,,quads/adductors,glutes/lower_back
paused_squat,Paused Squat,squat,high_spec,,,,quads/adductors,glutes/lower_back

# --- trunk ---
plank,Plank,,acc,,none,,abs,front_delts
`;

/** Form labels, as GitHub renders them, to the value of a valid new exercise. */
const VALID: Record<string, string> = {
  kind: 'new',
  id: 'pin_squat',
  name: 'Pin Squat',
  base_lift: 'squat',
  tier: 'high_spec',
  unilateral: 'false',
  load_type: 'external',
  default_unit: 'kg',
  'primary movers': 'quads/adductors',
  'auxiliary muscles': 'glutes/lower_back',
};

/** An issue body as GitHub renders the form, with some fields overridden. */
function body(over: Record<string, string> = {}): string {
  return Object.entries({ ...VALID, ...over })
    .map(([label, value]) => `### ${label}\n\n${value || '_No response_'}`)
    .join('\n\n');
}

function run(over: Record<string, string> = {}, exercises = LIBRARY) {
  return addExercise({ body: body(over), exercises, muscles: musclesCsv });
}

function problems(over: Record<string, string>, exercises = LIBRARY): string[] {
  const result = run(over, exercises);
  if (result.ok) throw new Error(`accepted: ${result.submission.row}`);
  return result.problems;
}

function accepted(over: Record<string, string> = {}, exercises = LIBRARY) {
  const result = run(over, exercises);
  if (!result.ok) throw new Error(result.problems.join('\n'));
  return result;
}

describe('reading the issue body', () => {
  it('reads each section under its label, and _No response_ as empty', () => {
    expect(parseIssueForm('### id\n\nx_y\n\n### Auxiliary Muscles\n\n_No response_\n')).toEqual({
      id: 'x_y',
      'auxiliary muscles': '',
    });
  });

  it('reads a body typed on the web, with CRLF line endings', () => {
    const { submission } = accepted({}, LIBRARY);
    const crlf = addExercise({
      body: body().replace(/\n/g, '\r\n'),
      exercises: LIBRARY,
      muscles: musclesCsv,
    });
    expect(crlf.ok && crlf.submission).toEqual(submission);
  });

  it('ignores sections the form does not have', () => {
    expect(accepted({ 'something else': 'x,"y"' }).submission.id).toBe('pin_squat');
  });
});

describe('a new exercise', () => {
  it('goes after the last row, leaving everything else as it was', () => {
    const { submission, exercises } = accepted();
    expect(submission).toEqual({
      kind: 'new',
      id: 'pin_squat',
      name: 'Pin Squat',
      row: 'pin_squat,Pin Squat,squat,high_spec,,,,quads/adductors,glutes/lower_back',
    });
    const lines = LIBRARY.split('\n');
    const at = lines.indexOf('plank,Plank,,acc,,none,,abs,front_delts') + 1;
    expect(exercises.split('\n')).toEqual([
      ...lines.slice(0, at),
      submission.row,
      ...lines.slice(at),
    ]);
    expect(exercises.endsWith('front_delts\n' + submission.row + '\n')).toBe(true);
  });

  it('goes after the header in a library with no rows', () => {
    const empty = 'id,name,base_lift,tier,unilateral,load_type,default_unit,primary,aux\n';
    expect(accepted({}, empty).exercises).toBe(
      empty + 'pin_squat,Pin Squat,squat,high_spec,,,,quads/adductors,glutes/lower_back\n',
    );
  });

  it('leaves default values blank and writes the rest', () => {
    expect(
      accepted({
        base_lift: 'none',
        unilateral: 'true',
        load_type: 'bw_plus',
        default_unit: 'pins',
        'auxiliary muscles': '',
      }).submission.row,
    ).toBe('pin_squat,Pin Squat,,high_spec,true,bw_plus,pins,quads/adductors,');
  });

  it('tidies the spacing of values and muscle lists', () => {
    expect(
      accepted({ name: '  Pin Squat ', 'primary movers': ' quads / adductors/ ' }).submission.row,
    ).toBe('pin_squat,Pin Squat,squat,high_spec,,,,quads/adductors,glutes/lower_back');
  });

  it('is refused when the id is already in the library', () => {
    expect(problems({ id: 'paused_squat' })).toEqual([
      '`paused_squat` is already in the library. Pick a different id, or submit this as a change to it.',
    ]);
  });
});

describe('a change', () => {
  it('replaces the row with its id where it stands', () => {
    const { submission, exercises } = accepted({
      kind: 'change',
      id: 'paused_squat',
      name: 'Paused Squat (2 count)',
    });
    expect(submission.kind).toBe('change');
    const before = LIBRARY.split('\n');
    const after = exercises.split('\n');
    const at = before.indexOf(
      'paused_squat,Paused Squat,squat,high_spec,,,,quads/adductors,glutes/lower_back',
    );
    expect(after).toHaveLength(before.length);
    expect(after[at]).toBe(
      'paused_squat,Paused Squat (2 count),squat,high_spec,,,,quads/adductors,glutes/lower_back',
    );
    expect(after.filter((_, i) => i !== at)).toEqual(before.filter((_, i) => i !== at));
  });

  it('can change the first and the last row', () => {
    for (const id of ['low_bar_squat', 'plank']) {
      const after = accepted({ kind: 'change', id }).exercises.split('\n');
      const before = LIBRARY.split('\n');
      expect(after).toHaveLength(before.length);
      expect(after.filter((l) => l.startsWith(`${id},`))).toHaveLength(1);
    }
  });

  it('is refused when the id is not in the library', () => {
    expect(problems({ kind: 'change' })).toEqual([
      '`pin_squat` is not in the library, so there is nothing to change. Submit it as new to add it.',
    ]);
  });

  it('is refused when it changes nothing', () => {
    expect(
      problems({
        kind: 'change',
        id: 'plank',
        name: 'Plank',
        base_lift: 'none',
        tier: 'acc',
        load_type: 'none',
        'primary movers': 'abs',
        'auxiliary muscles': 'front_delts',
      }),
    ).toEqual([
      '`plank` already reads exactly like this in the library, so there is nothing to change.',
    ]);
  });

  it('does not match an id by its prefix', () => {
    expect(problems({ kind: 'change', id: 'paused' })[0]).toMatch(/not in the library/);
  });
});

describe('validation', () => {
  it.each<[string, Record<string, string>, RegExp]>([
    ['no kind', { kind: '' }, /^`kind` must be new or change, got `""`$/],
    ['an unknown kind', { kind: 'edit' }, /^`kind` must be new or change/],
    ['no id', { id: '' }, /^`id` must be snake_case/],
    ['an id with capitals', { id: 'Pin_Squat' }, /^`id` must be snake_case.*got `"Pin_Squat"`$/],
    ['an id with a hyphen', { id: 'pin-squat' }, /^`id` must be snake_case/],
    ['an id with a space', { id: 'pin squat' }, /^`id` must be snake_case/],
    ['no name', { name: '' }, /^`name` is required$/],
    ['a comma in the name', { name: 'Squat, Pin' }, /^`name` cannot contain commas/],
    ['a quote in the name', { name: 'The "Pin" Squat' }, /^`name` cannot contain commas/],
    [
      'a newline in the name',
      { name: 'Pin\nSquat' },
      /^`name` cannot contain.*got `"Pin\\nSquat"`$/,
    ],
    ['a carriage return in the name', { name: 'Pin\rSquat' }, /^`name` cannot contain/],
    ['a name starting with #', { name: '#1 Squat' }, /^`name` cannot contain `#` or `@`/],
    ['a closing keyword in the name', { name: 'Fixes #12' }, /^`name` cannot contain `#` or `@`/],
    ['a mention in the name', { name: 'Squat for @octocat' }, /^`name` cannot contain `#` or `@`/],
    ['an @ in the name', { name: 'Squat @ 80%' }, /^`name` cannot contain `#` or `@`/],
    ['an unknown base lift', { base_lift: 'press' }, /^`base_lift` must be one of squat/],
    ['an unknown tier', { tier: 'comp_ish' }, /^`tier` must be one of comp, high_spec/],
    ['no tier', { tier: '' }, /^`tier` must be one of/],
    ['a unilateral that is not a boolean', { unilateral: 'yes' }, /^`unilateral` must be true/],
    ['an unknown load type', { load_type: 'bodyweight' }, /^`load_type` must be one of/],
    ['an unknown unit', { default_unit: 'stone' }, /^`default_unit` must be one of kg, lb/],
    ['no primary mover', { 'primary movers': '' }, /^at least one `primary` mover/],
    ['only separators as primary movers', { 'primary movers': '/ /' }, /^at least one `primary`/],
    [
      'an unknown primary muscle',
      { 'primary movers': 'quads/delts' },
      /^`primary` references unknown muscle `"delts"`/,
    ],
    [
      'an unknown auxiliary muscle',
      { 'auxiliary muscles': 'glutes/core' },
      /^`aux` references unknown muscle `"core"`/,
    ],
    [
      'a muscle listed twice',
      { 'primary movers': 'quads/quads' },
      /^`quads` is listed more than once/,
    ],
    [
      'a muscle both primary and auxiliary',
      { 'auxiliary muscles': 'quads' },
      /^`quads` is listed more than once/,
    ],
  ])('rejects %s', (_, over, message) => {
    const found = problems(over);
    expect(
      found.some((p) => message.test(p)),
      found.join('\n'),
    ).toBe(true);
  });

  it('rejects a comma in any cell, whatever else is wrong with it', () => {
    // Every field but the kind, which says where the row goes and is not in it.
    for (const label of Object.keys(VALID).filter((l) => l !== 'kind')) {
      const found = problems({ [label]: 'a,b' });
      expect(found.join('\n'), label).toMatch(/cannot contain commas/);
    }
  });

  it('rejects # and @ anywhere in any cell, whatever else is wrong with it', () => {
    // In the commit and the pull request, "#12" links an issue ("Fixes #12"
    // closes it on merge) and "@name" mentions someone.
    for (const label of Object.keys(VALID).filter((l) => l !== 'kind')) {
      for (const value of ['a#b', 'Fixes #12', 'a@b', '@octocat']) {
        const found = problems({ [label]: value });
        expect(found.join('\n'), `${label}: ${value}`).toMatch(/cannot contain `#` or `@`/);
      }
    }
  });

  it('echoes no mention or issue link into the comment that lists the problems', () => {
    // Each problem becomes a line of the bot's comment on the issue, where
    // GitHub reads # and @ everywhere but inside code.
    const found = problems({
      kind: '@octocat',
      id: '@octocat',
      name: 'Fixes #12 for @octocat',
      tier: '#1',
      'primary movers': 'quads/@octocat',
      'auxiliary muscles': 'glutes/`@octo`cat``',
    });
    expect(found.length).toBeGreaterThan(4);
    for (const problem of found) {
      const outsideCode = problem.replace(/(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, '');
      expect(outsideCode, problem).not.toMatch(/[#@]/);
    }
  });

  it('reports every problem at once', () => {
    expect(
      problems({ name: '', tier: 'x', 'primary movers': 'nope', 'auxiliary muscles': 'core' }),
    ).toHaveLength(4);
  });

  it('checks the library only once the kind and id are valid', () => {
    expect(problems({ kind: 'maybe', id: 'paused_squat' })).toEqual([
      '`kind` must be new or change, got `"maybe"`',
    ]);
  });

  it('refuses a library whose header is not the shipped one', () => {
    const odd = LIBRARY.replace('primary,aux', 'primary,secondary,aux');
    expect(problems({}, odd)[0]).toMatch(/should start with the header/);
  });

  it('reads a shipped row missing its trailing blank cells as the same row', () => {
    const short = LIBRARY.replace(
      'plank,Plank,,acc,,none,,abs,front_delts',
      'plank,Plank,,acc,,none,,abs',
    );
    const submission: Submission = {
      kind: 'change',
      id: 'plank',
      name: 'Plank',
      row: 'plank,Plank,,acc,,none,,abs,',
    };
    expect(applySubmission(short, submission).problems).toEqual([
      '`plank` already reads exactly like this in the library, so there is nothing to change.',
    ]);
  });
});

/**
 * The script of every step's `run:`: a block scalar's lines, or the rest of the
 * line. `run:` holding a mapping (under `defaults:`) is not a script.
 */
function runScripts(yaml: string): string[] {
  const lines = yaml.split('\n');
  const scripts: string[] = [];
  lines.forEach((line, i) => {
    const m = /^( *)(?:- )?run:[ \t]*(.*)$/.exec(line);
    if (!m || m[2] === '') return;
    if (!/^[|>]/.test(m[2])) {
      scripts.push(m[2]);
      return;
    }
    const indent = m[1].length;
    const script: string[] = [];
    for (const next of lines.slice(i + 1)) {
      if (next.trim() && next.length - next.trimStart().length <= indent) break;
      script.push(next);
    }
    scripts.push(script.join('\n'));
  });
  return scripts;
}

describe('the submission workflow', () => {
  const scripts = runScripts(workflow);

  it('has its scripts found by this test', () => {
    expect(scripts.length).toBeGreaterThanOrEqual(5);
    expect(scripts.join('\n')).toContain('node scripts/add-exercise.mjs');
  });

  it('never expands an expression inside a script', () => {
    // The runner pastes ${{ }} into the script before bash reads it, so any
    // issue text there is code. It must arrive through env: instead.
    for (const script of scripts) {
      expect(script).not.toContain('${{ github.event.issue');
      expect(script).not.toContain('${{ steps.');
      expect(script).not.toContain('${{');
    }
  });

  it('would catch one', () => {
    const bad = [
      'steps:',
      '  - run: |',
      '      gh pr create --title "Add exercise: ${{ github.event.issue.title }}"',
      '  - run: echo "${{ steps.add.outputs.row }}"',
    ].join('\n');
    expect(runScripts(bad).filter((s) => s.includes('${{'))).toHaveLength(2);
  });

  it('writes nothing but literals to $GITHUB_OUTPUT', () => {
    // A variable written there could carry a newline or a heredoc delimiter,
    // and with it outputs of its own. Today nothing is written at all.
    const writes = scripts
      .flatMap((s) => s.split('\n'))
      .filter((l) => l.includes('GITHUB_OUTPUT') || l.includes('GITHUB_ENV'));
    for (const line of writes) {
      expect(line).toMatch(/^\s*echo "[a-z_]+=[a-z_]+" >>"\$GITHUB_OUTPUT"$/);
    }
  });

  it('keeps write access away from the job that runs npm packages', () => {
    const jobs = workflow.split('\njobs:\n')[1].split(/\n(?= {2}[a-z_-]+:\n)/);
    const npm = jobs.filter((job) => job.includes('npm ci'));
    expect(npm).toHaveLength(1);
    expect(npm[0]).not.toMatch(/: write/);
    expect(npm[0]).not.toContain('github.token');
    expect(npm[0]).toContain('persist-credentials: false');
    expect(workflow).toMatch(/\npermissions: \{\}\n/);
  });
});
