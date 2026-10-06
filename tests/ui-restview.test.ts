import { describe, expect, it } from 'vitest';
import {
  BELL_WINDOW_MS,
  bellAt,
  bellStep,
  clockText,
  figureParts,
  restFace,
  type BellState,
} from '../src/ui/restview';

const T0 = 1_000_000;

describe('clockText', () => {
  it('writes minutes and seconds, and hours only when there are some', () => {
    expect(clockText(73)).toBe('1:13');
    expect(clockText(0)).toBe('0:00');
    expect(clockText(180)).toBe('3:00');
    expect(clockText(3725)).toBe('1:02:05');
    expect(clockText(-4)).toBe('0:00');
  });
});

describe('restFace', () => {
  it('counts down to the target and fills the band', () => {
    const face = restFace(T0, 180, T0 + 107_000);
    expect(face).toMatchObject({
      over: false,
      label: 'Rest',
      clock: '1:13',
      plus: false,
      of: 'of 3:00',
      long: false,
    });
    expect(face.fraction).toBeCloseTo(107 / 180);
    expect(face.spoken).toBe('1 minute 13 seconds left');
  });

  it('turns over at zero and counts up with a plus', () => {
    expect(restFace(T0, 180, T0 + 180_000)).toMatchObject({
      over: true,
      label: 'Rest over',
      clock: '0:00',
      plus: true,
      fraction: 1,
    });
    const face = restFace(T0, 180, T0 + 192_500);
    expect(face).toMatchObject({ clock: '0:12', plus: true, of: 'of 3:00' });
    expect(face.spoken).toBe('12 seconds over');
  });

  it('counts up with no band and no target when none is set', () => {
    expect(restFace(T0, null, T0 + 65_900)).toMatchObject({
      over: false,
      clock: '1:05',
      of: null,
      fraction: null,
      plus: false,
    });
  });

  it('steps the clock down a size from five characters', () => {
    expect(restFace(T0, 600, T0).long).toBe(true);
    expect(restFace(T0, 180, T0).long).toBe(false);
  });

  it('shows the right time on waking after a long suspension', () => {
    expect(restFace(T0, 120, T0 + 600_000)).toMatchObject({ clock: '8:00', over: true });
  });
});

describe('bellStep', () => {
  const over = { over: true };
  const under = { over: false };

  it('rings once as the count crosses zero while the app is visible and the chime is on', () => {
    const first = bellStep({ rung: false }, over, 100, true, true);
    expect(first.ring).toBe(true);
    expect(bellStep(first.state, over, 350, true, true).ring).toBe(false);
  });

  it('does not ring with the chime off, but still counts the crossing', () => {
    const step = bellStep({ rung: false }, over, 100, true, false);
    expect(step.ring).toBe(false);
    expect(step.state.rung).toBe(true);
  });

  it('does not ring for a rest found already over, or one seen late, or one hidden', () => {
    expect(bellStep({ rung: false }, over, BELL_WINDOW_MS + 1, true, true).ring).toBe(false);
    expect(bellStep({ rung: false }, over, 100, false, true).ring).toBe(false);
  });

  it('rings again after +15 s moves the target out and the count crosses once more', () => {
    const rung = bellStep({ rung: false }, over, 100, true, true).state;
    const moved = bellStep(rung, under, 0, true, true).state;
    expect(moved.rung).toBe(false);
    expect(bellStep(moved, over, 200, true, true).ring).toBe(true);
  });
});

describe('bellAt', () => {
  const rest = { startedAt: 1_000_000, targetS: 120 };
  const zero = rest.startedAt + rest.targetS * 1000;
  /** The screen polling every 250 ms from `from` to `to`, counting the rings. */
  const poll = (from: number, to: number, state: BellState = { rung: false }) => {
    let rings = 0;
    for (let now = from; now <= to; now += 250) {
      const step = bellAt(state, rest, now, true, true);
      state = step.state;
      if (step.ring) rings++;
    }
    return { rings, state };
  };

  it('rings once at zero for a rest followed from its start, whatever screen is up', () => {
    expect(poll(rest.startedAt, zero + 30_000).rings).toBe(1);
  });

  it('rings at zero for a rest picked up again after a reload, before its zero', () => {
    expect(poll(zero - 20_000, zero + 5_000).rings).toBe(1);
  });

  it('stays silent for a rest picked up again past its zero', () => {
    expect(poll(zero + 20_000, zero + 40_000).rings).toBe(0);
  });
});

describe('figureParts', () => {
  it('sets the × and @ apart', () => {
    expect(figureParts('92.5 × 5 @ 8')).toEqual([
      { text: '92.5 ', muted: false },
      { text: '×', muted: true },
      { text: ' 5 ', muted: false },
      { text: '@', muted: true },
      { text: ' 8', muted: false },
    ]);
    expect(figureParts('60')).toEqual([{ text: '60', muted: false }]);
  });
});
