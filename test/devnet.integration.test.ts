import { afterAll, describe, expect, it } from 'vitest';
import * as Cluster from '../src/devnet/Cluster.js';
import * as Container from '../src/devnet/Container.js';
import * as Images from '../src/devnet/Images.js';
import Docker from 'dockerode';

/**
 * Integration tests for Devnet module using REAL Docker containers.
 *
 * Prerequisites:
 * - Docker daemon must be running
 * - Sufficient disk space for Midnight images
 *
 * Run with: pnpm test:devnet
 */
describe('Devnet Integration Tests', () => {
  const createdClusters: Cluster.Cluster[] = [];

  afterAll(async () => {
    for (const cluster of createdClusters) {
      try {
        await Cluster.remove(cluster);
      } catch {
        // Silently ignore cleanup errors
      }
    }
  }, 120_000);

  describe('Cluster Creation', () => {
    it('should create devnet cluster with default configuration', { timeout: 120_000 }, async () => {
      const cluster = await Cluster.make();
      createdClusters.push(cluster);

      expect(cluster.node).toBeDefined();
      expect(cluster.node.id).toMatch(/^[a-f0-9]{64}$/i);
      expect(cluster.node.name).toBe('midday-devnet-node');

      expect(cluster.indexer).toBeDefined();
      expect(cluster.indexer.name).toBe('midday-devnet-indexer');

      expect(cluster.proofServer).toBeDefined();
      expect(cluster.proofServer.name).toBe('midday-devnet-proof-server');

      const docker = new Docker();
      const container = docker.getContainer(cluster.node.id);
      const info = await container.inspect();

      expect(info.State.Status).toBe('created');
      expect(info.Name).toBe('/midday-devnet-node');
    });

    it('should create devnet cluster with custom cluster name', { timeout: 120_000 }, async () => {
      const customName = 'test-custom-cluster';
      const cluster = await Cluster.make({ clusterName: customName });
      createdClusters.push(cluster);

      expect(cluster.node.name).toBe(`${customName}-node`);
      expect(cluster.indexer.name).toBe(`${customName}-indexer`);
      expect(cluster.proofServer.name).toBe(`${customName}-proof-server`);
    });

    it('should create cluster with custom ports', { timeout: 120_000 }, async () => {
      const cluster = await Cluster.make({
        clusterName: 'test-custom-ports',
        node: { port: 19944 },
        indexer: { port: 18088 },
        proofServer: { port: 16300 },
      });
      createdClusters.push(cluster);

      expect(cluster.config.node.port).toBe(19944);
      expect(cluster.config.indexer.port).toBe(18088);
      expect(cluster.config.proofServer.port).toBe(16300);

      const networkConfig = Cluster.toNetworkConfig(cluster);
      expect(networkConfig.node).toBe('ws://localhost:19944');
      expect(networkConfig.indexer).toBe('http://localhost:18088/api/v3/graphql');
      expect(networkConfig.proofServer).toBe('http://localhost:16300');
    });

    it('should remove and recreate cluster with same name', { timeout: 180_000 }, async () => {
      const clusterName = 'test-recreate-cluster';

      const cluster1 = await Cluster.make({ clusterName });
      const firstNodeId = cluster1.node.id;

      const cluster2 = await Cluster.make({ clusterName });
      createdClusters.push(cluster2);

      expect(cluster2.node.id).not.toBe(firstNodeId);
      expect(cluster2.node.name).toBe(cluster1.node.name);

      // First container should no longer exist
      const docker = new Docker();
      await expect(docker.getContainer(firstNodeId).inspect()).rejects.toThrow();
    });
  });

  describe('Cluster Lifecycle', () => {
    it('should start cluster and all containers become running', { timeout: 180_000 }, async () => {
      const cluster = await Cluster.make({
        clusterName: 'test-start-cluster',
        node: { port: 29944 },
        indexer: { port: 28088 },
        proofServer: { port: 26300 },
      });
      createdClusters.push(cluster);

      await Cluster.start(cluster);

      const docker = new Docker();

      const nodeInfo = await docker.getContainer(cluster.node.id).inspect();
      expect(nodeInfo.State.Running).toBe(true);

      const indexerInfo = await docker.getContainer(cluster.indexer.id).inspect();
      expect(indexerInfo.State.Running).toBe(true);

      const proofServerInfo = await docker.getContainer(cluster.proofServer.id).inspect();
      expect(proofServerInfo.State.Running).toBe(true);

      await Cluster.stop(cluster);
    });

    it('should stop running cluster', { timeout: 180_000 }, async () => {
      const cluster = await Cluster.make({
        clusterName: 'test-stop-cluster',
        node: { port: 39944 },
        indexer: { port: 38088 },
        proofServer: { port: 36300 },
      });
      createdClusters.push(cluster);

      await Cluster.start(cluster);
      await Cluster.stop(cluster);

      const docker = new Docker();
      const nodeInfo = await docker.getContainer(cluster.node.id).inspect();

      expect(nodeInfo.State.Running).toBe(false);
    });

    it('should report cluster running status', { timeout: 180_000 }, async () => {
      const cluster = await Cluster.make({
        clusterName: 'test-running-status',
        node: { port: 49944 },
        indexer: { port: 48088 },
        proofServer: { port: 46300 },
      });
      createdClusters.push(cluster);

      expect(await Cluster.isRunning(cluster)).toBe(false);

      await Cluster.start(cluster);
      expect(await Cluster.isRunning(cluster)).toBe(true);

      await Cluster.stop(cluster);
      expect(await Cluster.isRunning(cluster)).toBe(false);
    });
  });

  describe('Container Operations', () => {
    it('should get container status', { timeout: 120_000 }, async () => {
      const cluster = await Cluster.make({
        clusterName: 'test-container-status',
      });
      createdClusters.push(cluster);

      const status = await Container.getStatus(cluster.node);

      expect(status).toBeDefined();
      expect(status?.State).toBeDefined();
      expect(status?.State.Status).toBe('created');
    });

    it('should check if container is running', { timeout: 120_000 }, async () => {
      const cluster = await Cluster.make({
        clusterName: 'test-is-running',
      });
      createdClusters.push(cluster);

      expect(await Container.isRunning(cluster.node)).toBe(false);
    });
  });

  describe('Image Operations', () => {
    it('should check if image is available', { timeout: 30_000 }, async () => {
      // Check for a common image that likely exists
      const available = await Images.isAvailable('hello-world');
      expect(typeof available).toBe('boolean');
    });

    it('should return false for non-existent image', { timeout: 30_000 }, async () => {
      const available = await Images.isAvailable(
        'nonexistent/image:definitely-does-not-exist-12345'
      );
      expect(available).toBe(false);
    });
  });

  describe('Network Config', () => {
    it('should generate valid network config', { timeout: 120_000 }, async () => {
      const cluster = await Cluster.make({
        clusterName: 'test-network-config',
        node: { port: 59944 },
        indexer: { port: 58088 },
        proofServer: { port: 56300 },
      });
      createdClusters.push(cluster);

      const networkConfig = Cluster.toNetworkConfig(cluster);

      expect(networkConfig).toEqual({
        networkId: 'undeployed',
        indexer: 'http://localhost:58088/api/v3/graphql',
        indexerWS: 'ws://localhost:58088/api/v3/graphql/ws',
        node: 'ws://localhost:59944',
        proofServer: 'http://localhost:56300',
      });
    });
  });
});
