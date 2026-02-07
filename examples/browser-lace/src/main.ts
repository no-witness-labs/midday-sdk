/**
 * Browser Lace Wallet Example
 *
 * Demonstrates how to connect to the Lace wallet in a browser environment
 * and deploy/interact with contracts.
 *
 * Prerequisites:
 * - Lace wallet browser extension installed
 * - Local devnet running OR Preview network access
 */
import * as Midday from '@no-witness-labs/midday-sdk';
import * as CounterContract from '../../../contracts/counter/contract/index.js';

// Store connected wallet keys for funding
let connectedKeys: { coinPublicKey: string; encryptionPublicKey: string } | null = null;

// UI Elements
const networkSelect = document.getElementById('network-select') as HTMLSelectElement;
const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;
const addressDiv = document.getElementById('address') as HTMLDivElement;
const actionsDiv = document.getElementById('actions') as HTMLDivElement;
const counterDiv = document.getElementById('counter-value') as HTMLDivElement;

// State
let client: Midday.Client.MiddayClient | null = null;
let contract: Midday.Client.Contract | null = null;

// Update status display
function updateStatus(message: string, isError = false) {
  statusDiv.textContent = message;
  statusDiv.className = isError ? 'error' : 'success';
}

// Update counter display
function updateCounter(value: number | string) {
  if (counterDiv) {
    counterDiv.textContent = `Counter: ${value}`;
    counterDiv.style.display = 'block';
  }
}

// Connect to Lace wallet
async function connectWallet() {
  try {
    updateStatus('Connecting to Lace wallet...');
    connectBtn.disabled = true;

    // Connect to wallet - this will prompt user to approve
    const network = networkSelect?.value || 'undeployed';
    const connection = await Midday.BrowserWallet.connectWallet(network as 'preview' | 'undeployed');

    updateStatus('Creating SDK client...');

    // Create client from wallet connection
    client = await Midday.Client.fromWallet(connection, {
      privateStateProvider: Midday.PrivateState.indexedDBPrivateStateProvider({
        privateStateStoreName: 'lace-example',
      }),
    });

    // Store keys for funding and display address
    connectedKeys = {
      coinPublicKey: connection.addresses.shieldedCoinPublicKey,
      encryptionPublicKey: connection.addresses.shieldedEncryptionPublicKey,
    };
    addressDiv.textContent = `Connected: ${connection.addresses.shieldedCoinPublicKey.slice(0, 16)}...`;
    addressDiv.style.display = 'block';

    // Show action buttons
    actionsDiv.style.display = 'block';

    updateStatus('Connected successfully!');
    connectBtn.textContent = 'Connected';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    updateStatus(`Connection failed: ${message}`, true);
    connectBtn.disabled = false;
  }
}

// Deploy a contract
async function deployContract() {
  if (!client) {
    updateStatus('Not connected', true);
    return;
  }

  try {
    updateStatus('Loading contract...');

    // ZkConfig URL - served by Vite dev server middleware
    // For production, host contract artifacts on a CDN
    const zkConfigUrl = '/zk-config';

    // Load contract with module + zkConfig
    // Use HttpZkConfigProvider which expects: /{circuitId}/zkir, /{circuitId}/prover-key, /{circuitId}/verifier-key
    contract = await client.loadContract({
      module: CounterContract,
      zkConfig: new Midday.ZkConfig.HttpZkConfigProvider(zkConfigUrl),
      privateStateId: 'browser-lace-counter',
    });

    updateStatus('Deploying contract...');
    await contract.deploy();

    updateStatus(`Contract deployed at: ${contract.address}`);
    updateCounter('0');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    updateStatus(`Deploy failed: ${message}`, true);
  }
}

// Call increment action
async function callAction() {
  if (!client || !contract) {
    updateStatus('No contract deployed', true);
    return;
  }

  try {
    updateStatus('Calling increment...');
    const result = await contract.call('increment');
    updateStatus(`TX submitted: ${result.txHash.slice(0, 16)}...`);

    // Read updated state
    await readState();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    updateStatus(`Call failed: ${message}`, true);
  }
}

// Read contract state
async function readState() {
  if (!client || !contract) {
    updateStatus('No contract deployed', true);
    return;
  }

  try {
    updateStatus('Reading state...');
    const state = (await contract.ledgerState()) as { counter: bigint };
    updateCounter(state.counter.toString());
    updateStatus('State read successfully');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    updateStatus(`Read failed: ${message}`, true);
  }
}

// Fund wallet via faucet HTTP API (for local devnet only)
async function fundWallet() {
  if (!connectedKeys) {
    updateStatus('Not connected - connect wallet first', true);
    return;
  }

  const network = networkSelect?.value || 'undeployed';
  if (network !== 'undeployed') {
    updateStatus('Faucet only works on local devnet', true);
    return;
  }

  try {
    updateStatus('Requesting funds from faucet...');
    const response = await fetch('http://localhost:3001/faucet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(connectedKeys),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error || `HTTP ${response.status}`);
    }

    const result = await response.json();
    updateStatus(`Funded! TX: ${result.txId.slice(0, 16)}...`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    updateStatus(`Funding failed: ${message}. Run faucet server first.`, true);
  }
}

// Set up event listeners
connectBtn.addEventListener('click', connectWallet);

// Export for global access (used by onclick in HTML)
(window as unknown as { deployContract: typeof deployContract }).deployContract = deployContract;
(window as unknown as { callAction: typeof callAction }).callAction = callAction;
(window as unknown as { readState: typeof readState }).readState = readState;
(window as unknown as { fundWallet: typeof fundWallet }).fundWallet = fundWallet;

// Initial status
updateStatus('Select network and click "Connect Wallet" to begin');
