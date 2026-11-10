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
    await p.forContract(A).set('contract', { n: 1 });
    expect(await p.forContract(B).get('contract')).toBeNull();
    await p.forContract(B).set('contract', { n: 2 });
    expect(await p.forContract(A).get('contract')).toEqual({ n: 1 });
    expect(await p.forContract(A.toUpperCase()).get('contract')).toEqual({ n: 1 });
  });

  it('clears one contract, or all of them', async () => {
    const p = PrivateState.inMemoryPrivateStateProvider();
    await p.forContract(A).set('contract', 'A');
    await p.forContract(B).set('contract', 'B');
    await p.forContract(A).clear();
    expect(await p.forContract(A).get('contract')).toBeNull();
    expect(await p.forContract(B).get('contract')).toBe('B');
    await p.clearAll();
    expect(await p.forContract(B).get('contract')).toBeNull();
  });

  it('keys signing keys by address', async () => {
    const p = PrivateState.inMemoryPrivateStateProvider();
    const key = { tag: 'schnorr' as const, value: 'a'.repeat(64) };
    await p.setSigningKey(A, key);
    expect(await p.getSigningKey(A)).toEqual(key);
    expect(await p.getSigningKey(B)).toBeNull();
  });
});

describe('persistent private state provider (level)', () => {
  const password = 'correct horse battery staple 42';

  it('keeps interleaved writes for two contracts under their own contracts', async () => {
    const dbName = join(await mkdtemp(join(tmpdir(), 'psp-')), 'db');
    const shared = PrivateState.persistentPrivateStateProvider({ accountId: 'acct', password, dbName });
    const a = shared.forContract(A);
    const b = shared.forContract(B);
    await a.set('contract', 'A-before');
    await b.set('contract', 'B-before');

    await Promise.all([a.set('contract', 'A-after'), b.remove('contract')]);

    expect(await a.get('contract')).toBe('A-after');
    expect(await b.get('contract')).toBeNull();
  });

  it('exports and imports one contract', async () => {
    const dbName = join(await mkdtemp(join(tmpdir(), 'psp-')), 'db');
    const shared = PrivateState.persistentPrivateStateProvider({ accountId: 'acct', password, dbName });
    await shared.forContract(A).set('contract', 'A');
    await shared.forContract(B).set('contract', 'B');

    const backup = await shared.forContract(A).exportPrivateStates({ password });
    const freshDb = join(await mkdtemp(join(tmpdir(), 'psp-')), 'db');
    const fresh = PrivateState.persistentPrivateStateProvider({ accountId: 'acct', password, dbName: freshDb });
    await fresh.forContract(A).importPrivateStates(backup, { password });
    expect(await fresh.forContract(A).get('contract')).toBe('A');
    expect(await fresh.forContract(B).get('contract')).toBeNull();
  });

  it('requires an account id and a password', () => {
    expect(() => PrivateState.persistentPrivateStateProvider({ accountId: '', password })).toThrow(/accountId/);
    expect(() => PrivateState.persistentPrivateStateProvider({ accountId: 'acct', password: '' })).toThrow(/password/);
  });

  it('round-trips encrypted state per contract and per account', async () => {
    const dbName = join(await mkdtemp(join(tmpdir(), 'psp-')), 'db');
    const one = PrivateState.persistentPrivateStateProvider({ accountId: 'acct-1', password, dbName });
    await one.forContract(A).set('contract', { secret: new Uint8Array([1, 2, 3]), big: 7n });
    expect(await one.forContract(A).get('contract')).toEqual({ secret: new Uint8Array([1, 2, 3]), big: 7n });
    expect(await one.forContract(B).get('contract')).toBeNull();

    const other = PrivateState.persistentPrivateStateProvider({ accountId: 'acct-2', password, dbName });
    expect(await other.forContract(A).get('contract')).toBeNull();
  });

  it('rejects a weak password from a password function on first use', async () => {
    const dbName = join(await mkdtemp(join(tmpdir(), 'psp-')), 'db');
    const p = PrivateState.persistentPrivateStateProvider({ accountId: 'acct', password: () => 'short', dbName });
    await expect(p.forContract(A).set('contract', 1)).rejects.toThrow(/shorter than/);
  });
});

describe('private-state passwords', () => {
  it('rejects a non-compliant string password when the provider is created', () => {
    const hex = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    expect(() => PrivateState.persistentPrivateStateProvider({ accountId: 'acct', password: hex })).toThrow(/at least 3 of/);
    expect(() => PrivateState.persistentPrivateStateProvider({ accountId: 'acct', password: 'Abcd-efgh-1234-xyz' })).toThrow(/rejected/);
  });

  it('derives a deterministic, policy-compliant password from a secret', async () => {
    const secret = new Uint8Array(32).fill(7);
    const pw = PrivateState.derivePassword(secret);
    expect(PrivateState.derivePassword(secret)).toBe(pw);
    expect(PrivateState.derivePassword(new Uint8Array(32).fill(8))).not.toBe(pw);
    // Many random secrets: every derived password is accepted by the provider.
    for (let i = 0; i < 300; i++) {
      const s = crypto.getRandomValues(new Uint8Array(32));
      expect(() => PrivateState.persistentPrivateStateProvider({ accountId: 'acct', password: PrivateState.derivePassword(s) })).not.toThrow();
    }
    expect(() => PrivateState.derivePassword(new Uint8Array(16))).toThrow(/at least 32 bytes/);
  });
});
