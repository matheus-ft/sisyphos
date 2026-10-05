import { describe, expect, it, vi } from 'vitest';
import {
  CARD_H,
  CARD_TOP_SETS,
  cardContent,
  cardMetrics,
  cardRows,
  defaultTemplateName,
  groupThousands,
  readTheme,
  rowsFit,
  shareFileName,
  shareImage,
  splitRpe,
  summarise,
  withAlpha,
  type TopRow,
} from '../src/ui/sharecard';
import { byId, ids, library, sessionOn, withSets } from './ui-fixtures';

const squat = byId('low_bar_squat');
const bench = byId('bench');

function lifted() {
  let s = sessionOn(4, 'today');
  s = {
    ...s,
    started_at: '2026-10-04T17:00:00.000Z',
    ended_at: '2026-10-04T17:52:00.000Z',
    time_precision: 'instant',
    label: { name: 'Rebuild', block: null, week: 3, day: 1, weekday: null },
  };
  s = withSets(s, squat, [
    { amount: 140, reps: 5, rpe: 8 },
    { amount: 142.5, reps: 5, rpe: 8.5 },
  ]);
  return withSets(s, bench, [{ amount: 95, reps: 5, rpe: 9 }], ids('b'));
}

describe('summarise', () => {
  it('reports minutes, sets and tonnage, with a record column only when there is a record', () => {
    const s = lifted();
    const plain = summarise(s, library, new Set());
    expect(plain.stats.map((x) => x.label)).toEqual(['MIN', 'SETS', 'KG']);
    expect(plain.stats[0].value).toBe('52');
    expect(plain.stats[1].value).toBe('3');
    expect(plain.stats[2].value).toBe('1,888');

    const squatSet = s.exercises[0].performed[1].id;
    const withRecord = summarise(s, library, new Set([squatSet]));
    expect(withRecord.stats.at(-1)).toEqual({ label: 'RECORD', value: '1', laurel: true });
  });

  it('puts each exercise on one row with its top set, RPE apart, and the laurel on a record', () => {
    const s = lifted();
    const squatSet = s.exercises[0].performed[1].id;
    const { rows } = summarise(s, library, new Set([squatSet]));
    expect(rows).toEqual([
      expect.objectContaining({
        name: squat.name,
        figures: '142.5 × 5',
        rpe: '8.5',
        record: true,
      }),
      expect.objectContaining({ name: bench.name, figures: '95 × 5', rpe: '9', record: false }),
    ]);
  });

  it('leaves out the minutes of a session with no clock time', () => {
    const s = { ...lifted(), time_precision: 'date_only' as const };
    expect(summarise(s, library, new Set()).stats.map((x) => x.label)).toEqual(['SETS', 'KG']);
  });
});

describe('small helpers', () => {
  it('groups thousands with commas', () => {
    expect(groupThousands(8450)).toBe('8,450');
    expect(groupThousands(950)).toBe('950');
    expect(groupThousands(1_234_567)).toBe('1,234,567');
  });

  it('splits a set at its RPE', () => {
    expect(splitRpe('142.5 × 5 @ 8.5')).toEqual({ figures: '142.5 × 5', rpe: '8.5' });
    expect(splitRpe('2:00')).toEqual({ figures: '2:00', rpe: null });
  });

  it('names a template from the label, else the programme, else the day', () => {
    const s = lifted();
    expect(defaultTemplateName(s)).toBe('Rebuild');
    expect(defaultTemplateName({ ...s, label: { ...s.label, name: null } })).toBe('week 3 · day 1');
    expect(
      defaultTemplateName({
        ...s,
        label: { name: null, block: null, week: null, day: null, weekday: null },
      }),
    ).toBe('Sunday 4 October');
  });

  it('names the file by the date', () => {
    expect(shareFileName('2026-10-04')).toBe('sisyphos-2026-10-04.png');
  });
});

describe('the card', () => {
  it('says what goes where', () => {
    const s = lifted();
    const c = cardContent(s, summarise(s, library, new Set()));
    expect(c.date).toBe('SUNDAY 4 OCTOBER 2026');
    expect(c.label).toBe('Rebuild · week 3 · day 1');
    expect(c.title).toEqual(['THE BOULDER', 'IS AT THE TOP.']);
    expect(c.footer).toBe('SISYPHOS');
    expect(c.rows).toHaveLength(2);
  });

  const row = (n: number, record = false): TopRow => ({
    exercise_id: `e${n}`,
    name: `Exercise ${n}`,
    figures: '100 × 5',
    rpe: null,
    record,
  });

  it('keeps at most four top sets, records first, in the session order', () => {
    const six = [1, 2, 3, 4, 5, 6].map((n) => row(n, n === 5));
    expect(cardRows(six).map((r) => r.exercise_id)).toEqual(['e1', 'e2', 'e3', 'e5']);
    expect(cardRows(six.slice(0, 3))).toHaveLength(3);
    expect(CARD_TOP_SETS).toBe(4);
  });

  it('fits the most it can hold between the stats and the foot', () => {
    expect(rowsFit(true, CARD_TOP_SETS)).toBe(true);
    expect(rowsFit(false, CARD_TOP_SETS)).toBe(true);
    const m = cardMetrics(true);
    expect(m.footerBase).toBeLessThan(CARD_H);
    expect(m.sceneTop).toBeGreaterThan(m.labelBase!);
    expect(cardMetrics(false).labelBase).toBeNull();
  });
});

describe('theme', () => {
  it('reads the tokens it draws with', () => {
    const t = readTheme((token) => ` ${token}-value `);
    expect(t.ground).toBe('--ground-value');
    expect(t.laurelFill).toBe('--laurel-fill-value');
    expect(t.ink2).toBe('--ink-2-value');
  });

  it('keeps a colour and drops its alpha', () => {
    expect(withAlpha('rgba(255, 240, 215, 0.38)', 0)).toBe('rgba(255, 240, 215, 0)');
    expect(withAlpha('#e8c29c', 0.5)).toBe('rgba(232, 194, 156, 0.5)');
    expect(withAlpha('#fff', 1)).toBe('rgba(255, 255, 255, 1)');
    expect(withAlpha('hotpink', 0)).toBeNull();
  });
});

describe('shareImage', () => {
  const blob = new Blob(['x'], { type: 'image/png' });

  it('hands the file to the share sheet when the browser can share files', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const outcome = await shareImage(blob, 'a.png', 'Sisyphos', { canShare: () => true, share });
    expect(outcome).toBe('shared');
    expect(share).toHaveBeenCalledWith({
      files: [expect.objectContaining({ name: 'a.png', type: 'image/png' })],
      title: 'Sisyphos',
    });
  });

  it('falls back when files cannot be shared or there is no share at all', async () => {
    expect(await shareImage(blob, 'a.png', 't', { canShare: () => false, share: vi.fn() })).toBe(
      'unsupported',
    );
    expect(await shareImage(blob, 'a.png', 't', {})).toBe('unsupported');
  });

  it('tells a dismissed sheet from a failure', async () => {
    const cancelled = vi.fn().mockRejectedValue(new DOMException('no', 'AbortError'));
    const broken = vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError'));
    expect(await shareImage(blob, 'a', 't', { canShare: () => true, share: cancelled })).toBe(
      'cancelled',
    );
    expect(await shareImage(blob, 'a', 't', { canShare: () => true, share: broken })).toBe(
      'unsupported',
    );
  });
});
