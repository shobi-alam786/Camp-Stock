import { calculateCurrentStock, InventoryTransaction } from '../types/inventory.ts';

/** Calculate a stock balance as of the end of the supplied local calendar date.
 * Dates are compared by ISO calendar date (yyyy-MM-dd); transaction timestamps should be ISO-8601.
 */
export function calculateStockAsOf(
  materialCode: string, locationId: string, transactions: InventoryTransaction[], asOfDate: string
): ReturnType<typeof calculateCurrentStock> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) throw new Error('asOfDate must be yyyy-MM-dd');
  const eligible = transactions.filter((tx) => {
    const date = tx.txDateTime?.slice(0, 10);
    return !!date && date <= asOfDate;
  });
  return calculateCurrentStock(materialCode, locationId, eligible);
}
