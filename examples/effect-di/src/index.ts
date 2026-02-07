/**
 * Effect Dependency Injection Example
 *
 * Complete working example demonstrating Effect DI pattern with contract operations.
 * This example spins up a local devnet, deploys the counter contract using Effect,
 * and demonstrates dependency injection patterns.
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
 * The ClientLayer is provided at runtime, making this testable and composable.
 */
const program = Effect.gen(function* () {
  console.log('=== Effect DI Example ===\n');

  // Access the injected client via MiddayClientService
  const client = yield* Midday.Client.MiddayClientService;
  console.log('1. Client accessed via MiddayClientService');
  console.log(`   Network: ${client.networkConfig.networkId}\n`);

  // Load contract using Effect API
  console.log('2. Loading counter contract (Effect API)...');
  const contract = yield* client.effect.loadContract({
    module: CounterContract,
    zkConfig: Midday.ZkConfig.fromPath(COUNTER_CONTRACT_DIR),
    privateStateId: 'effect-di-example',
  });
  console.log(`   Contract loaded (state: ${contract.state})\n`);

  // Deploy using Effect API
  console.log('3. Deploying contract (Effect API)...');
  yield* contract.effect.deploy();
  console.log(`   Contract deployed!`);
  console.log(`   Address: ${contract.address}\n`);

  // Call increment using Effect API
  console.log('4. Calling increment() (Effect API)...');
  const result = yield* contract.effect.call('increment');
  console.log(`   TX Hash: ${result.txHash}`);
  console.log(`   Block: ${result.blockHeight}\n`);

  // Read state using Effect API
  console.log('5. Reading ledger state (Effect API)...');
  const state = yield* contract.effect.ledgerState();
  console.log(`   Counter value: ${state.counter}\n`);

  console.log('=== Effect DI Example complete ===');
  return { address: contract.address, counter: state.counter };
});

// =============================================================================
// Main Entry Point
// =============================================================================

async function main() {
  // Step 1: Create and start devnet
  console.log('Starting local devnet...\n');
  const cluster = await Cluster.make({
    clusterName: 'effect-di-example',
  });

  try {
    await cluster.start();
    console.log(`Devnet ready: ${cluster.networkConfig.node}\n`);

    // Step 2: Create the Client Layer for DI
    const ClientLayer = Midday.Client.layer({
      seed: Midday.Config.DEV_WALLET_SEED,
      networkConfig: cluster.networkConfig,
      privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
    });

    // Step 3: Run the Effect program with the provided layer
    const result = await Effect.runPromise(program.pipe(Effect.provide(ClientLayer)));

    console.log(`\nFinal result:`);
    console.log(`  Contract: ${result.address}`);
    console.log(`  Counter: ${result.counter}`);
  } finally {
    // Cleanup
    console.log('\nCleaning up devnet...');
    await cluster.remove();
    console.log('Done!');
  }
}

main().catch((error) => {
  console.error('Error:', error.message || error);
  process.exit(1);
});
