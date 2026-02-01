/**
 * Counter Example
 *
 * Demonstrates basic contract deployment and interaction using
 * the Promise API.
 */
import * as Midday from '@no-witness-labs/midday-sdk';

// Configuration - update these for your environment
const CONFIG = {
  seed: process.env.WALLET_SEED || Midday.Config.DEV_WALLET_SEED,
  zkConfigUrl: process.env.ZK_CONFIG_URL || 'http://localhost:3000/zk',
};

async function main() {
  console.log('Creating Midday client...');

  // Create client with local network config
  const client = await Midday.Client.create({
    seed: CONFIG.seed,
    networkConfig: Midday.Config.NETWORKS.local,
    zkConfigProvider: new Midday.HttpZkConfigProvider(CONFIG.zkConfigUrl),
    privateStateProvider: Midday.inMemoryPrivateStateProvider(),
    logging: true,
  });

  console.log('Client created successfully');

  // To use this example with a real contract:
  //
  // 1. Import your compiled contract module:
  //    import * as CounterContract from './contracts/counter/index.js';
  //
  // 2. Load and deploy the contract:
  //    const builder = await Midday.Client.contractFrom(client, {
  //      module: CounterContract,
  //    });
  //    const contract = await Midday.ContractBuilder.deploy(builder);
  //    console.log(`Contract deployed at: ${contract.address}`);
  //
  // 3. Call contract actions:
  //    const result = await Midday.Contract.call(contract, 'increment');
  //    console.log(`TX Hash: ${result.txHash}`);
  //
  // 4. Read contract state:
  //    const state = await Midday.Contract.ledgerState(contract);
  //    console.log(`Counter value: ${state.counter}`);

  console.log('Example complete. See comments in source for contract usage.');
}

main().catch(console.error);
