import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Cluster } from '../../src/devnet/index.js';
import * as Midday from '../../src/index.js';
import * as SecretCounterContract from '../../contracts/secret-counter/contract/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SECRET_COUNTER_DIR = join(__dirname, '../../contracts/secret-counter');

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
 * 
 * Note: Witness functions receive a context parameter (WitnessContext)
 * containing ledger state and private state access.
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
    proofServer: 16302,
  };

  // The secret password used for testing (converted to 32-byte array)
  const SECRET_PASSWORD = Midday.Hash.stringToBytes32('my-secret-password');
  // Hash of the password using persistentHash (matches Compact's persistentHash)
  const PASSWORD_HASH = Midday.Hash.bytes32(SECRET_PASSWORD);

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
      await Midday.Client.withClient({
        seed: GENESIS_SEED,
        networkConfig: cluster.networkConfig,
        privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
        logging: true,
      }, async (client) => {
        const loaded = await client.loadContract({
          module: SecretCounterContract,
          zkConfig: Midday.ZkConfig.fromPath(SECRET_COUNTER_DIR),
          privateStateId: 'secret-counter-init-test',
          witnesses: createWitnesses(SECRET_PASSWORD),
        });

        // Deploy — returns a DeployedContract
        const contract = await loaded.deploy();

        expect(contract.address).toMatch(/^[0-9a-f]+$/i);

        // Initialize via typed actions
        const initResult = await contract.actions.init(PASSWORD_HASH);
        expect(initResult.txHash).toBeDefined();

        const state = await contract.ledgerState();
        expect(state.password_hash).toEqual(PASSWORD_HASH);
      });
    });

    it('should increment counter with correct password', { timeout: 180_000 }, async () => {
      await Midday.Client.withClient({
        seed: GENESIS_SEED,
        networkConfig: cluster.networkConfig,
        privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
        logging: true,
      }, async (client) => {
        const loaded = await client.loadContract({
          module: SecretCounterContract,
          zkConfig: Midday.ZkConfig.fromPath(SECRET_COUNTER_DIR),
          privateStateId: 'secret-counter-incr-test',
          witnesses: createWitnesses(SECRET_PASSWORD),
        });

        const contract = await loaded.deploy();

        // Initialize
        await contract.actions.init(PASSWORD_HASH);

        // Increment via typed actions
        const incrResult = await contract.actions.increment(5n);
        expect(incrResult.txHash).toBeDefined();

        const state = await contract.ledgerState();
        expect(state.counter).toBe(5n);
      });
    });

    it('should decrement counter with correct password', { timeout: 180_000 }, async () => {
      await Midday.Client.withClient({
        seed: GENESIS_SEED,
        networkConfig: cluster.networkConfig,
        privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
        logging: true,
      }, async (client) => {
        const loaded = await client.loadContract({
          module: SecretCounterContract,
          zkConfig: Midday.ZkConfig.fromPath(SECRET_COUNTER_DIR),
          privateStateId: 'secret-counter-decr-test',
          witnesses: createWitnesses(SECRET_PASSWORD),
        });

        const contract = await loaded.deploy()

        // Initialize
        await contract.actions.init(PASSWORD_HASH);

        // Increment first to have value > 0
        await contract.actions.increment(10n);

        // Decrement via typed actions
        const decrResult = await contract.actions.decrement(3n);
        expect(decrResult.txHash).toBeDefined();

        const state = await contract.ledgerState();
        expect(state.counter).toBe(7n);
      });
    });

    it('should reject operations with wrong password', { timeout: 180_000 }, async () => {
      const correctClient = await Midday.Client.create({
        seed: GENESIS_SEED,
        networkConfig: cluster.networkConfig,
        privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
        logging: true,
      });

      const wrongClient = await Midday.Client.create({
        seed: 'a'.repeat(64),
        networkConfig: cluster.networkConfig,
        privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
        logging: true,
      });

      try {
        const loaded = await correctClient.loadContract({
          module: SecretCounterContract,
          zkConfig: Midday.ZkConfig.fromPath(SECRET_COUNTER_DIR),
          privateStateId: 'secret-counter-wrong-pw-test',
          witnesses: createWitnesses(SECRET_PASSWORD),
        });

        const contract = await loaded.deploy();
        expect(contract.address).toBeDefined();

        // Initialize
        await contract.call('init', PASSWORD_HASH);

        const attackerLoaded = await wrongClient.loadContract({
          module: SecretCounterContract,
          zkConfig: Midday.ZkConfig.fromPath(SECRET_COUNTER_DIR),
          privateStateId: 'secret-counter-wrong-pw-attacker',
          witnesses: createWitnesses(Midday.Hash.stringToBytes32('wrong-password')),
        });

        // Join the existing contract with wrong password client
        const joinedContract = await attackerLoaded.join(contract.address);

        // Should fail because password doesn't match
        await expect(
          joinedContract.call('increment', 1n)
        ).rejects.toThrow('invalid password');
      } finally {
        await correctClient.close();
        await wrongClient.close();
      }
    });
  });
});
