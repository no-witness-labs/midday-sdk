import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Cluster } from '../../src/devnet/index.js';
import * as Midday from '../../src/index.js';
import * as SecretCounterContract from '../../contracts/secret-counter/contract/index.js';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { persistentHash, CompactTypeBytes } from '@midnight-ntwrk/compact-runtime';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SECRET_COUNTER_DIR = join(__dirname, '../../contracts/secret-counter');

/**
 * Compute the persistent hash of a password (Uint8Array).
 * This matches the Compact `persistentHash<Bytes<32>>()` function.
 * Returns Uint8Array (Bytes<32>) which is the native TS representation.
 */
function hashPassword(password: Uint8Array): Uint8Array {
  return persistentHash(new CompactTypeBytes(32), password);
}

/**
 * Convert a string password to a 32-byte array.
 * Pads with zeros if shorter, truncates if longer.
 */
function stringToBytes32(str: string): Uint8Array {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  if (bytes.length > 32) {
    console.warn(`Password truncated from ${bytes.length} to 32 bytes`);
  }
  const result = new Uint8Array(32);
  result.set(bytes.slice(0, 32));
  return result;
}

/** Private state storing the user's secret password as bytes */
interface PasswordState {
  password: Uint8Array;
}

/**
 * Creates witnesses that store password in private state.
 * 
 * The password is captured in the closure and stored in private state
 * for persistence. While the private state could be read on subsequent
 * calls, we always use the closure value for simplicity.
 */
function createWitnesses(password: Uint8Array): SecretCounterContract.Witnesses<PasswordState> {
  return {
    provide_password: () => [{ password }, password],
  };
}

/**
 * E2E tests for contracts with witness functions.
 *
 * This tests the secret-counter contract which requires a password
 * witness to authorize increment/decrement operations.
 */
