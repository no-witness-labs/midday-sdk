import { describe, it, expect } from 'vitest';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import * as Midday from '../../src/index.js';

// Minimal repro for midnight-wallet#361 (Error 170 = InvalidDustSpendProof).
// https://github.com/midnightntwrk/midnight-wallet/issues/361
//
// Status: skipped by default. The maintainer asked for a minimal repro on
// 2026-05-05; running this against a faucet'd preprod wallet reproduces the
// same error 170 we see in Wallet.shield(). For upstream submission, strip
// midday-sdk and use bare wallet-sdk-facade + wallet-sdk-dust-wallet so
// midday-sdk is not a variable.
//
// Prereqs:
//   1. Faucet a preprod test wallet with tNIGHT (https://faucet.preprod.midnight.network).
//   2. Run a local proof server on :6300 (matches Midday.Config.NETWORKS.preprod).
//      docker run --rm -p 6300:6300 midnightnetwork/proof-server:latest
//   3. Export the BIP39 seed for the faucet'd wallet as MIDNIGHT_REPRO_SEED
//      (hex, no 0x prefix). For the abandon×23+diesel mnemonic this is the
//      64-byte PBKDF2 seed; derive via bip39.mnemonicToSeedSync(mnemonic).
//
// Run:
//   MIDNIGHT_REPRO_SEED=<hex> pnpm vitest run test/upstream-repro/

const SEED = process.env.MIDNIGHT_REPRO_SEED;
const NETWORK = process.env.MIDNIGHT_REPRO_NETWORK ?? 'preprod';
const AMOUNT = BigInt(process.env.MIDNIGHT_REPRO_AMOUNT ?? '100000000'); // 0.1 NIGHT default

describe.skipIf(!SEED)('upstream-repro: shield → Error 170 InvalidDustSpendProof', () => {
  it('Wallet.shield() rejected by runtime with Custom error 170', async () => {
    const config = Midday.Config.getNetworkConfig(NETWORK);
    const wallet = await Midday.Wallet.fromSeed(SEED!, config);
    if (wallet.type !== 'connected') {
      throw new Error(`wallet not connected: ${JSON.stringify(wallet)}`);
    }

    // Pre-shield diagnostics — confirms DUST is non-zero on the wallet
    // observable (this is what the #361 reporter saw too).
    const balanceBefore = await wallet.getBalance();
    const nativeToken = ledger.nativeToken().raw;
    console.log('[repro] address:', wallet.address);
    console.log('[repro] unshielded NIGHT:', balanceBefore.unshielded[nativeToken] ?? 0n);
    console.log('[repro] shielded   NIGHT:', balanceBefore.shielded[nativeToken] ?? 0n);
    console.log('[repro] DUST balance:', balanceBefore.dust.balance);

    // Attempt the shield. On preprod specVersion 22000 with wallet-sdk-dust-wallet@3.0.0
    // this fails at submit with `1010: Invalid Transaction: Custom error: 170`.
    let caught: unknown;
    try {
      const result = await wallet.shield(AMOUNT);
      console.log('[repro] UNEXPECTED success — fix has shipped:', result);
    } catch (err) {
      caught = err;
      console.log('[repro] caught error:', err);
    } finally {
      await wallet.close();
    }

    expect(caught).toBeDefined();
    expect(String(caught)).toMatch(/Custom error: 170|InvalidDustSpendProof/);
  }, 300_000);
});
