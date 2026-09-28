/**
 * What scripts/add-exercise.mjs does, on text instead of files, so the tests can
 * run it without a checkout, a process or GitHub.
 *
 * Plain JavaScript with JSDoc types: the submission workflow runs it with bare
 * Node before anything is installed, and the tests import it as it is.
 *
 * Validates hard and fails loudly: a bad row merged into the shared library is
 * far more expensive than a rejected submission, because every log referencing
 * the id inherits the mistake.
 */

/** The shipped columns of src/library/exercises.csv, in order (as in src/storage/formats.ts). */
export const COLUMNS = [
  'id',
  'name',
  'base_lift',
  'tier',
  'unilateral',
  'load_type',
  'default_unit',
  'primary',
  'aux',
];

const LIFTS = ['squat', 'bench', 'deadlift'];
const TIERS = ['comp', 'high_spec', 'low_spec', 'acc'];
const LOAD_TYPES = ['external', 'bw_plus', 'none'];
const UNITS = ['kg', 'lb', 'pins'];

/**
 * The fields of .github/ISSUE_TEMPLATE/new-exercise.yml, by label. The issue
 * body GitHub renders carries each field's label, not its id, so this has to
 * change whenever a label does; the end-to-end test fails if it does not.
 * @type {Record<string, string>}
 */
const FIELD_BY_LABEL = {
  kind: 'kind',
  id: 'id',
  name: 'name',
  base_lift: 'base_lift',
  tier: 'tier',
  unilateral: 'unilateral',
  load_type: 'load_type',
  default_unit: 'default_unit',
  'primary movers': 'primary',
  'auxiliary muscles': 'aux',
};

/**
 * @typedef {object} Submission
 * @property {'new' | 'change'} kind
 * @property {string} id
 * @property {string} name
 * @property {string} row The row as it goes into the library, without a newline.
 */

/**
 * @typedef {{ ok: true, submission: Submission, exercises: string }
 *   | { ok: false, problems: string[] }} Result
 */

/**
 * GitHub renders an issue form as one "### <label>" section per field, the
 * value after a blank line, and "_No response_" for an optional field left
 * empty. Bodies typed on the web arrive with CRLF line endings.
 * @param {string} body
 * @returns {Record<string, string>} values by lowercased label
 */
