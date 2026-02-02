/**
 * Effect Dependency Injection Example
 *
 * Complete example demonstrating contract deployment and interaction
 * using Effect's dependency injection for testable, composable applications.
 *
 * Prerequisites:
 * - Local devnet running OR testnet access
 * - ZK config server available
 */
import * as Midday from '@no-witness-labs/midday-sdk';
import * as CounterContract from '../../../contracts/counter/index.js';
import { Effect, Layer, Console } from 'effect';

// Configuration
const CONFIG = {
  seed: process.env.WALLET_SEED || Midday.Config.DEV_WALLET_SEED,
  zkConfigUrl: process.env.ZK_CONFIG_URL || 'http://localhost:3000/zk',
  network: (process.env.NETWORK as 'local' | 'testnet') || 'local',
};

/**
 * Main program using Effect DI
 */
const program = Effect.gen(function* () {
  yield* Console.log('=== Effect DI Example ===\n');

  // Access services from context
  const clientService = yield* Midday.ClientService;
  const contractBuilderService = yield* Midday.ContractBuilderService;
  const contractService = yield* Midday.ContractService;

  // Step 1: Create client via service
  yield* Console.log('Creating Midday client...');
  const client = yield* clientService.create({
    seed: CONFIG.seed,
    networkConfig: Midday.Config.NETWORKS[CONFIG.network],
    zkConfigProvider: new Midday.HttpZkConfigProvider(CONFIG.zkConfigUrl),
    privateStateProvider: Midday.inMemoryPrivateStateProvider(),
    logging: true,
  });
  yield* Console.log('Client created!\n');

  // Step 2: Load contract via service
  yield* Console.log('Loading counter contract...');
  const builder = yield* clientService.contractFrom(client, {
    module: CounterContract as Midday.ContractModule,
    privateStateId: 'effect-di-example',
  });
  yield* Console.log('Contract loaded!\n');

  // Step 3: Deploy via service
  yield* Console.log('Deploying contract...');
  const contract = yield* contractBuilderService.deploy(builder);
  yield* Console.log(`Contract deployed at: ${contract.address}\n`);

  // Step 4: Read initial state
  yield* Console.log('Reading initial state...');
  const initialState = yield* contractService.ledgerState(contract);
  yield* Console.log(`Initial counter value: ${JSON.stringify(initialState)}\n`);

  // Step 5: Call increment via service
  yield* Console.log('Calling increment()...');
  const result = yield* contractService.call(contract, 'increment');
  yield* Console.log(`TX Hash: ${result.txHash}`);
  yield* Console.log(`Block Height: ${result.blockHeight}\n`);

  // Step 6: Read updated state
  yield* Console.log('Reading updated state...');
  const updatedState = yield* contractService.ledgerState(contract);
  yield* Console.log(`Updated counter value: ${JSON.stringify(updatedState)}\n`);

  yield* Console.log('=== Example complete! ===');

  return { contract, finalState: updatedState };
});

/**
 * Compose service layers
 */
const ServicesLive = Layer.mergeAll(
  Midday.ClientLive,
  Midday.ContractBuilderLive,
  Midday.ContractLive,
);

/**
 * Run the program with services
 */
async function main() {
  const result = await Effect.runPromise(
    program.pipe(
      Effect.provide(ServicesLive),
      // Handle errors with typed error handling
      Effect.catchTag('ClientError', (error) => {
        console.error('Client error:', error.message);
        return Effect.fail(error);
      }),
      Effect.catchTag('ContractError', (error) => {
        console.error('Contract error:', error.message);
        return Effect.fail(error);
      }),
    ),
  );

  console.log('\nResult:', result);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
