/**
 * Counter Example - Promise API
 *
 * Complete working example demonstrating contract deployment and interaction.
 * This example spins up a local devnet, deploys the counter contract,
 * and interacts with it.
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const COUNTER_CONTRACT_DIR = join(__dirname, '../../../contracts/counter');

async function main() {
  console.log('=== Counter Example (Promise API) ===\n');

  // Step 1: Create and start devnet
  console.log('1. Starting local devnet...');
  const cluster = await Cluster.make({
    clusterName: 'counter-example',
  });

  try {
    await cluster.start();
    console.log('   Devnet started');
    console.log(`   Node: ${cluster.networkConfig.node}`);
    console.log(`   Indexer: ${cluster.networkConfig.indexer}\n`);

    // Step 2: Create client
    console.log('2. Creating Midday client...');
    const client = await Midday.Client.create({
      seed: Midday.Config.DEV_WALLET_SEED,
      networkConfig: cluster.networkConfig,
      privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
    });
    console.log('   Client created\n');

    // Step 3: Load contract
    console.log('3. Loading counter contract...');
    const contract = await client.loadContract({
      module: CounterContract,
      zkConfig: Midday.ZkConfig.fromPath(COUNTER_CONTRACT_DIR),
      privateStateId: 'counter-example',
    });
    console.log(`   Contract loaded\n`);

    // Step 4: Deploy contract (returns a DeployedContract handle)
    console.log('4. Deploying contract...');
    const deployed = await contract.deploy();
    console.log(`   Contract deployed!`);
    console.log(`   Address: ${deployed.address}\n`);

    // Step 5: Call increment (using typed actions)
    console.log('5. Calling increment()...');
    const result1 = await deployed.actions.increment();
    console.log(`   TX Hash: ${result1.txHash}`);
    console.log(`   Block: ${result1.blockHeight}\n`);

    // Step 6: Read state
    console.log('6. Reading ledger state...');
    const state1 = await deployed.ledgerState();
    console.log(`   Counter value: ${state1.counter}\n`);

    // Step 7: Call increment again
    console.log('7. Calling increment() again...');
    const result2 = await deployed.actions.increment();
    console.log(`   TX Hash: ${result2.txHash}\n`);

    // Step 8: Read state again
    console.log('8. Reading ledger state...');
    const state2 = await deployed.ledgerState();
    console.log(`   Counter value: ${state2.counter}\n`);

    console.log('=== Example complete ===');
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
