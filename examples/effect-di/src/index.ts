/**
 * Effect Dependency Injection Example
 *
 * Complete working example demonstrating Effect DI pattern with contract operations.
 * This example spins up a local devnet, deploys the counter contract using Effect,
 * and demonstrates dependency injection, scoped resource management, and Effect logging.
 *
 * Everything is a single Effect program — cluster and client are both managed
 * resources with automatic LIFO cleanup (client closes before cluster removes).
 *
 * Prerequisites:
 * - Docker installed and running
 * - DOCKER_HOST set correctly (for OrbStack: unix:///var/run/docker.sock)
 */
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Cluster } from '@no-witness-labs/midday-sdk/devnet';
import * as Midday from '@no-witness-labs/midday-sdk';
import * as CounterContract from '../../../contracts/counter/contract/index.js';
import { Effect } from 'effect';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const COUNTER_CONTRACT_DIR = join(__dirname, '../../../contracts/counter');

// =============================================================================
// Effect-based Program
// =============================================================================

/**
 * Main program using Effect DI pattern.
 *
 * This is a pure Effect with a single service dependency (MiddayClientService).
 * The layer is provided at the call site, making this testable and composable.
 */
const program = Effect.gen(function* () {
  yield* Effect.log('=== Effect DI Example ===');

  // Access the injected client via MiddayClientService
  const client = yield* Midday.Client.MiddayClientService;
  yield* Effect.log(`Client accessed via MiddayClientService (network: ${client.networkConfig.networkId})`);

  // Load contract using Effect API
  yield* Effect.log('Loading counter contract...');
  const contract = yield* client.effect.loadContract({
    module: CounterContract,
    zkConfig: Midday.ZkConfig.fromPath(COUNTER_CONTRACT_DIR),
    privateStateId: 'effect-di-example',
  });
  yield* Effect.log('Contract loaded');

  // Deploy using Effect API (returns a DeployedContract handle)
  yield* Effect.log('Deploying contract...');
  const deployed = yield* contract.effect.deploy();
  yield* Effect.log(`Contract deployed at: ${deployed.address}`);

  // Call increment using typed actions (Effect API)
  yield* Effect.log('Calling increment()...');
  const result = yield* deployed.effect.actions.increment();
  yield* Effect.log(`TX Hash: ${result.txHash} (block: ${result.blockHeight})`);

  // Read state using Effect API
  yield* Effect.log('Reading ledger state...');
  const state = yield* deployed.effect.ledgerState();
  yield* Effect.log(`Counter value: ${state.counter}`);

  yield* Effect.log('=== Effect DI Example complete ===');
  return { address: deployed.address, counter: state.counter };
});

// =============================================================================
// Main Entry Point — fully Effect-managed
// =============================================================================

/**
 * The entire lifecycle is a single Effect program:
 *
 * 1. Cluster is a scoped resource via makeScoped (create+start / remove)
 * 2. Client layer is scoped (auto-closes when scope ends)
 * 3. Cleanup order is guaranteed: client closes → cluster removes (LIFO)
 */
const main = Effect.gen(function* () {
  yield* Effect.log('Starting local devnet...');

  // Cluster as a scoped resource — automatically started and removed on scope exit
  const cluster = yield* Cluster.effect.makeScoped({ clusterName: 'effect-di-example' });
  yield* Effect.log(`Devnet ready: ${cluster.networkConfig.node}`);

  // Build the client layer using the cluster's network config
  const ClientLayer = Midday.Client.layer({
    seed: Midday.Config.DEV_WALLET_SEED,
    networkConfig: cluster.networkConfig,
    privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
  });

  // Run the program with the client layer provided
  const result = yield* program.pipe(Effect.provide(ClientLayer));

  yield* Effect.log(`Final result: contract=${result.address}, counter=${result.counter}`);
  return result;
}).pipe(Effect.scoped); // Scope manages both cluster and client lifecycle

// Single entry point — run the entire Effect program
Effect.runPromise(main).then(
  (result) => {
    console.log(`\nDone! Counter: ${result.counter}`);
  },
  (error) => {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
