import { describe, it, expect } from 'vitest';
import { MemoryRemote } from '../src/storage/remote/memory';
import { SyncError } from '../src/storage/errors';
import { blobSha } from '../src/storage/hash';

const MARKER = '{\n  "format": 1\n}\n';
const SESSION = '{\n  "notes": "Agachamento — pés afastados, 5×5 🏋️ 日本語"\n}\n';

/** Commits `changes` on the head through the Remote operations, as a device would, and moves the branch. */
async function push(remote: MemoryRemote, changes: { path: string; content: string | null }[]) {
  const head = (await remote.head())!;
  const { sha } = await remote.tree(head);
  const next = await remote.commit({ parent: head, baseTree: sha, changes, message: 'Sync' });
  expect(await remote.moveBranch(head, next.commit)).toBe('moved');
  return next;
}

async function repoError(promise: Promise<unknown>): Promise<SyncError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(SyncError);
  expect((error as SyncError).kind).toBe('repo');
  return error as SyncError;
}

describe('MemoryRemote: a new repository', () => {
  it('starts with one commit holding a README, like a repo created with "Add a README"', async () => {
    const remote = new MemoryRemote();
    const head = await remote.head();
    expect(head).toMatch(/^[0-9a-f]{40}$/);
    expect(remote.commitCount()).toBe(1);
    expect([...remote.files().keys()]).toEqual(['README.md']);

    const tree = await remote.tree(head!);
    expect(tree.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(tree.files).toEqual([
      { path: 'README.md', sha: blobSha(remote.files().get('README.md')!) },
    ]);
  });

  it('reports a private repo on main unless told otherwise', async () => {
    expect(await new MemoryRemote().repoInfo()).toEqual({ private: true, defaultBranch: 'main' });
    expect(await new MemoryRemote({ private: false, defaultBranch: 'trunk' }).repoInfo()).toEqual({
      private: false,
      defaultBranch: 'trunk',
    });
  });

  it('can start empty, with no commits at all', async () => {
    const remote = new MemoryRemote({ empty: true });
    expect(await remote.head()).toBeNull();
    expect(remote.files()).toEqual(new Map());
    expect(remote.commitCount()).toBe(0);
  });

  it('never shares a commit sha with another repository', async () => {
    expect(await new MemoryRemote().head()).not.toBe(await new MemoryRemote().head());
  });
});

describe('MemoryRemote: initEmpty', () => {
  it('creates the first commit of an empty repository, holding one file', async () => {
    const remote = new MemoryRemote({ empty: true });
    const head = await remote.initEmpty('sisyphos.json', MARKER, 'Start the training log');
    expect(await remote.head()).toBe(head);
    expect(remote.commitCount()).toBe(1);
    expect(remote.files()).toEqual(new Map([['sisyphos.json', MARKER]]));
    expect((await remote.tree(head)).files).toEqual([
      { path: 'sisyphos.json', sha: blobSha(MARKER) },
    ]);
  });

  it('refuses a repository that already has commits', async () => {
    const remote = new MemoryRemote();
    const head = await remote.head();
    await repoError(remote.initEmpty('sisyphos.json', MARKER, 'Start the training log'));
    expect(await remote.head()).toBe(head);
    expect(remote.files().has('sisyphos.json')).toBe(false);
  });
});

describe('MemoryRemote: commit and moveBranch', () => {
  it('applies changes on the base tree, carrying every other file over', async () => {
    const remote = new MemoryRemote();
    remote.externalCommit([
      { path: 'sisyphos.json', content: MARKER },
      { path: 'lifter/bodyweight.csv', content: 'date,weight_kg\n' },
      { path: 'templates/a.json', content: 'a\n' },
    ]);

    await push(remote, [
      { path: 'sessions/2026/2026-09-14-k3f9.json', content: SESSION },
      { path: 'lifter/bodyweight.csv', content: 'date,weight_kg\n2026-09-14,82.5\n' },
      { path: 'templates/a.json', content: null },
    ]);

    expect(remote.files()).toEqual(
      new Map([
        ['README.md', expect.any(String)],
        ['sisyphos.json', MARKER],
        ['lifter/bodyweight.csv', 'date,weight_kg\n2026-09-14,82.5\n'],
        ['sessions/2026/2026-09-14-k3f9.json', SESSION],
      ]),
    );
    expect(remote.commitCount()).toBe(3);
  });

  it('writes the commit without moving the branch', async () => {
    const remote = new MemoryRemote();
    const head = (await remote.head())!;
    const { sha } = await remote.tree(head);
    const next = await remote.commit({
      parent: head,
      baseTree: sha,
      changes: [{ path: 'sisyphos.json', content: MARKER }],
      message: 'Sync',
    });

    expect(await remote.head()).toBe(head);
    expect(remote.files().has('sisyphos.json')).toBe(false);
    const tree = await remote.tree(next.commit);
    expect(tree.sha).toBe(next.tree);
    expect(tree.files.map((f) => f.path)).toEqual(['README.md', 'sisyphos.json']);
  });

  it('gives equal trees one sha and different trees different ones', async () => {
    const remote = new MemoryRemote();
    const head = (await remote.head())!;
    const { sha } = await remote.tree(head);
    const write = (content: string) =>
      remote.commit({
        parent: head,
        baseTree: sha,
        changes: [{ path: 'a.json', content }],
        message: 'Sync',
      });
    const [one, again, other] = [await write('1\n'), await write('1\n'), await write('2\n')];

    expect(again.tree).toBe(one.tree);
    expect(other.tree).not.toBe(one.tree);
    // Two devices committing the same thing still make two commits, as timestamps do on GitHub.
    expect(again.commit).not.toBe(one.commit);
  });

  it('refuses a parent or base tree it does not have', async () => {
    const remote = new MemoryRemote();
    const head = (await remote.head())!;
    const { sha } = await remote.tree(head);
    const changes = [{ path: 'a.json', content: 'a\n' }];

    await repoError(
      remote.commit({ parent: 'f'.repeat(40), baseTree: sha, changes, message: 'x' }),
    );
    await repoError(remote.commit({ parent: head, baseTree: head, changes, message: 'x' }));
  });

  it('refuses to delete a path the base tree does not hold, as GitHub does', async () => {
    const remote = new MemoryRemote();
    const head = (await remote.head())!;
    const { sha } = await remote.tree(head);
    await repoError(
      remote.commit({
        parent: head,
        baseTree: sha,
        changes: [
          { path: 'new.json', content: 'never stored\n' },
          { path: 'missing.json', content: null },
        ],
        message: 'x',
      }),
    );
    // The refused write left nothing behind.
    await repoError(remote.blob(blobSha('never stored\n')));
  });

  it('refuses to move the branch anywhere but forward', async () => {
    const remote = new MemoryRemote();
    const root = (await remote.head())!;
    const first = await push(remote, [{ path: 'a.json', content: '1\n' }]);

    // Back to an ancestor.
    await repoError(remote.moveBranch(first.commit, root));
    // Sideways, to a commit that does not contain the head.
    const { sha } = await remote.tree(root);
    const side = await remote.commit({
      parent: root,
      baseTree: sha,
      changes: [{ path: 'b.json', content: '2\n' }],
      message: 'Sync',
    });
    await repoError(remote.moveBranch(first.commit, side.commit));
    // To a commit that does not exist.
    await repoError(remote.moveBranch(first.commit, 'f'.repeat(40)));

    expect(await remote.head()).toBe(first.commit);
  });

  it("answers 'raced' when the head is no longer where the caller left it", async () => {
    const remote = new MemoryRemote();
    const root = (await remote.head())!;
    const { sha } = await remote.tree(root);
    const mine = await remote.commit({
      parent: root,
      baseTree: sha,
      changes: [{ path: 'mine.json', content: 'mine\n' }],
      message: 'Sync',
    });
    const theirs = remote.externalCommit([{ path: 'theirs.json', content: 'theirs\n' }]);

    expect(await remote.moveBranch(root, mine.commit)).toBe('raced');
    expect(await remote.head()).toBe(theirs);
    expect(remote.files().has('mine.json')).toBe(false);
  });

  it('lets a test slip a commit in just before the move, forcing a race', async () => {
    const remote = new MemoryRemote();
    const root = (await remote.head())!;
    const { sha } = await remote.tree(root);
    const mine = await remote.commit({
      parent: root,
      baseTree: sha,
      changes: [{ path: 'mine.json', content: 'mine\n' }],
      message: 'Sync',
    });

    let theirs: string | null = null;
    remote.beforeMove = () => {
      remote.beforeMove = null;
      theirs = remote.externalCommit([{ path: 'theirs.json', content: 'theirs\n' }]);
    };
    expect(await remote.moveBranch(root, mine.commit)).toBe('raced');
    expect(await remote.head()).toBe(theirs);

    // Merged onto their commit, the same change lands.
    const again = await remote.commit({
      parent: theirs!,
      baseTree: (await remote.tree(theirs!)).sha,
      changes: [{ path: 'mine.json', content: 'mine\n' }],
      message: 'Sync',
    });
    expect(await remote.moveBranch(theirs!, again.commit)).toBe('moved');
    expect([...remote.files().keys()].sort()).toEqual(['README.md', 'mine.json', 'theirs.json']);
    expect(remote.commitCount()).toBe(3);
  });

  it('treats moving to the head itself as a fast-forward', async () => {
    const remote = new MemoryRemote();
    const head = (await remote.head())!;
    expect(await remote.moveBranch(head, head)).toBe('moved');
  });
});

describe('MemoryRemote: externalCommit', () => {
  it('commits on the head and moves the branch', () => {
    const remote = new MemoryRemote();
    const commit = remote.externalCommit([{ path: 'a.json', content: 'a\n' }], 'From the laptop');
    expect(remote.commitCount()).toBe(2);
    expect(remote.files().get('a.json')).toBe('a\n');
    return expect(remote.head()).resolves.toBe(commit);
  });

  it('creates the root commit of an empty repository', async () => {
    const remote = new MemoryRemote({ empty: true });
    const commit = remote.externalCommit([{ path: 'notes.md', content: 'hi\n' }]);
    expect(await remote.head()).toBe(commit);
    expect(remote.commitCount()).toBe(1);
    expect(remote.files()).toEqual(new Map([['notes.md', 'hi\n']]));
  });
});

describe('MemoryRemote: contains', () => {
  it('walks ancestry across branches of history', async () => {
    const remote = new MemoryRemote();
    const root = (await remote.head())!;
    const a = remote.externalCommit([{ path: 'a.json', content: 'a\n' }]);
    const b = remote.externalCommit([{ path: 'b.json', content: 'b\n' }]);
    // A side branch off `a`, never on the branch.
    const side = await remote.commit({
      parent: a,
      baseTree: (await remote.tree(a)).sha,
      changes: [{ path: 's.json', content: 's\n' }],
      message: 'Sync',
    });

    expect(await remote.contains(b, b)).toBe(true);
    expect(await remote.contains(root, b)).toBe(true);
    expect(await remote.contains(a, b)).toBe(true);
    expect(await remote.contains(a, side.commit)).toBe(true);
    expect(await remote.contains(b, a)).toBe(false);
    expect(await remote.contains(side.commit, b)).toBe(false);
    expect(await remote.contains(b, side.commit)).toBe(false);
  });

  it('answers false for a commit it does not have, as GitHub answers 404', async () => {
    const remote = new MemoryRemote();
    const head = (await remote.head())!;
    expect(await remote.contains('f'.repeat(40), head)).toBe(false);
    expect(await remote.contains(head, 'f'.repeat(40))).toBe(false);
  });

  it('knows a commit from another repository is not in this one', async () => {
    const other = (await new MemoryRemote().head())!;
    const remote = new MemoryRemote();
    expect(await remote.contains(other, (await remote.head())!)).toBe(false);
  });
});

describe('MemoryRemote: blobs and trees', () => {
  it('addresses blobs by their git blob sha, multi-byte text included', async () => {
    const remote = new MemoryRemote();
    const { tree } = await push(remote, [
      { path: 'sessions/2026/2026-09-14-k3f9.json', content: SESSION },
      { path: 'empty.txt', content: '' },
    ]);
    const head = (await remote.head())!;
    const listed = (await remote.tree(head)).files;

    expect((await remote.tree(head)).sha).toBe(tree);
    expect(listed).toContainEqual({
      path: 'sessions/2026/2026-09-14-k3f9.json',
      sha: blobSha(SESSION),
    });
    expect(listed).toContainEqual({
      path: 'empty.txt',
      sha: 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391',
    });
    for (const { sha } of listed) expect(blobSha(await remote.blob(sha))).toBe(sha);
  });

  it('lists every file, and only files, sorted by path', async () => {
    const remote = new MemoryRemote();
    await push(remote, [
      { path: 'sessions/2026/b.json', content: 'b\n' },
      { path: 'sessions/2026/a.json', content: 'a\n' },
      { path: 'lifter/bodyweight.csv', content: 'x\n' },
    ]);
    const { files } = await remote.tree((await remote.head())!);
    expect(files.map((f) => f.path)).toEqual([
      'README.md',
      'lifter/bodyweight.csv',
      'sessions/2026/a.json',
      'sessions/2026/b.json',
    ]);
  });

  it('refuses a commit or blob it does not have', async () => {
    const remote = new MemoryRemote();
    await repoError(remote.tree('f'.repeat(40)));
    await repoError(remote.blob(blobSha('never written\n')));
  });

  it('keeps what it returns apart from what it holds', async () => {
    const remote = new MemoryRemote();
    const head = (await remote.head())!;

    const tree = await remote.tree(head);
    tree.files[0].sha = 'tampered';
    tree.files.push({ path: 'extra.json', sha: 'tampered' });
    expect(await remote.tree(head)).toEqual({
      sha: tree.sha,
      files: [{ path: 'README.md', sha: blobSha(remote.files().get('README.md')!) }],
    });

    remote.files().set('README.md', 'tampered');
    expect(remote.files().get('README.md')).not.toBe('tampered');

    const info = await remote.repoInfo();
    info.private = false;
    expect((await remote.repoInfo()).private).toBe(true);
  });

  it('keeps changes passed to a commit apart from the tree it wrote', async () => {
    const remote = new MemoryRemote();
    const changes = [{ path: 'a.json', content: 'a\n' as string | null }];
    await push(remote, changes);
    changes[0].content = 'changed after the fact\n';
    changes.push({ path: 'b.json', content: 'b\n' });
    expect(remote.files().get('a.json')).toBe('a\n');
    expect(remote.files().has('b.json')).toBe(false);
  });
});

describe('MemoryRemote: calls and failure injection', () => {
  it('records every Remote operation, in order, and not the test controls', async () => {
    const remote = new MemoryRemote();
    remote.externalCommit([{ path: 'a.json', content: 'a\n' }]);
    remote.files();
    remote.commitCount();
    await push(remote, [{ path: 'b.json', content: 'b\n' }]);
    await remote.repoInfo();
    await remote.blob(blobSha('a\n'));
    await remote.contains((await remote.head())!, (await remote.head())!);
    expect(remote.calls).toEqual([
      'head',
      'tree',
      'commit',
      'moveBranch',
      'repoInfo',
      'blob',
      'head',
      'head',
      'contains',
    ]);
  });

  it('fails the next call of an op instead of running it, one queued failure per call, in order', async () => {
    const remote = new MemoryRemote();
    const head = (await remote.head())!;
    const offline = new SyncError('retryable', 'offline');
    const limited = new SyncError('rate_limit', 'slow down');
    remote.failNext('head', offline);
    remote.failNext('head', limited);

    await expect(remote.head()).rejects.toBe(offline);
    // Other ops are unaffected.
    expect((await remote.tree(head)).files).toHaveLength(1);
    await expect(remote.head()).rejects.toBe(limited);
    expect(await remote.head()).toBe(head);
    // Failed calls are calls too.
    expect(remote.calls).toEqual(['head', 'head', 'tree', 'head', 'head']);
  });

  it('leaves the remote untouched by a failed call', async () => {
    const remote = new MemoryRemote();
    const root = (await remote.head())!;
    const { sha } = await remote.tree(root);
    const next = await remote.commit({
      parent: root,
      baseTree: sha,
      changes: [{ path: 'a.json', content: 'a\n' }],
      message: 'Sync',
    });
    let raced = false;
    remote.beforeMove = () => {
      raced = true;
    };
    remote.failNext('moveBranch', new SyncError('retryable', 'offline'));

    await expect(remote.moveBranch(root, next.commit)).rejects.toThrow('offline');
    expect(raced).toBe(false);
    expect(await remote.head()).toBe(root);

    const empty = new MemoryRemote({ empty: true });
    empty.failNext('initEmpty', new SyncError('retryable', 'offline'));
    await expect(empty.initEmpty('sisyphos.json', MARKER, 'x')).rejects.toThrow('offline');
    expect(await empty.head()).toBeNull();
  });
});
