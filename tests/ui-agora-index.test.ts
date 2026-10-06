import { describe, expect, it } from 'vitest';
import {
  aimAt,
  countOf,
  libraryValue,
  persistenceText,
  plateOptions,
  settingsSummary,
  takeAim,
} from '../src/ui/agoraIndex';
import { DEFAULT_PREFS, PLATE_CHOICES } from '../src/ui/prefs';

describe('the words on the index', () => {
  it('counts with the right plural', () => {
    expect(countOf(1, 'conflict')).toBe('1 conflict');
    expect(countOf(2, 'conflict')).toBe('2 conflicts');
    expect(libraryValue(80)).toBe('80 exercises');
  });

  it('summarises the settings', () => {
    expect(settingsSummary(DEFAULT_PREFS)).toBe('Device not named · plates 2.5 kg, 5 lb');
    expect(settingsSummary({ ...DEFAULT_PREFS, deviceName: 'Phone', plateKg: 1.25 })).toBe(
      'Phone · plates 1.25 kg, 5 lb',
    );
  });
});

describe('plate increments', () => {
  it('offer exactly the choices the preferences accept, as strings', () => {
    expect(plateOptions('kg').map((o) => o.value)).toEqual(PLATE_CHOICES.kg.map(String));
    expect(plateOptions('lb').map((o) => Number(o.value))).toEqual([...PLATE_CHOICES.lb]);
  });
});

describe('persistent storage', () => {
  it('says what the browser has agreed to', () => {
    expect(persistenceText(true).granted).toBe(true);
    expect(persistenceText(false)).toMatchObject({ granted: false });
    expect(persistenceText(null).granted).toBe(false);
  });
});

describe('landing on a section of the lifter page', () => {
  it('is remembered once, for the page that opens next', () => {
    expect(takeAim()).toBeNull();
    aimAt('maxes');
    expect(takeAim()).toBe('maxes');
    expect(takeAim()).toBeNull();
  });
});
