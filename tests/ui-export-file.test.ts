import { describe, expect, it, vi } from 'vitest';
import { deliver, exportFile } from '../src/ui/exportFile';
import { sessionsCsv, setsCsv } from '../src/ui/export';
import { bench, sessionOf } from './analysis-fixtures';

const sessions = [
  sessionOf({ date: '2026-10-02', work: [[bench, [{ load: 90, reps: 5, rpe: 8 }]]] }),
];

describe('the export files', () => {
  it('are the two builders’ output under their literal names', () => {
    expect(exportFile('sets.csv', sessions)).toEqual({ name: 'sets.csv', text: setsCsv(sessions) });
    expect(exportFile('sessions.csv', sessions)).toEqual({
      name: 'sessions.csv',
      text: sessionsCsv(sessions),
    });
  });
});

describe('handing a file over', () => {
  const file = exportFile('sets.csv', sessions);

  it('shares it as a file when the browser can', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const download = vi.fn();
    const result = await deliver(file, { canShare: () => true, share }, download);
    expect(result).toBe('shared');
    expect(share.mock.calls[0][0].files[0].name).toBe('sets.csv');
    expect(download).not.toHaveBeenCalled();
  });

  it('downloads it when sharing files is not possible', async () => {
    const download = vi.fn();
    expect(await deliver(file, { canShare: () => false, share: vi.fn() }, download)).toBe(
      'downloaded',
    );
    expect(await deliver(file, {}, download)).toBe('downloaded');
    expect(download).toHaveBeenCalledTimes(2);
  });

  it('treats a closed share sheet as a change of mind, not a reason to download', async () => {
    const download = vi.fn();
    const share = vi.fn().mockRejectedValue(new DOMException('closed', 'AbortError'));
    expect(await deliver(file, { canShare: () => true, share }, download)).toBe('cancelled');
    expect(download).not.toHaveBeenCalled();
  });

  it('falls back to a download when sharing fails for any other reason', async () => {
    const download = vi.fn();
    const share = vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError'));
    expect(await deliver(file, { canShare: () => true, share }, download)).toBe('downloaded');
    expect(download).toHaveBeenCalledWith(file);
  });
});