describe('Witness Contract E2E Tests', () => {
  const CLUSTER_NAME = 'e2e-witness-test';
  const PORTS = {
    node: 19945,
    indexer: 18089,
    proofServer: 16301,
  };

  // The secret password used for testing (converted to 32-byte array)
  const SECRET_PASSWORD = stringToBytes32('my-secret-password');
  // Hash of the password using persistentHash (matches Compact's persistentHash)
  const PASSWORD_HASH = hashPassword(SECRET_PASSWORD);

  const GENESIS_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

  let cluster: Cluster.Cluster;

  beforeAll(async () => {
    cluster = await Cluster.make({
      clusterName: CLUSTER_NAME,
      node: { port: PORTS.node },
      indexer: { port: PORTS.indexer },
      proofServer: { port: PORTS.proofServer },
    });

    await cluster.start();
  }, 300_000);

  afterAll(async () => {
    if (cluster) {
      try {
        await cluster.remove();
      } catch {
        // Ignore cleanup errors
      }
    }
  }, 120_000);

  describe('Secret Counter Contract', () => {
    /**
     * Tests for witness contract operations.
     *
     * Witness functions return [newPrivateState, witnessValue]. The private state
     * is persisted between calls. Here we store the password in private state,
     * which is the idiomatic pattern for secret-bearing witnesses.
     */

    it('should deploy and initialize with password hash', { timeout: 180_000 }, async () => {
      const zkConfigProvider = new NodeZkConfigProvider(SECRET_COUNTER_DIR);
      const privateStateProvider = Midday.inMemoryPrivateStateProvider();

      const client = await Midday.Client.create({
        seed: GENESIS_SEED,
        networkConfig: cluster.networkConfig,
        zkConfigProvider,
        privateStateProvider,
        logging: true,
      });

      const builder = await Midday.Client.contractFrom(client, {
        module: SecretCounterContract as Midday.ContractModule,
        privateStateId: 'secret-counter-init-test',
        witnesses: createWitnesses(SECRET_PASSWORD),
      });

      const contract = await Midday.ContractBuilder.deploy(builder);
      expect(contract.address).toMatch(/^[0-9a-f]+$/i);

      // Initialize
      const initResult = await Midday.Contract.call(contract, 'init', PASSWORD_HASH);
      expect(initResult.txHash).toBeDefined();

      const state = await Midday.Contract.ledgerState(contract) as SecretCounterContract.Ledger;
      expect(state.password_hash).toEqual(PASSWORD_HASH);
    });

    it('should increment counter with correct password', { timeout: 180_000 }, async () => {
      const zkConfigProvider = new NodeZkConfigProvider(SECRET_COUNTER_DIR);
      const privateStateProvider = Midday.inMemoryPrivateStateProvider();

      const client = await Midday.Client.create({
        seed: GENESIS_SEED,
        networkConfig: cluster.networkConfig,
        zkConfigProvider,
        privateStateProvider,
        logging: true,
      });

      const builder = await Midday.Client.contractFrom(client, {
        module: SecretCounterContract as Midday.ContractModule,
        privateStateId: 'secret-counter-incr-test',
        witnesses: createWitnesses(SECRET_PASSWORD),
      });

      const contract = await Midday.ContractBuilder.deploy(builder);

      // Initialize
      await Midday.Contract.call(contract, 'init', PASSWORD_HASH);

      // Increment
      const incrResult = await Midday.Contract.call(contract, 'increment', 5n);
      expect(incrResult.txHash).toBeDefined();

      const state = await Midday.Contract.ledgerState(contract) as SecretCounterContract.Ledger;
      expect(state.counter).toBe(5n);
    });

    it('should decrement counter with correct password', { timeout: 180_000 }, async () => {
      const zkConfigProvider = new NodeZkConfigProvider(SECRET_COUNTER_DIR);
      const privateStateProvider = Midday.inMemoryPrivateStateProvider();

      const client = await Midday.Client.create({
        seed: GENESIS_SEED,
        networkConfig: cluster.networkConfig,
        zkConfigProvider,
        privateStateProvider,
        logging: true,
      });

      const builder = await Midday.Client.contractFrom(client, {
        module: SecretCounterContract as Midday.ContractModule,
        privateStateId: 'secret-counter-decr-test',
        witnesses: createWitnesses(SECRET_PASSWORD),
      });

      const contract = await Midday.ContractBuilder.deploy(builder);

      // Initialize
      await Midday.Contract.call(contract, 'init', PASSWORD_HASH);

      // Increment first to have value > 0
      await Midday.Contract.call(contract, 'increment', 10n);

      // Decrement
      const decrResult = await Midday.Contract.call(contract, 'decrement', 3n);
      expect(decrResult.txHash).toBeDefined();

      const state = await Midday.Contract.ledgerState(contract) as SecretCounterContract.Ledger;
      expect(state.counter).toBe(7n);
    });

    it('should reject operations with wrong password', { timeout: 180_000 }, async () => {
      // Create ZK config provider
      const zkConfigProvider = new NodeZkConfigProvider(SECRET_COUNTER_DIR);

      // Create private state provider
      const privateStateProvider = Midday.inMemoryPrivateStateProvider();

      // Create first client with correct password
      const correctClient = await Midday.Client.create({
        seed: GENESIS_SEED,
        networkConfig: cluster.networkConfig,
        zkConfigProvider,
        privateStateProvider,
        logging: true,
      });

      // Deploy with correct password
      const builder = await Midday.Client.contractFrom(correctClient, {
        module: SecretCounterContract as Midday.ContractModule,
        privateStateId: 'secret-counter-wrong-pw-test',
        witnesses: createWitnesses(SECRET_PASSWORD),
      });

      const contract = await Midday.ContractBuilder.deploy(builder);
      expect(contract).toBeDefined();

      // Initialize
      await Midday.Contract.call(contract, 'init', PASSWORD_HASH);

      // Create second client with WRONG password
      const wrongPrivateStateProvider = Midday.inMemoryPrivateStateProvider();
      const wrongClient = await Midday.Client.create({
        seed: 'a'.repeat(64),
        networkConfig: cluster.networkConfig,
        zkConfigProvider,
        privateStateProvider: wrongPrivateStateProvider,
        logging: true,
      });

      const wrongBuilder = await Midday.Client.contractFrom(wrongClient, {
        module: SecretCounterContract as Midday.ContractModule,
        privateStateId: 'secret-counter-wrong-pw-attacker',
        witnesses: createWitnesses(stringToBytes32('wrong-password')), // Wrong password
      });

      // Join the existing contract with wrong password client
      const joinedContract = await Midday.ContractBuilder.join(wrongBuilder, contract.address);

      // Should fail because password doesn't match
      await expect(
        Midday.Contract.call(joinedContract, 'increment', 1n)
      ).rejects.toThrow('invalid password');
    });
  });
});
