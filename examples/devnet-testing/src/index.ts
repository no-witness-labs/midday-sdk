/**
 * Devnet Testing Example
 *
 * Demonstrates local development workflow using Midnight devnet.
 * This example shows how to:
 * - Start a local devnet cluster
 * - Create a client connected to devnet
 * - Deploy and test contracts locally
 */
import * as Midday from '@no-witness-labs/midday-sdk';
import { Cluster } from '@no-witness-labs/midday-sdk/devnet';

async function main() {
  console.log('=== Devnet Testing Example ===\n');

  // Step 1: Create and start the devnet cluster
  console.log('Creating devnet cluster...');
  console.log('(Ensure Docker is running)\n');

  const cluster = await Cluster.make();

  console.log('Starting devnet cluster...');
  await cluster.start();

  console.log('Devnet cluster started!');
  console.log(`  Network ID: ${cluster.networkConfig.networkId}`);
  console.log(`  Indexer: ${cluster.networkConfig.indexer}`);
  console.log(`  Node: ${cluster.networkConfig.node}`);
  console.log(`  Proof Server: ${cluster.networkConfig.proofServer}\n`);

  try {
    // Step 2: Create a client
    console.log('Creating Midday client...');
    const client = await Midday.Client.create({
      seed: Midday.Config.DEV_WALLET_SEED,
      networkConfig: cluster.networkConfig,
      zkConfigProvider: new Midday.HttpZkConfigProvider(cluster.networkConfig.proofServer),
      privateStateProvider: Midday.inMemoryPrivateStateProvider(),
      logging: true,
    });
    console.log('Client created!\n');

    // Step 3: Deploy and test your contract
    // Uncomment and modify for your contract:
    //
    // const builder = await Midday.Client.contractFrom(client, {
    //   module: await import('./contracts/counter/index.js'),
    // });
    //
    // console.log('Deploying contract...');
    // const contract = await Midday.ContractBuilder.deploy(builder);
    // console.log(`Contract deployed at: ${contract.address}\n`);
    //
    // console.log('Calling increment...');
    // const result = await Midday.Contract.call(contract, 'increment');
    // console.log(`TX Hash: ${result.txHash}`);
    // console.log(`Block: ${result.blockHeight}\n`);
    //
    // const state = await Midday.Contract.ledgerState(contract);
    // console.log(`Counter value: ${state.counter}`);

    console.log('Devnet is ready for testing!');
    console.log('See comments in source code for contract deployment example.\n');

    // Keep running for manual testing
    console.log('Press Ctrl+C to stop the devnet cluster...');
    await new Promise(() => {}); // Wait forever
  } finally {
    // Step 4: Clean up
    console.log('\nStopping devnet cluster...');
    await cluster.remove();
    console.log('Cluster stopped.');
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
