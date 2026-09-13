#!/usr/bin/env node
/**
 * Turns a submitted issue into a row in src/library/exercises.csv.
 *
 * Validates hard and fails loudly: a bad row merged into the shared library is
 * far more expensive than a rejected submission, because every log referencing
 * the id inherits the mistake.
 *
 * Reads the issue body on stdin. Prints the new row on success; prints the
 * problems and exits non-zero otherwise.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CSV = 'src/library/exercises.csv';
const MUSCLES = 'src/library/muscles.csv';

const TIERS = ['comp', 'high_spec', 'low_spec', 'acc'];
const LIFTS = ['squat', 'bench', 'deadlift'];
const LOAD_TYPES = ['external', 'bw_plus', 'none'];
const UNITS = ['kg', 'lb', 'pins'];
const COLUMNS = [
  'id',
  'name',
  'base_lift',
  'tier',
  'unilateral',
  'load_type',
  'default_unit',
  'primary',
  'secondary',
  'aux',
];

/** GitHub issue forms render as "### Label\n\nvalue". Absent optional fields render as "_No response_". */
function parseIssueForm(body) {
  const fields = {};
  const blocks = body.split(/^###\s+/m).slice(1);
  for (const block of blocks) {
    const nl = block.indexOf('\n');
    const label = block.slice(0, nl).trim().toLowerCase();
    const value = block.slice(nl + 1).trim();
    fields[label] = value === '_No response_' ? '' : value;
  }
  return fields;
}

function readCsv(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  const header = lines.find((l) => l.startsWith('id,'));
  const rows = lines.filter((l) => l.trim() && !l.startsWith('#') && l !== header);
  return { lines, header, rows };
}

const body = readFileSync(0, 'utf8');
const f = parseIssueForm(body);
const problems = [];

const get = (...names) => {
  for (const n of names) if (f[n] !== undefined) return f[n].trim();
  return '';
};

const row = {
  id: get('id'),
  name: get('name'),
  base_lift: get('base_lift'),
  tier: get('tier'),
  unilateral: get('unilateral'),
  load_type: get('load_type'),
  default_unit: get('default_unit'),
  primary: get('primary movers', 'primary'),
  secondary: get('secondary movers', 'secondary'),
  aux: get('auxiliary muscles', 'aux'),
};

if (!/^[a-z0-9_]+$/.test(row.id))
  problems.push(`\`id\` must be snake_case letters, digits and underscores — got "${row.id}"`);
if (!row.name) problems.push('`name` is required');
if (row.base_lift === 'none') row.base_lift = '';
if (row.base_lift && !LIFTS.includes(row.base_lift))
  problems.push(`\`base_lift\` must be one of ${LIFTS.join(', ')}, or none`);
if (!TIERS.includes(row.tier)) problems.push(`\`tier\` must be one of ${TIERS.join(', ')}`);
if (!['true', 'false'].includes(row.unilateral))
  problems.push('`unilateral` must be true or false');
if (!LOAD_TYPES.includes(row.load_type))
  problems.push(`\`load_type\` must be one of ${LOAD_TYPES.join(', ')}`);
if (!UNITS.includes(row.default_unit))
  problems.push(`\`default_unit\` must be one of ${UNITS.join(', ')}`);

const { lines, header, rows } = readCsv(CSV);
if (rows.some((r) => r.split(',')[0] === row.id)) {
  problems.push(
    `\`${row.id}\` already exists in the library. Pick a different id, or open a PR editing the existing row.`,
  );
}

const known = new Set(readCsv(MUSCLES).rows.map((r) => r.split(',')[0]));
const list = (cell) =>
  cell
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
for (const role of ['primary', 'secondary', 'aux']) {
  for (const m of list(row[role])) {
    if (!known.has(m))
      problems.push(`\`${role}\` references unknown muscle "${m}" — see src/library/muscles.csv`);
  }
}
if (list(row.primary).length === 0) problems.push('at least one `primary` mover is required');

// Blank cells take their defaults, so only write what differs.
if (row.unilateral === 'false') row.unilateral = '';
if (row.load_type === 'external') row.load_type = '';
if (row.default_unit === 'kg') row.default_unit = '';

if (problems.length) {
  console.error(problems.map((p) => `- ${p}`).join('\n'));
  process.exit(1);
}

const line = COLUMNS.map((c) => row[c]).join(',');
const at = lines.lastIndexOf(rows.at(-1));
lines.splice(at + 1, 0, line);
writeFileSync(CSV, lines.join('\n'));
console.log(line);
