/**
 * Docker image management utilities.
 *
 * @since 0.2.0
 * @module
 */

import { createRequire } from 'module';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import Docker from 'dockerode';
import { execSync } from 'child_process';

/**
 * Error thrown when image operations fail.
 *
 * @since 0.2.0
 * @category errors
 */
export class ImageError extends Error {
  readonly reason: string;
  override readonly cause?: unknown;

  constructor(options: { reason: string; message: string; cause?: unknown }) {
    super(options.message);
    this.name = 'ImageError';
    this.reason = options.reason;
    this.cause = options.cause;
  }
}

/**
 * Check if a Docker image exists locally.
 *
 * @since 0.2.0
 * @category inspection
 */
export async function isAvailable(imageName: string): Promise<boolean> {
  try {
    const docker = new Docker();
    const images = await docker.listImages({
      filters: { reference: [imageName] },
    });
    return images.length > 0;
  } catch (cause) {
    throw new ImageError({
      reason: 'image_inspection_failed',
      message: `Failed to check if image '${imageName}' is available.`,
      cause,
    });
  }
}

/**
 * Pull a Docker image with progress logging.
 *
 * @since 0.2.0
 * @category management
 */
export async function pull(imageName: string): Promise<void> {
  const docker = new Docker();

  console.log(`[Devnet] Pulling Docker image: ${imageName}`);
  console.log(`[Devnet] This may take a few minutes on first run...`);

  let stream: NodeJS.ReadableStream;
  try {
    stream = await docker.pull(imageName);
  } catch (cause) {
    throw new ImageError({
      reason: 'image_pull_failed',
      message: `Failed to pull image '${imageName}'. Check internet connection and image name.`,
      cause,
    });
  }

  // Wait for pull to complete
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(
      stream,
      (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      },
      (event: { status?: string; id?: string }) => {
        if (
          event.status &&
          event.status !== 'Downloading' &&
          event.status !== 'Extracting'
        ) {
          console.log(
            `[Devnet] ${event.status}${event.id ? ` ${event.id}` : ''}`
          );
        }
      }
    );
  });

  console.log(`[Devnet] ✓ Image ready: ${imageName}`);
}

/**
 * Build a Docker image from a local directory.
 *
 * @since 0.3.0
 * @category management
 */
/** Devnet helper servers shipped as images built from this SDK. */
export type ServerImage = 'faucet' | 'fee-relay';

const SDK_VERSION: string = (createRequire(import.meta.url)('../../package.json') as { version: string }).version;

/**
 * Default image tag for a helper server: `midday-<server>:<sdk version>`.
 * Tagging by SDK version means a new SDK release is never served by a stale
 * image left over from a previous one.
 */
export function serverImage(server: ServerImage): string {
  return `midday-${server}:${SDK_VERSION}`;
}

/**
 * Builds a helper-server image from this SDK's own sources (`docker/Dockerfile`
 * with `--build-arg SERVER=<server>`), so the container runs the same code and
 * dependency cohort as the in-process devnet.
 */
export function buildServerImage(server: ServerImage, imageName: string = serverImage(server)): void {
  const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  console.log(`[Devnet] Building ${imageName} from ${sdkRoot} (first time only)...`);
  execSync(`docker build -f docker/Dockerfile --build-arg SERVER=${server} -t ${imageName} .`, {
    cwd: sdkRoot,
    stdio: 'pipe',
  });
  console.log(`[Devnet] ✓ Image built: ${imageName}`);
}

/**
 * Ensure image is available, pull if necessary.
 *
 * @since 0.2.0
 * @category management
 */
export async function ensureAvailable(imageName: string): Promise<void> {
  const available = await isAvailable(imageName);
  if (!available) {
    await pull(imageName);
  }
}
