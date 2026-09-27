import { describe, it, expect } from 'vitest';
import { blobSha, sha1Hex } from '../src/storage/hash';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('sha1Hex', () => {
  it('matches the standard test vectors', () => {
    expect(sha1Hex(bytes(''))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(sha1Hex(bytes('abc'))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
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
});
