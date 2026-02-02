/**
 * Browser + Lace Wallet Example
 *
 * Complete example demonstrating wallet connection and contract interaction
 * in browser environment with Lace wallet.
 *
 * Prerequisites:
 * - Lace wallet browser extension installed
 * - Lace connected to Midnight testnet
 * - ZK config server with CORS enabled
 */
import * as Midday from '@no-witness-labs/midday-sdk';

// DOM Elements
const connectBtn = document.getElementById('connect') as HTMLButtonElement;
const deployBtn = document.getElementById('deploy') as HTMLButtonElement;
const incrementBtn = document.getElementById('increment') as HTMLButtonElement;
const decrementBtn = document.getElementById('decrement') as HTMLButtonElement;
const readBtn = document.getElementById('read') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;

// State
let client: Midday.MidnightClient | null = null;
let contract: Awaited<ReturnType<typeof Midday.ContractBuilder.deploy>> | null = null;

// Configuration - update for your environment
const ZK_CONFIG_URL = 'https://cdn.example.com/zk';

function log(message: string, type: 'info' | 'error' | 'success' = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const className = type === 'error' ? 'error' : type === 'success' ? 'success' : '';
  statusEl.innerHTML += `<span class="${className}">[${timestamp}] ${message}</span>\n`;
  statusEl.scrollTop = statusEl.scrollHeight;
}

function clearLog() {
  statusEl.innerHTML = '';
}

function enableContractButtons() {
  incrementBtn.disabled = false;
  decrementBtn.disabled = false;
  readBtn.disabled = false;
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
    log('Creating Midday client...');
    client = await Midday.Client.fromWallet(connection, {
      zkConfigProvider: new Midday.HttpZkConfigProvider(ZK_CONFIG_URL),
      privateStateProvider: Midday.indexedDBPrivateStateProvider({
        privateStateStoreName: 'browser-lace-example',
      }),
    });

    log('Client created successfully!', 'success');
    deployBtn.disabled = false;
    connectBtn.disabled = true;
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
});

// Deploy contract
deployBtn.addEventListener('click', async () => {
  if (!client) return;

  log('Loading counter contract...');

  try {
    // Note: In a real app, you'd import your compiled contract module
    // For this example, we're showing the pattern:
    //
    // import * as CounterContract from './contracts/counter/index.js';
    //
    // const builder = await Midday.Client.contractFrom(client, {
    //   module: CounterContract,
    //   privateStateId: 'browser-counter',
    // });

    log('Deploying contract...');
    // const contract = await Midday.ContractBuilder.deploy(builder);
    // log(`Contract deployed at: ${contract.address}`, 'success');

    // For demo purposes, show what would happen:
    log('Contract deployment requires a compiled contract module.', 'info');
    log('See README for how to add your contract.', 'info');

    // Uncomment when you have a real contract:
    // enableContractButtons();
    // deployBtn.disabled = true;
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
});

// Increment counter
incrementBtn.addEventListener('click', async () => {
  if (!contract) return;

  log('Calling increment()...');

  try {
    const result = await Midday.Contract.call(contract, 'increment');
    log(`TX Hash: ${result.txHash}`, 'success');
    log(`Block: ${result.blockHeight}`, 'success');
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
});

// Decrement counter
decrementBtn.addEventListener('click', async () => {
  if (!contract) return;

  log('Calling decrement()...');

  try {
    const result = await Midday.Contract.call(contract, 'decrement');
    log(`TX Hash: ${result.txHash}`, 'success');
    log(`Block: ${result.blockHeight}`, 'success');
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
});

// Read state
readBtn.addEventListener('click', async () => {
  if (!contract) return;

  log('Reading ledger state...');

  try {
    const state = await Midday.Contract.ledgerState(contract);
    log(`State: ${JSON.stringify(state, null, 2)}`, 'success');
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
});
