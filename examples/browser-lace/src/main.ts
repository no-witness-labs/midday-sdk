/**
 * Browser Lace Wallet Example
 *
 * Demonstrates how to connect to the Lace wallet in a browser environment
 * and use it with the Midday SDK.
 *
 * Prerequisites:
 * - Lace wallet browser extension installed
 * - Testnet account with funds
 */
import * as Midday from '@no-witness-labs/midday-sdk';

// UI Elements
const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;
const addressDiv = document.getElementById('address') as HTMLDivElement;
const actionsDiv = document.getElementById('actions') as HTMLDivElement;

// State
let client: Midday.Client.MiddayClient | null = null;

// Update status display
function updateStatus(message: string, isError = false) {
  statusDiv.textContent = message;
  statusDiv.className = isError ? 'error' : 'success';
}

// Connect to Lace wallet
async function connectWallet() {
  try {
    updateStatus('Connecting to Lace wallet...');
    connectBtn.disabled = true;

    // Connect to wallet - this will prompt user to approve
    const connection = await Midday.BrowserWallet.connectWallet('testnet');

    updateStatus('Creating SDK client...');

    // Create client from wallet connection
    // Note: zkConfigProvider is per-contract, not at client level
    client = await Midday.Client.fromWallet(connection, {
      privateStateProvider: Midday.PrivateState.indexedDBPrivateStateProvider({
        privateStateStoreName: 'lace-example',
      }),
    });

    // Display connected address
    addressDiv.textContent = `Connected: ${connection.addresses.shieldedAddress}`;
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

// Deploy a contract (example structure)
async function deployContract() {
  if (!client) {
    updateStatus('Not connected', true);
    return;
  }

  try {
    updateStatus('Loading contract...');

    // Load your contract module with zkConfig
    // const zkConfig = new Midday.ZkConfig.HttpZkConfigProvider('https://cdn.example.com/zk');
    // const contract = await client.loadContract({
    //   module: YourContractModule,
    //   zkConfigProvider: zkConfig,
    // });

    // updateStatus('Deploying contract...');
    // await contract.deploy();
    // updateStatus(`Contract deployed at: ${contract.address}`);

    updateStatus('Contract deployment demonstrated (uncomment code to run)');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    updateStatus(`Deploy failed: ${message}`, true);
  }
}

// Call a contract action (example structure)
async function callAction() {
  if (!client) {
    updateStatus('Not connected', true);
    return;
  }

  try {
    // Assuming you have a loaded contract
    // const result = await contract.call('increment');
    // updateStatus(`Action called! TX: ${result.txHash}`);

    updateStatus('Contract call demonstrated (uncomment code to run)');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    updateStatus(`Call failed: ${message}`, true);
  }
}

// Read contract state (example structure)
async function readState() {
  if (!client) {
    updateStatus('Not connected', true);
    return;
  }

  try {
    // Assuming you have a loaded contract
    // const state = await contract.ledgerState();
    // updateStatus(`State: ${JSON.stringify(state)}`);

    updateStatus('State read demonstrated (uncomment code to run)');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    updateStatus(`Read failed: ${message}`, true);
  }
}

// Set up event listeners
connectBtn.addEventListener('click', connectWallet);

// Export for global access (useful for debugging)
(window as unknown as { deployContract: typeof deployContract }).deployContract = deployContract;
(window as unknown as { callAction: typeof callAction }).callAction = callAction;
(window as unknown as { readState: typeof readState }).readState = readState;

// Initial status
updateStatus('Click "Connect Wallet" to begin');
