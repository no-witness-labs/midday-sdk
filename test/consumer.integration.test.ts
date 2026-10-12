import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * What a fresh project gets from the packed package, not from this workspace:
 * the workspace's lockfile and overrides do not travel with the tarball.
 * Needs network access to the npm registry and `pnpm` on PATH.
 */
const sdkRoot = resolve(import.meta.dirname, '..');
const run = (cmd: string, args: string[], cwd: string): string =>
  execFileSync(cmd, args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' } });

describe('packed package in a clean consumer', () => {
  it('installs with one onchain-runtime-v3 and imports', { timeout: 600_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'midday-consumer-'));
    run('pnpm', ['pack', '--pack-destination', dir], sdkRoot);
    const tarball = (await readdir(dir)).find((f) => f.endsWith('.tgz'));
    expect(tarball).toBeDefined();

    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }));
    try {
      run('pnpm', ['add', `./${tarball}`], dir);
    } catch (e) {
      // pnpm exits non-zero when it skips optional native build scripts; the install itself is complete.
      const out = `${(e as { stdout?: string }).stdout ?? ''}${(e as { stderr?: string }).stderr ?? ''}`;
      if (!/ERR_PNPM_IGNORED_BUILDS/.test(out)) throw e;
    }

    // Two copies of the on-chain runtime break state decoding ("expected instance of StateValue").
    const store = await readdir(join(dir, 'node_modules', '.pnpm'));
    const runtimes = store.filter((d) => d.startsWith('@midnight-ntwrk+onchain-runtime-v3@'));
    expect(runtimes).toEqual(['@midnight-ntwrk+onchain-runtime-v3@3.0.0']);

    const probe = run('node', ['-e', "import('@no-witness-labs/midday-sdk').then(m => console.log(Object.keys(m).sort().join(',')))"], dir);
    expect(probe.trim().split(',')).toEqual(expect.arrayContaining(['Client', 'Config', 'Contract', 'PrivateState', 'Wallet']));
  });
});
