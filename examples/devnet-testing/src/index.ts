/**
 * Devnet Testing Example
 *
 * Demonstrates how to use the SDK's devnet module for local development
 * and testing with Docker containers.
 *
 * Prerequisites:
 * - Docker installed and running
 * - Sufficient system resources for Midnight containers
 */
import { Cluster } from '@no-witness-labs/midday-sdk/devnet';
import * as Midday from '@no-witness-labs/midday-sdk';

async function main() {
  console.log('=== Devnet Testing Example ===\n');

  // Step 1: Create a devnet cluster
  console.log('1. Creating devnet cluster...');
  let cluster: Cluster.Cluster;

  try {
    cluster = await Cluster.make();
    console.log('   Cluster created');
  } catch (error) {
    console.error('Failed to create cluster:');
    if (error && typeof error === 'object' && 'cause' in error) {
      console.error('Cause:', (error as { cause: unknown }).cause);
    }
    throw error;
  }

  try {
    // Step 2: Start the cluster
    console.log('\n2. Starting devnet cluster (this may take a few minutes)...');
    await cluster.start();
    console.log('   Cluster started successfully!');

    // Step 3: Display network configuration
    console.log('\n3. Network configuration:');
    const networkConfig = cluster.networkConfig;
    console.log(`   Network ID: ${networkConfig.networkId}`);
    console.log(`   Indexer: ${networkConfig.indexer}`);
    console.log(`   Node: ${networkConfig.node}`);
    console.log(`   Proof Server: ${networkConfig.proofServer}`);

    // Step 4: Create a Midday client using the devnet
    console.log('\n4. Creating Midday client with devnet config...');
    const client = await Midday.Client.create({
      seed: Midday.Config.DEV_WALLET_SEED, // Use dev wallet for local testing
      networkConfig: cluster.networkConfig,
      privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
    });
    console.log('   Client created');
    console.log(`   Network ID: ${client.networkConfig.networkId}`);

    // Step 5: Demonstrate contract operations (structure only)
    console.log('\n5. Contract operations (demonstration):');
    console.log('   - Load contract: client.loadContract({ module, zkConfigProvider })');
    console.log('   - Deploy: await contract.deploy()');
    console.log('   - Call action: await contract.call("increment")');
    console.log('   - Read state: await contract.ledgerState()');

    console.log('\n=== Devnet ready for testing ===');
    console.log('Press Ctrl+C to stop and cleanup...');

    // Keep running until interrupted
    await new Promise((resolve) => {
      process.on('SIGINT', resolve);
      process.on('SIGTERM', resolve);
    });
  } finally {
    // Step 6: Cleanup
    console.log('\n6. Cleaning up devnet cluster...');
    await cluster.remove();
    console.log('   Cluster removed');
    console.log('\n=== Done ===');
  }
}

main().catch((error) => {
  console.error('Error:', error);
  if (error && typeof error === 'object' && 'cause' in error) {
    const cause = (error as { cause: unknown }).cause;
    console.error('\nRoot cause:', cause);
    if (cause && typeof cause === 'object' && 'cause' in cause) {
      console.error('Nested cause:', (cause as { cause: unknown }).cause);
    }
  }
  process.exit(1);
});
