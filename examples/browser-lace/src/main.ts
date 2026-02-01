/**
 * Browser + Lace Wallet Example
 *
 * Demonstrates wallet connection and contract interaction in browser.
 */
import * as Midday from '@no-witness-labs/midday-sdk';

// DOM Elements
const connectBtn = document.getElementById('connect') as HTMLButtonElement;
const deployBtn = document.getElementById('deploy') as HTMLButtonElement;
const incrementBtn = document.getElementById('increment') as HTMLButtonElement;
const readBtn = document.getElementById('read') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;

// State
let client: Midday.MidnightClient | null = null;
let contract: Awaited<ReturnType<typeof Midday.ContractBuilder.deploy>> | null = null;

// Configuration
const ZK_CONFIG_URL = 'https://cdn.example.com/zk'; // Update for your environment

function log(message: string, type: 'info' | 'error' | 'success' = 'info') {
  const className = type === 'error' ? 'error' : type === 'success' ? 'success' : '';
  statusEl.innerHTML += `<span class="${className}">${message}</span>\n`;
  statusEl.scrollTop = statusEl.scrollHeight;
}

function clearLog() {
  statusEl.innerHTML = '';
}

// Connect to Lace wallet
connectBtn.addEventListener('click', async () => {
  clearLog();
  log('Connecting to Lace wallet...');

  try {
    // Connect to wallet
    const connection = await Midday.connectWallet('testnet');
    log(`Connected! Address: ${connection.addresses.shieldedAddress}`, 'success');

    // Create client from wallet connection
    client = await Midday.Client.fromWallet(connection, {
      zkConfigProvider: new Midday.HttpZkConfigProvider(ZK_CONFIG_URL),
      privateStateProvider: Midday.indexedDBPrivateStateProvider({
        privateStateStoreName: 'browser-lace-example',
      }),
    });

    log('Client created successfully', 'success');

    // Enable buttons
    deployBtn.disabled = false;
    connectBtn.disabled = true;
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
});

// Deploy contract
deployBtn.addEventListener('click', async () => {
  if (!client) return;

  log('Deploying contract...');

  try {
    // To use with a real contract:
    // 1. Import your compiled contract module
    // 2. Load and deploy:
    //
    // const builder = await Midday.Client.contractFrom(client, {
    //   module: await import('./contracts/counter/index.js'),
    // });
    // contract = await Midday.ContractBuilder.deploy(builder);
    // log(`Contract deployed at: ${contract.address}`, 'success');

    log('Contract deployment placeholder - see source for implementation', 'info');
    log('To complete: import your compiled contract module', 'info');

    // Enable interaction buttons when contract is deployed
    // incrementBtn.disabled = false;
    // readBtn.disabled = false;
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
});

// Increment counter
incrementBtn.addEventListener('click', async () => {
  if (!contract) return;

  log('Calling increment...');

  try {
    const result = await Midday.Contract.call(contract, 'increment');
    log(`TX Hash: ${result.txHash}`, 'success');
    log(`Block: ${result.blockHeight}`, 'success');
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
});

// Read state
readBtn.addEventListener('click', async () => {
  if (!contract) return;

  log('Reading state...');

  try {
    const state = await Midday.Contract.ledgerState(contract);
    log(`State: ${JSON.stringify(state, null, 2)}`, 'success');
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
});
