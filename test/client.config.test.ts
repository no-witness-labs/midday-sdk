import { describe, expect, it } from 'vitest';
import * as Client from '../src/Client.js';
import * as Config from '../src/Config.js';
import * as PrivateState from '../src/PrivateState.js';

// These checks must fail before any wallet or network I/O, so they run without Docker.
const privateStateProvider = PrivateState.inMemoryPrivateStateProvider();
const preprod = Config.blockfrost('preprod', 'tok');

describe('Client.create network and seed guards', () => {
  it('does not imply the development seed for a custom network config', async () => {
    await expect(Client.create({ networkConfig: preprod, privateStateProvider })).rejects.toMatchObject({
      _tag: 'ClientError',
      message: expect.stringMatching(/seed is required for network 'preprod'/),
    });
  });

  it('refuses the development seed on a public network even when passed explicitly', async () => {
    await expect(
      Client.create({ networkConfig: preprod, seed: Config.DEV_WALLET_SEED, privateStateProvider }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/Refusing the development wallet seed/) });
    await expect(
      Client.create({ network: 'preview', seed: Config.DEV_WALLET_SEED, privateStateProvider }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/Refusing the development wallet seed/) });
  });

  it('rejects a preset name that contradicts the custom network config', async () => {
    await expect(
      Client.create({ network: 'preview', networkConfig: preprod, seed: 'ab'.repeat(32), privateStateProvider }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/contradicts networkConfig/) });
    expect(() => Client.createReadonly({ network: 'preview', networkConfig: preprod })).toThrow(
      /contradicts networkConfig/,
    );
  });

  it('still requires a seed for a named public preset', async () => {
    await expect(Client.create({ network: 'preview', privateStateProvider })).rejects.toMatchObject({
      message: expect.stringMatching(/seed is required for network 'preview'/),
    });
  });
});
