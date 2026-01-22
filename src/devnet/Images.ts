/**
 * Docker image management utilities.
 *
 * @since 0.2.0
 * @module
 */

import Docker from 'dockerode';

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
