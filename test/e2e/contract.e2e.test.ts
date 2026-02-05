import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Cluster } from '../../src/devnet/index.js';
import * as Midday from '../../src/index.js';
import * as CounterContract from '../../contracts/counter/contract/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const COUNTER_CONTRACT_DIR = join(__dirname, '../../contracts/counter');

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

    // Genesis wallet seed - pre-funded on devnet
    const GENESIS_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

    it('should create client connected to devnet', { timeout: 60_000 }, async () => {
      // Create client - zkConfig is now per-contract, not per-client
      client = await Midday.Client.create({
        seed: GENESIS_SEED,
        networkConfig: cluster.networkConfig,
        privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
        logging: true,
      });

      expect(client).toBeDefined();
    });

    it('should deploy counter contract', { timeout: 180_000 }, async () => {
      contract = await client.loadContract({
        module: CounterContract,
        zkConfig: Midday.ZkConfig.fromPath(COUNTER_CONTRACT_DIR),
        privateStateId: 'counter-e2e-test',
      });

      // Verify it's in loaded state
      expect(contract.state).toBe('loaded');
      expect(contract.address).toBeUndefined();

      // Deploy (transitions to "deployed" state)
      await contract.deploy();

      // Verify it's now deployed
      expect(contract.state).toBe('deployed');
      contractAddress = contract.address!;

      expect(contract).toBeDefined();
      expect(contractAddress).toMatch(/^[0-9a-f]+$/i);
    });

    it('should call increment() and verify state', { timeout: 120_000 }, async () => {
      // Call via contract handle
      const result = await contract.call('increment');

      expect(result).toBeDefined();
      expect(result.txHash).toBeDefined();
      expect(result.blockHeight).toBeGreaterThan(0);

      // Read ledger state via contract handle
      const state = await contract.ledgerState();
      expect(state).toBeDefined();
    });

    it('should call increment() again and verify state increased', { timeout: 120_000 }, async () => {
      const result = await contract.call('increment');

      expect(result).toBeDefined();
      expect(result.txHash).toBeDefined();

      const state = await contract.ledgerState();
      expect(state).toBeDefined();
    });

    it('should join existing contract from second client', { timeout: 120_000 }, async () => {
      // Create a second client with different seed
      const SECOND_SEED = 'b'.repeat(64);

      const client2 = await Midday.Client.create({
        seed: SECOND_SEED,
        networkConfig: cluster.networkConfig,
        privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
        logging: true,
      });

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

    it('should call decrement() and verify state', { timeout: 120_000 }, async () => {
      const result = await contract.call('decrement');

      expect(result).toBeDefined();
      expect(result.txHash).toBeDefined();

      const state = await contract.ledgerState();
      expect(state).toBeDefined();
    });
  });
});
