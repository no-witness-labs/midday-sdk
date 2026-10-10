import { readFileSync } from 'fs';
import { Effect, Either } from 'effect';
import { beforeAll, describe, expect, it } from 'vitest';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { createKeystore, PublicKey, UnshieldedWallet } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { InMemoryTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { WalletEntrySchema, mergeWalletEntries } from '@midnight-ntwrk/wallet-sdk-facade';
import type { NetworkConfig } from '../src/Config.js';
import * as Wallet from '../src/Wallet.js';

const SEED_A = '0000000000000000000000000000000000000000000000000000000000000001';
const SEED_B = 'b'.repeat(64);
const NETWORK_ID = 'undeployed';

// Unreachable endpoints: every case here must fail during validation, before
// the wallet touches the network.
const OFFLINE_CONFIG: NetworkConfig = {
  networkId: NETWORK_ID,
  indexer: 'http://127.0.0.1:9/api/v3/graphql',
  indexerWS: 'ws://127.0.0.1:9/api/v3/graphql/ws',
  node: 'ws://127.0.0.1:9',
  proofServer: 'http://127.0.0.1:9',
};

function deriveKeys(seedHex: string) {
  const hd = HDWallet.fromSeed(Buffer.from(seedHex, 'hex'));
  if (hd.type !== 'seedOk') throw new Error('bad seed');
  const derived = hd.hdWallet.selectAccount(0).selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust]).deriveKeysAt(0);
  if (derived.type !== 'keysDerived') throw new Error('derive failed');
  return {
    shielded: ledger.ZswapSecretKeys.fromSeed(derived.keys[Roles.Zswap]),
    dust: ledger.DustSecretKey.fromSeed(derived.keys[Roles.Dust]),
    keystore: createKeystore(derived.keys[Roles.NightExternal], NETWORK_ID),
  };
}

/** Real component states for a never-synced wallet, produced without network access. */
async function componentStates(seedHex: string) {
  const keys = deriveKeys(seedHex);
  const txHistoryStorage = new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries);
  const configuration = {
    networkId: NETWORK_ID,
    costParameters: { additionalFeeOverhead: 0n, feeBlocksMargin: 5 },
    relayURL: new URL(OFFLINE_CONFIG.node),
    provingServerUrl: new URL(OFFLINE_CONFIG.proofServer),
    indexerClientConnection: { indexerHttpUrl: OFFLINE_CONFIG.indexer, indexerWsUrl: OFFLINE_CONFIG.indexerWS },
    indexerUrl: OFFLINE_CONFIG.indexerWS,
    txHistoryStorage,
  } as const;
  const shielded = ShieldedWallet(configuration).startWithSecretKeys(keys.shielded);
  const unshielded = UnshieldedWallet(configuration).startWithPublicKey(PublicKey.fromKeyStore(keys.keystore));
  const dust = DustWallet(configuration).startWithSecretKey(keys.dust, ledger.LedgerParameters.initialParameters().dust);
  try {
    return {
      shielded: await shielded.serializeState(),
      unshielded: await unshielded.serializeState(),
      dust: await dust.serializeState(),
      txHistory: await txHistoryStorage.serialize(),
      expectedKeys: {
        coinPublicKey: String(keys.shielded.coinPublicKey),
        encryptionPublicKey: String(keys.shielded.encryptionPublicKey),
        unshieldedPublicKey: PublicKey.fromKeyStore(keys.keystore).publicKey,
        dustPublicKey: keys.dust.publicKey,
      } satisfies Wallet.SnapshotExpectedKeys,
    };
  } finally {
    await Promise.all([shielded.stop(), unshielded.stop(), dust.stop()]);
  }
}

type Components = Awaited<ReturnType<typeof componentStates>>;

function envelope(components: Components, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: 'midday-wallet-snapshot',
    version: Wallet.WALLET_SNAPSHOT_VERSION,
    networkId: NETWORK_ID,
    createdAt: new Date().toISOString(),
    packages: Wallet.WALLET_SNAPSHOT_PACKAGES,
    shielded: components.shielded,
    unshielded: components.unshielded,
    dust: components.dust,
    txHistory: components.txHistory,
    ...overrides,
  });
}

