/**
 * Cleanup script for devnet Docker containers.
 *
 * Removes all midday-devnet containers and network.
 *
 * Usage:
 *   pnpm --filter @examples/devnet-testing cleanup
 */
import Docker from 'dockerode';

const CONTAINER_NAMES = [
  'midday-devnet-node',
  'midday-devnet-indexer',
  'midday-devnet-proof-server',
  'midday-devnet-faucet',
];

async function cleanup() {
  console.log('=== Cleaning up devnet containers ===\n');

  const docker = new Docker();

  // Test Docker connection
  try {
    await docker.ping();
  } catch {
    console.error('Error: Cannot connect to Docker.');
    console.error('Try: DOCKER_HOST=unix:///var/run/docker.sock pnpm --filter @examples/devnet-testing cleanup');
    process.exit(1);
  }

  for (const name of CONTAINER_NAMES) {
    try {
      console.log(`Removing ${name}...`);
      const container = docker.getContainer(name);
      // Check if container exists
      await container.inspect();
      // Stop and remove
      try {
        await container.stop();
      } catch {
        // Already stopped
      }
      await container.remove({ force: true });
      console.log(`  Removed ${name}`);
    } catch {
      console.log(`  ${name} not found or already removed`);
    }
  }

  try {
    console.log('\nRemoving network midday-devnet-network...');
    const network = docker.getNetwork('midday-devnet-network');
    await network.remove();
    console.log('  Network removed');
  } catch {
    console.log('  Network not found or already removed');
  }

  console.log('\n=== Cleanup complete ===');
}

cleanup().catch((error) => {
  console.error('Cleanup error:', error);
  process.exit(1);
});
