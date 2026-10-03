import { describe, it, expect } from 'vitest';
import { blobSha, sha1Hex } from '../src/storage/hash';

const bytes = (s: string) => new TextEncoder().encode(s);

/**
 * SHA-1 as Node's own crypto computes it, to check the hand-written one against.
 * Under Node the global `crypto` is `node:crypto`'s webcrypto; reached this way
 * it needs no Node type definitions in a program that also type-checks the app.
 */
async function reference(data: Uint8Array<ArrayBuffer> | string): Promise<string> {
  const input = typeof data === 'string' ? bytes(data) : data;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', input));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('sha1Hex', () => {
  it('matches the standard test vectors', () => {
    expect(sha1Hex(bytes(''))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(sha1Hex(bytes('abc'))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
  });

  it('matches node:crypto at every length through several blocks', async () => {
    // Padding is where a hand-written SHA-1 goes wrong, and only at some
    // lengths: 55 bytes still fit the 0x80 byte and the 8-byte length in one
    // block, 56 do not. Lengths 0 to 200 cross that boundary, and the block
    // boundary itself, three times.
    for (let length = 0; length <= 200; length++) {
      const data = new Uint8Array(length).map((_, i) => (i * 31 + length) & 0xff);
      expect(sha1Hex(data), `length ${length}`).toBe(await reference(data));
    }
  });
});

// Every expected value below is `printf '<content>' | git hash-object --stdin`.
describe('blobSha', () => {
  it('hashes the empty file as git does', () => {
    expect(blobSha('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  });

  it('hashes a line of text as git does', () => {
    expect(blobSha('hello world\n')).toBe('3b18e512dba79e4c8300dd08aeb37f8e728b8dad');
  });

  it('hashes a log table as git does', () => {
    expect(blobSha('date,weight_kg,source\n2026-09-14,82.5,manual\n')).toBe(
      'd4ec9d051637ae51b1247887cfcaa365052713b3',
    );
  });

  it('counts UTF-8 bytes, not characters, in the header', () => {
    expect(blobSha('Café — naïve\n')).toBe('9f6b6df2e3dcefb4763871c4dbca41faebf2f888');
  });

  it('handles content spanning several 64-byte blocks', () => {
    expect(blobSha('x'.repeat(200))).toBe('debcf03c10222209e6ac75be3fa2c1796d204d91');
  });

  // The same padding boundaries, reached through the header `blobSha` adds.
  it.each([55, 56, 63, 64, 65])('hashes a blob of %i bytes, header included', async (size) => {
    // The content length that makes `blob <length>\0<content>` exactly `size` bytes.
    let length = 0;
    while (`blob ${length}\0`.length + length < size) length++;
    const content = 'a'.repeat(length);
    const blob = `blob ${length}\0${content}`;
    expect(bytes(blob)).toHaveLength(size);
    expect(blobSha(content)).toBe(await reference(blob));
  });
});
