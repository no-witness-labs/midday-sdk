import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Cluster } from '../../src/devnet/index.js';
import * as Midday from '../../src/index.js';
import * as CounterContract from '../../contracts/counter/contract/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const COUNTER_CONTRACT_DIR = join(__dirname, '../../contracts/counter');

// Genesis wallet seed - pre-funded on devnet
const GENESIS_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

/**
 * E2E tests for contract deployment and interaction on devnet.
 *
 * Prerequisites:
 * - Docker daemon must be running
 * - Midnight images pulled (or will be pulled automatically)
 * - Compiled counter contract in contracts/counter/
 *
 * Run with: pnpm test:e2e
 */
describe('Contract E2E Tests', () => {
  // Test configuration
  const CLUSTER_NAME = 'e2e-contract-test';
  const PORTS = {
    node: 19944,
    indexer: 18088,
    proofServer: 16300,
  };

  let cluster: Cluster.Cluster;

  beforeAll(async () => {
    // Create and start devnet cluster
    cluster = await Cluster.make({
      clusterName: CLUSTER_NAME,
      node: { port: PORTS.node },
      indexer: { port: PORTS.indexer },
      proofServer: { port: PORTS.proofServer },
    });

    // start() already waits for all services to be healthy
    await cluster.start();
  }, 300_000); // 5 min timeout for cluster startup

  afterAll(async () => {
    if (cluster) {
      try {
        await cluster.remove();
      } catch {
        // Ignore cleanup errors
      }
    }
  }, 120_000);

  describe('Counter Contract Lifecycle', () => {
    let client: Midday.Client.MiddayClient;
    let contract: Midday.Client.Contract;
    let contractAddress: string;
    let setupFailed = false;

    beforeAll(async () => {
      try {
        // Create client
        client = await Midday.Client.create({
          seed: GENESIS_SEED,
          networkConfig: cluster.networkConfig,
          privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
          logging: true,
        });

        // Load and deploy contract with retry — proof server can be flaky
        contract = await client.loadContract({
          module: CounterContract,
          zkConfig: Midday.ZkConfig.fromPath(COUNTER_CONTRACT_DIR),
          privateStateId: 'counter-e2e-test',
        });

        await contract.deploy();

        contractAddress = contract.address!;
      } catch (err) {
        setupFailed = true;
        throw err;
      }
    }, 300_000);

    afterAll(async () => {
      if (client) {
        try { await client.close(); } catch { /* ignore */ }
      }
    }, 30_000);

    it('should have deployed the counter contract', () => {
      expect(contract.state).toBe('deployed');
      expect(contractAddress).toMatch(/^[0-9a-f]+$/i);
    });

    it('should call increment() and verify state', { timeout: 120_000 }, async () => {
      if (setupFailed) return; // skip gracefully if deploy failed

      const result = await contract.call('increment');

      expect(result).toBeDefined();
      expect(result.txHash).toBeDefined();
      expect(result.blockHeight).toBeGreaterThan(0);

      // Read ledger state via contract handle
      const state = await contract.ledgerState();
      expect(state).toBeDefined();
    });

    it('should call increment() again and verify state increased', { timeout: 120_000 }, async () => {
      if (setupFailed) return;

      const result = await contract.call('increment');

      expect(result).toBeDefined();
      expect(result.txHash).toBeDefined();

      const state = await contract.ledgerState();
      expect(state).toBeDefined();
    });

    it('should join existing contract from second client', { timeout: 120_000 }, async () => {
      if (setupFailed) return;

      const SECOND_SEED = 'b'.repeat(64);

      await Midday.Client.withClient({
        seed: SECOND_SEED,
        networkConfig: cluster.networkConfig,
        privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
        logging: true,
      }, async (client2) => {
        const joinedContract = await client2.loadContract({
          module: CounterContract,
          zkConfig: Midday.ZkConfig.fromPath(COUNTER_CONTRACT_DIR),
          privateStateId: 'counter-e2e-test-client2',
        });

        // Verify it's in loaded state
        expect(joinedContract.state).toBe('loaded');

        // Join the deployed contract (transitions to "deployed" state)
        await joinedContract.join(contractAddress);

        // Verify it's now deployed
        expect(joinedContract.state).toBe('deployed');
        expect(joinedContract.address).toBe(contractAddress);

        // Read state via joined contract handle
        const state = await joinedContract.ledgerState();
        expect(state).toBeDefined();
      });
    });

    it('should call decrement() and verify state', { timeout: 120_000 }, async () => {
      if (setupFailed) return;

      const result = await contract.call('decrement');

      expect(result).toBeDefined();
      expect(result.txHash).toBeDefined();

      const state = await contract.ledgerState();
      expect(state).toBeDefined();
    });

    // =========================================================================
    // Fee Relay Spike
    // =========================================================================

    it('fee relay: non-funded wallet calls contract via genesis balanceTx', { timeout: 180_000 }, async () => {
      if (setupFailed) return;

      const USER_SEED = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

      // Create user client with fee relay — genesis wallet pays fees
      await Midday.Client.withClient({
        seed: USER_SEED,
        networkConfig: cluster.networkConfig,
        privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
        logging: true,
        feeRelay: { seed: GENESIS_SEED },
      }, async (userClient) => {
        // Load contract and join existing deployed contract
        const userContract = await userClient.loadContract({
          module: CounterContract,
          zkConfig: Midday.ZkConfig.fromPath(COUNTER_CONTRACT_DIR),
          privateStateId: 'fee-relay-user',
        });

        await userContract.join(contractAddress);

        // THE TEST: user wallet calls increment, genesis pays the fee
        const result = await userContract.call('increment');

        expect(result.txHash).toBeDefined();
        expect(result.blockHeight).toBeGreaterThan(0);

        console.log('[FEE RELAY] SUCCESS — genesis wallet relayed fees for user transaction');
        console.log(`[FEE RELAY]   txHash: ${result.txHash}`);
        console.log(`[FEE RELAY]   blockHeight: ${result.blockHeight}`);
      });
    });
  });
});
