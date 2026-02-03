/**
 * Local file-based ZK config provider for E2E testing.
 * Reads ZKIR and keys directly from compiled contract directory.
 */
import {
  ZKConfigProvider,
  createZKIR,
  createProverKey,
  createVerifierKey,
} from '@midnight-ntwrk/midnight-js-types';
import { readFile } from 'fs/promises';
import { join } from 'path';

export class LocalZkConfigProvider extends ZKConfigProvider<string> {
  constructor(private readonly contractDir: string) {
    super();
  }

  async getZKIR(circuitId: string) {
    const bytes = await readFile(join(this.contractDir, 'zkir', `${circuitId}.zkir`));
    return createZKIR(new Uint8Array(bytes));
  }

  async getProverKey(circuitId: string) {
    const bytes = await readFile(join(this.contractDir, 'keys', `${circuitId}.prover`));
    return createProverKey(new Uint8Array(bytes));
  }

  async getVerifierKey(circuitId: string) {
    const bytes = await readFile(join(this.contractDir, 'keys', `${circuitId}.verifier`));
    return createVerifierKey(new Uint8Array(bytes));
  }
}
