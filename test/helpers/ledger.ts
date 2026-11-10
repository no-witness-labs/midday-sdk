import * as ledger from '@midnightntwrk/ledger-v9';
import { LedgerTransaction, type UnboundTx } from '@midnight-ntwrk/midnight-js-types';

/** A real ledger 9 Unbound handle, built offline: an empty intent proves with no circuits. */
export async function unboundHandle(): Promise<UnboundTx> {
  const intent = ledger.Intent.new(new Date(Date.now() + 60_000));
  const unproven = ledger.Transaction.fromParts('undeployed', undefined, undefined, intent);
  const noProofs: ledger.ProvingProvider = {
    check: async () => [],
    prove: async () => new Uint8Array(0),
    lookupKey: async () => undefined,
  };
  return LedgerTransaction.seal('v9', 'Unbound', await unproven.prove(noProofs, ledger.CostModel.initialCostModel()));
}
