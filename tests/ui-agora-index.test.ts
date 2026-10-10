import { describe, expect, it } from 'vitest';
import {
  countOf,
  libraryValue,
  OTHER_PLATE,
  persistenceText,
  plateChoice,
  plateOptions,
  settingsSummary,
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
  it('offer the usual choices as strings, then Other', () => {
    expect(plateOptions('kg', 2.5).map((o) => o.value)).toEqual([
      ...PLATE_CHOICES.kg.map(String),
      OTHER_PLATE,
    ]);
    expect(plateOptions('lb', 5).at(-1)).toEqual({ value: OTHER_PLATE, label: 'Other' });
    expect(plateChoice('kg', 2.5)).toBe('2.5');
  });

  it('show a typed increment as Other, pressed', () => {
    expect(plateOptions('kg', 0.5).at(-1)).toEqual({ value: OTHER_PLATE, label: '0.5' });
    expect(plateChoice('kg', 0.5)).toBe(OTHER_PLATE);
  });
});

describe('persistent storage', () => {
  it('says what the browser has agreed to', () => {
    expect(persistenceText(true).granted).toBe(true);
    expect(persistenceText(false)).toMatchObject({ granted: false });
    expect(persistenceText(null).granted).toBe(false);
  });
});
