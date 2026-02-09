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

// Store connected wallet for balance queries
let wallet: Midday.Wallet.ConnectedWallet | null = null;

// UI Elements
const networkSelect = document.getElementById('network-select') as HTMLSelectElement;
const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;
const addressDiv = document.getElementById('address') as HTMLDivElement;
const actionsDiv = document.getElementById('actions') as HTMLDivElement;
const counterDiv = document.getElementById('counter-value') as HTMLDivElement;

// State
let client: Midday.Client.MiddayClient | null = null;
let contract: Midday.Contract.DeployedContract | null = null;

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
    wallet = await Midday.Wallet.fromBrowser(network as 'preview' | 'undeployed');

    updateStatus('Creating SDK client...');

    // Check if user wants fee relay (genesis wallet pays fees) or own dust
    const useFeeRelay = (document.getElementById('fee-relay-checkbox') as HTMLInputElement).checked;

    client = await Midday.Client.create({
      wallet,
      privateStateProvider: Midday.PrivateState.indexedDBPrivateStateProvider({
        privateStateStoreName: 'lace-example',
      }),
      ...(useFeeRelay ? { feeRelay: { url: 'http://localhost:3002' } } : {}),
    });

    addressDiv.textContent = `Connected: ${wallet.address.slice(0, 16)}...`;
    addressDiv.style.display = 'block';

    // Show action buttons
    actionsDiv.style.display = 'block';

    // Disable fee relay toggle after connecting (switching requires reconnection)
    (document.getElementById('fee-relay-checkbox') as HTMLInputElement).disabled = true;

    updateStatus(`Connected successfully! (${useFeeRelay ? 'fee relay' : 'own dust'})`);
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
    console.log('[browser-lace] Loading contract...');
    console.time('[browser-lace] loadContract');

    // ZkConfig URL - served by Vite dev server middleware
    // For production, host contract artifacts on a CDN
    const zkConfigUrl = '/zk-config';

    // Load contract with module + zkConfig
    // Use HttpZkConfigProvider which expects: /{circuitId}/zkir, /{circuitId}/prover-key, /{circuitId}/verifier-key
    const loaded = await client.loadContract({
      module: CounterContract,
      zkConfig: new Midday.ZkConfig.HttpZkConfigProvider(zkConfigUrl),
      privateStateId: 'browser-lace-counter',
    });
    console.timeEnd('[browser-lace] loadContract');

    updateStatus('Deploying contract (proof generation may take a while)...');
    console.log('[browser-lace] Deploying contract...');
    console.time('[browser-lace] deploy');
    contract = await loaded.deploy();
    console.timeEnd('[browser-lace] deploy');
    console.log('[browser-lace] Deployed at:', contract.address);

    updateStatus(`Contract deployed at: ${contract.address}`);
    updateCounter('0');

    // Show key comparison: Lace wallet key vs contract's coin public key
    const contractKey = String(contract.providers.walletProvider.getCoinPublicKey());
    const keyInfoDiv = document.getElementById('key-info');
    const laceKeyEl = document.getElementById('lace-key');
    const contractKeyEl = document.getElementById('contract-key');
    const keyMatchEl = document.getElementById('key-match');
    if (keyInfoDiv) keyInfoDiv.style.display = 'block';
    if (laceKeyEl) laceKeyEl.textContent = wallet!.coinPublicKey;
    if (contractKeyEl) contractKeyEl.textContent = contractKey;
    if (keyMatchEl) {
      const match = wallet!.coinPublicKey === contractKey;
      keyMatchEl.textContent = match ? 'Keys match - contract belongs to Lace wallet' : 'Keys DO NOT match';
      keyMatchEl.style.color = match ? '#059669' : '#dc2626';
    }
  } catch (error) {
    console.error('[browser-lace] Deploy failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error && error.cause ? `\nCause: ${error.cause}` : '';
    updateStatus(`Deploy failed: ${message}${cause}`, true);
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
    const result = await contract.actions.increment();
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

// Format balance for display (convert from smallest unit)
function formatBalance(value: bigint): string {
  const whole = value / 1_000_000_000n;
  const frac = value % 1_000_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(9, '0').replace(/0+$/, '')}`;
}

// Refresh and display wallet balances
async function refreshBalance() {
  if (!wallet) {
    updateStatus('Not connected - connect wallet first', true);
    return;
  }

  try {
    updateStatus('Fetching balances...');

    const balance = await wallet.getBalance();

    // Get native token balance - try both empty string and first available key
    const shieldedKeys = Object.keys(balance.shielded);
    const unshieldedKeys = Object.keys(balance.unshielded);
    const shieldedNative = balance.shielded[''] ?? (shieldedKeys.length > 0 ? balance.shielded[shieldedKeys[0]] : 0n);
    const unshieldedNative = balance.unshielded[''] ?? (unshieldedKeys.length > 0 ? balance.unshielded[unshieldedKeys[0]] : 0n);

    // Update UI
    const balanceInfo = document.getElementById('balance-info');
    const shieldedEl = document.getElementById('shielded-balance');
    const unshieldedEl = document.getElementById('unshielded-balance');
    const dustBalanceEl = document.getElementById('dust-balance');
    const dustCapEl = document.getElementById('dust-cap');

    if (balanceInfo) balanceInfo.style.display = 'block';
    if (shieldedEl) shieldedEl.textContent = formatBalance(shieldedNative);
    if (unshieldedEl) unshieldedEl.textContent = formatBalance(unshieldedNative);
    if (dustBalanceEl) dustBalanceEl.textContent = formatBalance(balance.dust.balance);
    if (dustCapEl) dustCapEl.textContent = formatBalance(balance.dust.cap);

    updateStatus('Balances updated');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    updateStatus(`Failed to get balances: ${message}`, true);
  }
}

// Fund wallet via faucet
async function fundWallet() {
  if (!wallet) {
    updateStatus('Not connected - connect wallet first', true);
    return;
  }

  try {
    updateStatus('Requesting funds from faucet...');

    const response = await fetch('http://localhost:3001/faucet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coinPublicKey: wallet.coinPublicKey,
        encryptionPublicKey: wallet.encryptionPublicKey,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      updateStatus(`Faucet error: ${data.error}`, true);
      return;
    }

    updateStatus(`Funded! TX: ${data.txId.slice(0, 16)}... (${data.amount} native tokens)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    updateStatus(`Faucet failed: ${message}`, true);
  }
}

// Set up event listeners
connectBtn.addEventListener('click', connectWallet);

// Export for global access (used by onclick in HTML)
(window as unknown as { deployContract: typeof deployContract }).deployContract = deployContract;
(window as unknown as { callAction: typeof callAction }).callAction = callAction;
(window as unknown as { readState: typeof readState }).readState = readState;
(window as unknown as { refreshBalance: typeof refreshBalance }).refreshBalance = refreshBalance;
(window as unknown as { fundWallet: typeof fundWallet }).fundWallet = fundWallet;

// Initial status
updateStatus('Select network and click "Connect Wallet" to begin');