export function parseIssueForm(body) {
  /** @type {Record<string, string>} */
  const fields = {};
  const blocks = body
    .replace(/\r\n?/g, '\n')
    .split(/^###[ \t]+/m)
    .slice(1);
  for (const block of blocks) {
    const nl = block.indexOf('\n');
    const label = (nl === -1 ? block : block.slice(0, nl)).trim().toLowerCase();
    const value = nl === -1 ? '' : block.slice(nl + 1).trim();
    fields[label] = value === '_No response_' ? '' : value;
  }
  return fields;
}

/**
 * A value quoted for a message, so a stray newline or backtick shows as what it
 * is, inside a code span. The messages become a comment the bot posts on the
 * issue, and outside code GitHub makes `@name` a mention, notifying whoever
 * that is on the bot's behalf, and `#12` a link to issue 12. The span's fence
 * is one backtick longer than any run of backticks in the value, so the value
 * cannot close it.
 * @param {string} value
 */
const shown = (value) => {
  const quoted = JSON.stringify(value);
  const longest = Math.max(0, ...(quoted.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${quoted}${fence}`;
};

/** @param {string} cell */
const list = (cell) =>
  cell
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Whether the app's CSV writer would have to quote this cell (docs/STORAGE.md
 * 1.4). The shipped library holds no quoted cells and is read by splitting on
 * commas and newlines, so such a value would corrupt the row, or the file,
 * rather than be stored. Whitespace at either end, one of the rule's other
 * cases, is trimmed off every value before it gets here; a leading #, the last,
 * is refused with every other # by `githubReads`.
 * @param {string} cell
 */
const needsQuoting = (cell) => /[,"\r\n]/.test(cell);

/**
 * Whether GitHub would read something in this cell as a reference, anywhere in
 * it. The row goes into the commit message and the pull request, and the name
 * into the pull request's title. There `#12` links issue 12, and "Fixes #12" in
 * the merged commit closes it; `@name` mentions someone, notifying them on the
 * bot's behalf. Neither character is worth that in a library row, so both are
 * refused, and the submitter is told why.
 * @param {string} cell
 */
const githubReads = (cell) => /[#@]/.test(cell);

/**
 * Reads the submitted row and checks everything that does not depend on which
 * rows the library holds now. The submission is null when its kind or id is
 * invalid, since then there is no telling where in the library it would go.
 * @param {string} body the issue body
 * @param {Set<string>} muscles the muscle ids in src/library/muscles.csv
 * @returns {{ submission: Submission | null, problems: string[] }}
 */
export function readSubmission(body, muscles) {
  const byLabel = parseIssueForm(body);
  /** @type {Record<string, string>} */
  const f = {};
  for (const [label, value] of Object.entries(byLabel)) {
    const field = FIELD_BY_LABEL[label];
    if (field) f[field] = value;
  }
  const get = (/** @type {string} */ field) => (f[field] ?? '').trim();
  const problems = [];

  const kind = get('kind');
  const kindOk = kind === 'new' || kind === 'change';
  if (!kindOk) problems.push(`\`kind\` must be new or change, got ${shown(kind)}`);

  /** @type {Record<string, string>} */
  const cells = {
    id: get('id'),
    name: get('name'),
    base_lift: get('base_lift'),
    tier: get('tier'),
    unilateral: get('unilateral'),
    load_type: get('load_type'),
    default_unit: get('default_unit'),
    primary: get('primary'),
    aux: get('aux'),
  };

  // Checked first and for every cell, whatever else is checked below: whatever
  // reaches the file must not be able to change its shape, and whatever reaches
  // GitHub must not be able to act there.
  for (const column of COLUMNS) {
    if (needsQuoting(cells[column])) {
      problems.push(
        `\`${column}\` cannot contain commas, double quotes or line breaks, got ${shown(cells[column])}`,
      );
    }
    if (githubReads(cells[column])) {
      problems.push(
        `\`${column}\` cannot contain \`#\` or \`@\`, which GitHub would read in the pull request as a link to an issue (\`#12\`, closing it after a word like "Fixes") or a mention of someone (\`@name\`), got ${shown(cells[column])}`,
      );
    }
  }

  const idOk = /^[a-z0-9_]+$/.test(cells.id);
  if (!idOk) {
    problems.push(
      `\`id\` must be snake_case: lowercase letters, digits and underscores, got ${shown(cells.id)}`,
    );
  }
  if (!cells.name) problems.push('`name` is required');
  // Blank is how the library says an exercise serves no competition event.
  if (cells.base_lift === 'none') cells.base_lift = '';
  if (cells.base_lift && !LIFTS.includes(cells.base_lift)) {
    problems.push(
      `\`base_lift\` must be one of ${LIFTS.join(', ')}, or none, got ${shown(cells.base_lift)}`,
    );
  }
  if (!TIERS.includes(cells.tier)) {
    problems.push(`\`tier\` must be one of ${TIERS.join(', ')}, got ${shown(cells.tier)}`);
  }
  if (!['true', 'false'].includes(cells.unilateral)) {
    problems.push(`\`unilateral\` must be true or false, got ${shown(cells.unilateral)}`);
  }
  if (!LOAD_TYPES.includes(cells.load_type)) {
    problems.push(
      `\`load_type\` must be one of ${LOAD_TYPES.join(', ')}, got ${shown(cells.load_type)}`,
    );
  }
  if (!UNITS.includes(cells.default_unit)) {
    problems.push(
      `\`default_unit\` must be one of ${UNITS.join(', ')}, got ${shown(cells.default_unit)}`,
    );
  }

  // A muscle listed twice would be credited twice, silently.
  const seen = new Set();
  for (const role of ['primary', 'aux']) {
    const ids = list(cells[role]);
    for (const m of ids) {
      if (!muscles.has(m)) {
        problems.push(
          `\`${role}\` references unknown muscle ${shown(m)}; see src/library/muscles.csv`,
        );
      } else if (seen.has(m)) {
        problems.push(`\`${m}\` is listed more than once across \`primary\` and \`aux\``);
      }
      seen.add(m);
    }
    cells[role] = ids.join('/');
  }
  if (!cells.primary) problems.push('at least one `primary` mover is required');

  // Blank cells take their defaults, so only what differs is written, as in
  // every row already shipped.
  if (cells.unilateral === 'false') cells.unilateral = '';
  if (cells.load_type === 'external') cells.load_type = '';
  if (cells.default_unit === 'kg') cells.default_unit = '';

  const row = COLUMNS.map((c) => cells[c]).join(',');
  return {
    submission: kindOk && idOk ? { kind, id: cells.id, name: cells.name, row } : null,
    problems,
  };
}

/**
 * The lines of a library CSV, its header, and its rows with their positions.
 * Comments and blank lines are kept in `lines` so writing it back changes only
 * the row concerned.
 * @param {string} text
 */
function readLines(text) {
  const lines = text.split('\n');
  const content = lines
    .map((line, index) => ({ index, text: line.trim() }))
    .filter((l) => l.text && !l.text.startsWith('#'));
  const [header, ...rows] = content;
  return {
    lines,
    header: header ?? { index: -1, text: '' },
    rows: rows.map((r) => ({ ...r, cells: r.text.split(',').map((c) => c.trim()) })),
  };
}

/** @param {string} text the contents of src/library/muscles.csv */
export function muscleIds(text) {
  return new Set(readLines(text).rows.map((r) => r.cells[0]));
}

/**
 * Puts a submission into the library: a new row after the last one, or a
 * change in place of the row with its id, so the diff a reviewer reads is that
 * one line.
 * @param {string} exercises the contents of src/library/exercises.csv
 * @param {Submission} submission
 * @returns {{ exercises: string, problems: string[] }}
 */
export function applySubmission(exercises, submission) {
  const { lines, header, rows } = readLines(exercises);
  if (header.text !== COLUMNS.join(',')) {
    return {
      exercises,
      problems: [`src/library/exercises.csv should start with the header ${COLUMNS.join(',')}`],
    };
  }

  const at = rows.find((r) => r.cells[0] === submission.id);
  if (submission.kind === 'new') {
    if (at) {
      return {
        exercises,
        problems: [
          `\`${submission.id}\` is already in the library. Pick a different id, or submit this as a change to it.`,
        ],
      };
    }
    const after = rows.length ? rows[rows.length - 1].index : header.index;
    const out = [...lines];
    out.splice(after + 1, 0, submission.row);
    return { exercises: out.join('\n'), problems: [] };
  }

  if (!at) {
    return {
      exercises,
      problems: [
        `\`${submission.id}\` is not in the library, so there is nothing to change. Submit it as new to add it.`,
      ],
    };
  }
  // A missing trailing cell reads as blank, so compare cell by cell.
  const cells = submission.row.split(',');
  if (cells.every((c, i) => c === (at.cells[i] ?? ''))) {
    return {
      exercises,
      problems: [
        `\`${submission.id}\` already reads exactly like this in the library, so there is nothing to change.`,
      ],
    };
  }
  const out = [...lines];
  out[at.index] = submission.row;
  return { exercises: out.join('\n'), problems: [] };
}

/**
 * The whole check: every problem with the submission at once, so the submitter
 * can fix them all in one edit.
 * @param {{ body: string, exercises: string, muscles: string }} input the issue
 *   body and the contents of the two library files
 * @returns {Result}
 */
export function addExercise({ body, exercises, muscles }) {
  const { submission, problems } = readSubmission(body, muscleIds(muscles));
  if (!submission) return { ok: false, problems };
  const applied = applySubmission(exercises, submission);
  const all = [...problems, ...applied.problems];
  if (all.length) return { ok: false, problems: all };
  return { ok: true, submission, exercises: applied.exercises };
}
