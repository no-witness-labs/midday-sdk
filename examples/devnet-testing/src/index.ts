/**
 * Devnet Testing Example
 *
 * Demonstrates how to use the SDK's devnet module for local development
 * and testing with Docker containers.
 *
 * Includes faucet server for browser apps to fund wallets.
 *
 * Prerequisites:
 * - Docker installed and running
 * - Sufficient system resources for Midnight containers
 */
import { Cluster, Faucet, FeeRelay } from '@no-witness-labs/midday-sdk/devnet';
import * as Midday from '@no-witness-labs/midday-sdk';

async function main() {
  console.log('=== Devnet Testing Example ===\n');

  // Step 1: Create a devnet cluster
  console.log('1. Creating devnet cluster...');
  let cluster: Cluster.Cluster;
  let client: Midday.Client.MiddayClient | null = null;

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

    // Step 4: Start faucet and fee relay for browser apps
    console.log('\n4. Starting faucet and fee relay...');
    await Faucet.startDocker(cluster.networkConfig);
    console.log('   Faucet: http://localhost:3001/faucet');
    await FeeRelay.startDocker(cluster.networkConfig);
    console.log('   Fee relay: http://localhost:3002');

    // Step 5: Create a Midday client using the devnet
    console.log('\n5. Creating Midday client with devnet config...');
    client = await Midday.Client.create({
      seed: Midday.Config.DEV_WALLET_SEED, // Use dev wallet for local testing
      networkConfig: cluster.networkConfig,
      privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
    });
    console.log('   Client created');
    console.log(`   Network ID: ${client.networkConfig.networkId}`);

    // Step 6: Demonstrate contract operations (structure only)
    console.log('\n6. Contract operations (demonstration):');
    console.log('   - Load contract: client.loadContract({ module, zkConfig })');
    console.log('   - Deploy: const deployed = await contract.deploy()');
    console.log('   - Call action: await deployed.actions.increment()');
    console.log('   - Read state: await deployed.ledgerState()');

    console.log('\n=== Devnet ready for testing ===');
    console.log('Faucet available at http://localhost:3001/faucet');
    console.log('Fee relay available at http://localhost:3002');

    // Close client - we don't need it running
    if (client) {
      await client.close();
    }

    console.log('\nRun cleanup when done:');
    console.log('  pnpm --filter @examples/devnet-testing cleanup');
  } catch (error) {
    // On error, cleanup containers
    console.error('\nError occurred, cleaning up...');
    await cluster.remove().catch(() => {});
    throw error;
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