function decode(serialized: string, keys?: Wallet.SnapshotExpectedKeys) {
  return Effect.runSync(Effect.either(Wallet.effect.decodeSnapshot(serialized, { networkId: NETWORK_ID, keys })));
}

function expectReason(result: ReturnType<typeof decode>, reason: Wallet.WalletSnapshotError['reason']) {
  expect(Either.isLeft(result)).toBe(true);
  if (Either.isLeft(result)) {
    expect(result.left._tag).toBe('WalletSnapshotError');
    expect(result.left.reason).toBe(reason);
  }
}

describe('wallet snapshots', () => {
  let a: Components;
  let b: Components;

  beforeAll(async () => {
    a = await componentStates(SEED_A);
    b = await componentStates(SEED_B);
  });


  it('records package versions that match package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    for (const [name, version] of Object.entries(Wallet.WALLET_SNAPSHOT_PACKAGES)) {
      expect(pkg.dependencies[name], name).toBe(version);
    }
  });

  it('accepts a well-formed snapshot for the right network and keys', () => {
    const result = decode(envelope(a), a.expectedKeys);
    expect(Either.isRight(result)).toBe(true);
  });

  it('rejects corrupt input as malformed without echoing it', () => {
    const secretish = '{"format":"midday-wallet-snapshot", SECRET';
    const result = decode(secretish);
    expectReason(result, 'malformed');
    if (Either.isLeft(result)) {
      expect(result.left.message).not.toContain('SECRET');
      expect(result.left.cause).toBeUndefined();
    }
    expectReason(decode('null'), 'malformed');
    expectReason(decode(JSON.stringify({ hello: 'world' })), 'malformed');
    expectReason(decode(envelope(a, { dust: undefined })), 'malformed');
    expectReason(decode(envelope(a, { shielded: '{"not":"a shielded state"}' })), 'malformed');
  });

  it('rejects unknown snapshot versions', () => {
    expectReason(decode(envelope(a, { version: 2 })), 'unsupported-version');
    expectReason(decode(envelope(a, { version: undefined })), 'unsupported-version');
  });

  it('rejects snapshots for another network', () => {
    expectReason(decode(envelope(a, { networkId: 'preview' })), 'network-mismatch');
    const shielded = JSON.stringify({ ...JSON.parse(a.shielded), networkId: 'preview' });
    expectReason(decode(envelope(a, { shielded })), 'network-mismatch');
  });

  it('rejects snapshots produced by another seed', () => {
    expectReason(decode(envelope(b), a.expectedKeys), 'key-mismatch');
    // Mixed components (shielded from A, dust from B) are caught too.
    expectReason(decode(envelope(a, { dust: b.dust }), a.expectedKeys), 'key-mismatch');
  });

  describe('Wallet.fromSeed({ restoreState })', () => {
    const restore = (restoreState: string, seed = SEED_A) =>
      Wallet.fromSeed(seed, OFFLINE_CONFIG, { restoreState, sync: false });

    it('fails with WalletSnapshotError instead of syncing from scratch', async () => {
      await expect(restore('not json')).rejects.toMatchObject({ _tag: 'WalletSnapshotError', reason: 'malformed' });
      await expect(restore(envelope(a, { version: 99 }))).rejects.toMatchObject({
        reason: 'unsupported-version',
      });
      await expect(restore(envelope(a, { networkId: 'mainnet' }))).rejects.toMatchObject({
        reason: 'network-mismatch',
      });
      await expect(restore(envelope(b))).rejects.toMatchObject({ reason: 'key-mismatch' });
    });

    it('reports component states the wallet SDK rejects as restore-failed', async () => {
      const shielded = JSON.stringify({ ...JSON.parse(a.shielded), state: 'deadbeef' });
      await expect(restore(envelope(a, { shielded }))).rejects.toMatchObject({
        _tag: 'WalletSnapshotError',
        reason: 'restore-failed',
      });
      await expect(restore(envelope(a, { txHistory: '{' }))).rejects.toMatchObject({ reason: 'restore-failed' });
    });
  });
});
