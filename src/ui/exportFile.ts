import type { Meet, Session } from '../model';
import { attemptsCsv, meetsCsv, setsCsv, sessionsCsv } from './export';

/**
 * Getting the four export files off the phone: the share sheet where the
 * browser can share files (the lifter picks Files, Mail, a notebook app), else
 * a download link. The text is built before the tap's handler awaits anything,
 * because iOS lets a page share only from within a tap.
 */

export interface ExportFile {
  name: 'sets.csv' | 'sessions.csv' | 'meets.csv' | 'attempts.csv';
  text: string;
}

/** What the files are made from. */
export interface ExportData {
  sessions: readonly Session[];
  meets: readonly Meet[];
}

export function exportFile(name: ExportFile['name'], data: ExportData): ExportFile {
  switch (name) {
    case 'sets.csv':
      return { name, text: setsCsv(data.sessions) };
    case 'sessions.csv':
      return { name, text: sessionsCsv(data.sessions) };
    case 'meets.csv':
      return { name, text: meetsCsv(data.meets) };
    case 'attempts.csv':
      return { name, text: attemptsCsv(data.meets) };
  }
}

export type Delivery = 'shared' | 'downloaded' | 'cancelled';

interface Sharer {
  canShare?(data: { files: File[] }): boolean;
  share?(data: { files: File[] }): Promise<void>;
}

/**
 * Hands the file over. A lifter who closes the share sheet has changed their
 * mind, not hit an error, so that is `cancelled` and nothing falls back to a
 * download they did not ask for. Any other refusal does fall back.
 */
export async function deliver(
  file: ExportFile,
  nav: Sharer = navigator,
  download: (file: ExportFile) => void = downloadLink,
): Promise<Delivery> {
  const blob = new File([file.text], file.name, { type: 'text/csv' });
  if (nav.share && nav.canShare?.({ files: [blob] })) {
    try {
      await nav.share({ files: [blob] });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    }
  }
  download(file);
  return 'downloaded';
}

function downloadLink(file: ExportFile): void {
  const url = URL.createObjectURL(new Blob([file.text], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  // After the click has been handled; revoking at once can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
