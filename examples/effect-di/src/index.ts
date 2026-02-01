/**
 * Effect Dependency Injection Example
 *
 * Demonstrates using Midday SDK with Effect's dependency injection
 * for testable, composable applications.
 */
import * as Midday from '@no-witness-labs/midday-sdk';
import { Effect, Layer, Console } from 'effect';

// Configuration
const CONFIG = {
  seed: process.env.WALLET_SEED || Midday.Config.DEV_WALLET_SEED,
  zkConfigUrl: process.env.ZK_CONFIG_URL || 'http://localhost:3000/zk',
};

/**
 * Example 1: Using pre-configured client layer
 *
 * The simplest way to use Effect DI - create a layer with your config
 * and the client is automatically available.
 */
const example1 = Effect.gen(function* () {
  yield* Console.log('Example 1: Pre-configured client layer');

  // Access the client from context
  const client = yield* Midday.MidnightClientService;

  yield* Console.log(`Client ready with network: ${client.networkConfig.networkId}`);

  // To use with a contract:
  // const builder = yield* Midday.Client.effect.contractFrom(client, { module });
  // const contract = yield* Midday.ContractBuilder.effect.deploy(builder);
});

// Create the client layer with configuration
const clientLayer = Midday.Client.layer({
  seed: CONFIG.seed,
  networkConfig: Midday.Config.NETWORKS.local,
  zkConfigProvider: new Midday.HttpZkConfigProvider(CONFIG.zkConfigUrl),
  privateStateProvider: Midday.inMemoryPrivateStateProvider(),
  logging: true,
});

/**
 * Example 2: Using service interfaces for testability
 *
 * Access services through their interfaces for easier mocking in tests.
 */
const example2 = Effect.gen(function* () {
  yield* Console.log('\nExample 2: Service interfaces');

  const clientService = yield* Midday.ClientService;
  const contractBuilderService = yield* Midday.ContractBuilderService;
  const contractService = yield* Midday.ContractService;

  yield* Console.log('All services available:');
  yield* Console.log('  - ClientService: create, fromWallet, contractFrom');
  yield* Console.log('  - ContractBuilderService: deploy, join');
  yield* Console.log('  - ContractService: call, state, ledgerState');

  // Create client through service
  const client = yield* clientService.create({
    seed: CONFIG.seed,
    networkConfig: Midday.Config.NETWORKS.local,
    zkConfigProvider: new Midday.HttpZkConfigProvider(CONFIG.zkConfigUrl),
    privateStateProvider: Midday.inMemoryPrivateStateProvider(),
  });

  yield* Console.log(`Created client via service`);

  // Services can be mocked in tests:
  // const TestClientService = Layer.succeed(Midday.ClientService, {
  //   create: () => Effect.succeed(mockClient),
  //   contractFrom: () => Effect.succeed(mockBuilder),
  //   ...
  // });
});

// Compose all service layers
const servicesLayer = Layer.mergeAll(
  Midday.ClientLive,
  Midday.ContractBuilderLive,
  Midday.ContractLive,
);

/**
 * Example 3: Composing effects
 *
 * Combine multiple operations into a single composable program.
 */
const example3 = Effect.gen(function* () {
  yield* Console.log('\nExample 3: Composing effects');

  // Operations can be composed
  const program = Midday.Client.effect
    .create({
      seed: CONFIG.seed,
      networkConfig: Midday.Config.NETWORKS.local,
      zkConfigProvider: new Midday.HttpZkConfigProvider(CONFIG.zkConfigUrl),
      privateStateProvider: Midday.inMemoryPrivateStateProvider(),
    })
    .pipe(
      Effect.tap(() => Console.log('Client created')),
      Effect.map((client) => ({
        client,
        networkId: client.networkConfig.networkId,
      })),
      // Error handling with typed errors
      Effect.catchTag('ClientError', (error) => {
        return Console.log(`Handled ClientError: ${error.message}`).pipe(
          Effect.flatMap(() => Effect.fail(error)),
        );
      }),
    );

  const result = yield* program;
  yield* Console.log(`Composed result: networkId=${result.networkId}`);
});

/**
 * Main program
 */
const main = Effect.gen(function* () {
  yield* Console.log('=== Effect DI Examples ===\n');

  // Run example 1 with client layer
  yield* example1.pipe(Effect.provide(clientLayer));

  // Run example 2 with service layers
  yield* example2.pipe(Effect.provide(servicesLayer));

  // Run example 3 (no layer needed - creates its own client)
  yield* example3;

  yield* Console.log('\n=== Examples complete ===');
});

// Run the program
Effect.runPromise(main).catch(console.error);
