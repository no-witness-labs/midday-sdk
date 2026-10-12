import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as PrivateState from '../src/PrivateState.js';

const A = '0'.repeat(63) + 'a';
const B = '0'.repeat(63) + 'b';

describe('in-memory private state provider', () => {
  it('scopes state by contract address', async () => {
    const p = PrivateState.inMemoryPrivateStateProvider();
    p.setContractAddress(A);
    await p.set('contract', { n: 1 });
    p.setContractAddress(B);
    expect(await p.get('contract')).toBeNull();
    await p.set('contract', { n: 2 });
    p.setContractAddress(A);
    expect(await p.get('contract')).toEqual({ n: 1 });
  });

  it('refuses access before an address is set', async () => {
    const p = PrivateState.inMemoryPrivateStateProvider();
    await expect(p.get('contract')).rejects.toThrow(/setContractAddress/);
    await expect(p.set('contract', 1)).rejects.toThrow(/setContractAddress/);
  });

  it('keys signing keys by address', async () => {
    const p = PrivateState.inMemoryPrivateStateProvider();
    await p.setSigningKey(A, 'sk-a');
    expect(await p.getSigningKey(A)).toBe('sk-a');
    expect(await p.getSigningKey(B)).toBeNull();
  });
});

describe('boundToContract', () => {
  it('re-asserts its address before each access and refuses another', async () => {
    const shared = PrivateState.inMemoryPrivateStateProvider();
    const a = PrivateState.boundToContract(shared, A);
    const b = PrivateState.boundToContract(shared, B);
    await a.set('contract', 'A');
    await b.set('contract', 'B');
    // Someone else moved the shared provider; the views are unaffected.
    shared.setContractAddress(B);
    expect(await a.get('contract')).toBe('A');
    expect(await b.get('contract')).toBe('B');
    expect(() => a.setContractAddress(B)).toThrow(/bound to contract/);
  });
});

describe('persistent private state provider (level)', () => {
  const password = 'correct horse battery staple 42';

  it('keeps interleaved writes from bound views under their own contracts', async () => {
    const dbName = join(await mkdtemp(join(tmpdir(), 'psp-')), 'db');
    const shared = PrivateState.indexedDBPrivateStateProvider({ accountId: 'acct', password, dbName });
    const a = PrivateState.boundToContract(shared, A);
    const b = PrivateState.boundToContract(shared, B);
    await a.set('contract', 'A-before');
    await b.set('contract', 'B-before');

    // The upstream provider awaits a lock before it reads the address; without
    // serialization this write for A landed under B.
    const writing = a.set('contract', 'A-after');
    b.setContractAddress(B);
    const removing = b.remove('contract');
    shared.setContractAddress(A);
    await Promise.all([writing, removing]);

    expect(await a.get('contract')).toBe('A-after');
    expect(await b.get('contract')).toBeNull();
    expect(await a.get('contract')).toBe('A-after');
  });

  it('is not redirected by setContractAddress on another view while an operation awaits upstream', async () => {
    // Shaped like the level provider: set() awaits (a rotation lock there) and
    // only then reads the current address. The await is controlled here so the
    // interleaving is deterministic.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const writes: Array<[string, unknown]> = [];
    let current: string | null = null;
    const fake = {
      ...PrivateState.inMemoryPrivateStateProvider(),
      setContractAddress(address: string) { current = address; },
      async set(id: string, state: unknown) { await gate; writes.push([`${current}:${id}`, state]); },
    };
    const a = PrivateState.boundToContract(fake, A);
    const b = PrivateState.boundToContract(fake, B);

    const writing = a.set('contract', 'A-after');
    await Promise.resolve(); // a's turn has started and is parked on the await
    b.setContractAddress(B); // what midnight-js does right before accessing b
    release();
    await writing;

    expect(writes).toEqual([[`${A}:contract`, 'A-after']]);
  });

  it('requires an account id and a password', () => {
    expect(() => PrivateState.indexedDBPrivateStateProvider({ accountId: '', password })).toThrow(/accountId/);
    expect(() => PrivateState.indexedDBPrivateStateProvider({ accountId: 'acct', password: '' })).toThrow(/password/);
  });

  it('round-trips encrypted state per contract and per account', async () => {
    const dbName = join(await mkdtemp(join(tmpdir(), 'psp-')), 'db');
    const one = PrivateState.indexedDBPrivateStateProvider({ accountId: 'acct-1', password, dbName });
    one.setContractAddress(A);
    await one.set('contract', { secret: new Uint8Array([1, 2, 3]), big: 7n });
    expect(await one.get('contract')).toEqual({ secret: new Uint8Array([1, 2, 3]), big: 7n });
    one.setContractAddress(B);
    expect(await one.get('contract')).toBeNull();

    const other = PrivateState.indexedDBPrivateStateProvider({ accountId: 'acct-2', password, dbName });
    other.setContractAddress(A);
    expect(await other.get('contract')).toBeNull();
  });

  it('rejects a weak password on first use', async () => {
    const dbName = join(await mkdtemp(join(tmpdir(), 'psp-')), 'db');
    const p = PrivateState.indexedDBPrivateStateProvider({ accountId: 'acct', password: 'short', dbName });
    p.setContractAddress(A);
    await expect(p.set('contract', 1)).rejects.toThrow(/shorter than/);
  });
});
