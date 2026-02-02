/**
 * Counter Example
 *
 * Complete example demonstrating contract deployment and interaction
 * using the Promise API.
 *
 * Prerequisites:
 * - Local devnet running OR testnet access
 * - ZK config server available
 */
import * as Midday from '@no-witness-labs/midday-sdk';
import * as CounterContract from '../../../contracts/counter/index.js';

// Configuration - update these for your environment
const CONFIG = {
  // Use DEV_WALLET_SEED for local devnet, or your own seed for testnet
  seed: process.env.WALLET_SEED || Midday.Config.DEV_WALLET_SEED,
  // Local devnet ZK config URL
  zkConfigUrl: process.env.ZK_CONFIG_URL || 'http://localhost:3000/zk',
  // Use local network by default
  network: (process.env.NETWORK as 'local' | 'testnet') || 'local',
};

async function main() {
  console.log('=== Counter Example (Promise API) ===\n');

  // Step 1: Create client
  console.log('Creating Midday client...');
  const client = await Midday.Client.create({
    seed: CONFIG.seed,
    networkConfig: Midday.Config.NETWORKS[CONFIG.network],
    zkConfigProvider: new Midday.HttpZkConfigProvider(CONFIG.zkConfigUrl),
    privateStateProvider: Midday.inMemoryPrivateStateProvider(),
    logging: true,
  });
  console.log('Client created!\n');

  // Step 2: Load contract module
  console.log('Loading counter contract...');
  const builder = await Midday.Client.contractFrom(client, {
    module: CounterContract as Midday.ContractModule,
    privateStateId: 'counter-example',
  });
  console.log('Contract loaded!\n');

  // Step 3: Deploy contract
  console.log('Deploying contract...');
  const contract = await Midday.ContractBuilder.deploy(builder);
  console.log(`Contract deployed at: ${contract.address}\n`);

  // Step 4: Read initial state
  console.log('Reading initial state...');
  const initialState = await Midday.Contract.ledgerState(contract);
  console.log(`Initial counter value: ${JSON.stringify(initialState)}\n`);

  // Step 5: Call increment
  console.log('Calling increment()...');
  const result = await Midday.Contract.call(contract, 'increment');
  console.log(`TX Hash: ${result.txHash}`);
  console.log(`Block Height: ${result.blockHeight}\n`);

  // Step 6: Read updated state
  console.log('Reading updated state...');
  const updatedState = await Midday.Contract.ledgerState(contract);
  console.log(`Updated counter value: ${JSON.stringify(updatedState)}\n`);

  // Step 7: Call decrement
  console.log('Calling decrement()...');
  const result2 = await Midday.Contract.call(contract, 'decrement');
  console.log(`TX Hash: ${result2.txHash}`);
  console.log(`Block Height: ${result2.blockHeight}\n`);

  // Step 8: Read final state
  console.log('Reading final state...');
  const finalState = await Midday.Contract.ledgerState(contract);
  console.log(`Final counter value: ${JSON.stringify(finalState)}\n`);

  console.log('=== Example complete! ===');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
