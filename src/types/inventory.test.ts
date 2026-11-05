import {
  calculateCurrentStock,
  DecimalSafe,
  INITIAL_MATERIAL_CATALOGUE,
  InventoryTransaction,
  validateMaterialForTransaction,
  UNIT_NEEDS_CONFIRMATION,
} from './inventory.ts';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log('--- Testing DecimalSafe Arithmetic ---');
assert(DecimalSafe.add('0.1', '0.2') === '0.3', '0.1 + 0.2 should equal 0.3 without float drift');
assert(DecimalSafe.subtract('1.0000', '0.9999') === '0.0001', '1 - 0.9999 should equal 0.0001');
assert(DecimalSafe.compare('10.5', '10.5000') === 0, '10.5 should equal 10.5000');
assert(DecimalSafe.compare('10.5001', '10.5') === 1, '10.5001 > 10.5');
console.log('✓ DecimalSafe tests passed.');

console.log('--- Testing Initial Material Catalogue & Unit Lock ---');
assert(INITIAL_MATERIAL_CATALOGUE.length === 45, 'Catalogue must have exactly 45 items');
assert(
  INITIAL_MATERIAL_CATALOGUE[0].code === 'MAT-0001' &&
  INITIAL_MATERIAL_CATALOGUE[0].name === 'Bamboo Borak' &&
  INITIAL_MATERIAL_CATALOGUE[0].unit === UNIT_NEEDS_CONFIRMATION,
  'MAT-0001 must have unit NEEDS_CONFIRMATION'
);
assert(
  INITIAL_MATERIAL_CATALOGUE[44].code === 'MAT-0045' &&
  INITIAL_MATERIAL_CATALOGUE[44].name === 'Treated Borak Bamboo',
  'MAT-0045 must be Treated Borak Bamboo'
);

const validationBlocked = validateMaterialForTransaction(INITIAL_MATERIAL_CATALOGUE[0]);
assert(!validationBlocked.allowed, 'Unconfirmed item must be blocked from stock transactions');

const confirmedItem = {
  ...INITIAL_MATERIAL_CATALOGUE[0],
  unit: 'PCS',
  isUnitConfirmed: true,
};
const validationAllowed = validateMaterialForTransaction(confirmedItem);
assert(validationAllowed.allowed, 'Confirmed item must be allowed for transactions');
console.log('✓ Material Catalogue and Lock tests passed.');

console.log('--- Testing Stock Calculation Rules (Rule 9 & 10) ---');
// Scenario:
// Opening stock: 100
// Receipt: 50
// Dispatch to field: 30
// Return from field: 10
// Positive adjustment: 5
// Negative adjustment: 2
// Expected Central Warehouse Stock = 100 + 50 + 10 - 30 + 5 - 2 = 133
const mockTxs: InventoryTransaction[] = [
  {
    clientTxUuid: 'tx-1',
    txType: 'OPENING_STOCK',
    txDateTime: '2026-10-20T08:00:00Z',
    sourceLocationId: '',
    destinationLocationId: 'LOC-CENTRAL',
    staffId: 'Staff-1',
    referenceNumber: 'OP-001',
    lines: [{ lineId: 'l-1', materialCode: 'MAT-0001', materialName: 'Bamboo Borak', quantity: '100.0000', unit: 'PCS' }],
    syncStatus: 'SYNCED',
    createdAt: '2026-10-20T08:00:00Z',
    modifiedAt: '2026-10-20T08:00:00Z',
  },
  {
    clientTxUuid: 'tx-2',
    txType: 'RECEIPT',
    txDateTime: '2026-10-20T09:00:00Z',
    sourceLocationId: 'SUPPLIER',
    destinationLocationId: 'LOC-CENTRAL',
    staffId: 'Staff-1',
    referenceNumber: 'GRN-001',
    lines: [{ lineId: 'l-2', materialCode: 'MAT-0001', materialName: 'Bamboo Borak', quantity: '50.0000', unit: 'PCS' }],
    syncStatus: 'SYNCED',
    createdAt: '2026-10-20T09:00:00Z',
    modifiedAt: '2026-10-20T09:00:00Z',
  },
  {
    clientTxUuid: 'tx-3',
    txType: 'DISPATCH',
    txDateTime: '2026-10-20T10:00:00Z',
    sourceLocationId: 'LOC-CENTRAL',
    destinationLocationId: 'FIELD-SITE-1',
    staffId: 'Staff-2',
    referenceNumber: 'DSP-001',
    lines: [{ lineId: 'l-3', materialCode: 'MAT-0001', materialName: 'Bamboo Borak', quantity: '30.0000', unit: 'PCS' }],
    syncStatus: 'SYNCED',
    createdAt: '2026-10-20T10:00:00Z',
    modifiedAt: '2026-10-20T10:00:00Z',
  },
  {
    clientTxUuid: 'tx-5',
    txType: 'RETURN',
    txDateTime: '2026-10-20T12:00:00Z',
    sourceLocationId: 'FIELD-SITE-1',
    destinationLocationId: 'LOC-CENTRAL',
    staffId: 'Staff-1',
    referenceNumber: 'RET-001',
    lines: [{ lineId: 'l-5', materialCode: 'MAT-0001', materialName: 'Bamboo Borak', quantity: '10.0000', unit: 'PCS' }],
    syncStatus: 'SYNCED',
    createdAt: '2026-10-20T12:00:00Z',
    modifiedAt: '2026-10-20T12:00:00Z',
  },
  {
    clientTxUuid: 'tx-6',
    txType: 'ADJUSTMENT_POS',
    txDateTime: '2026-10-20T13:00:00Z',
    sourceLocationId: 'LOC-CENTRAL',
    destinationLocationId: 'LOC-CENTRAL',
    staffId: 'Auditor-1',
    referenceNumber: 'ADJ-001',
    lines: [{ lineId: 'l-6', materialCode: 'MAT-0001', materialName: 'Bamboo Borak', quantity: '5.0000', unit: 'PCS' }],
    syncStatus: 'SYNCED',
    createdAt: '2026-10-20T13:00:00Z',
    modifiedAt: '2026-10-20T13:00:00Z',
  },
  {
    clientTxUuid: 'tx-7',
    txType: 'ADJUSTMENT_NEG',
    txDateTime: '2026-10-20T14:00:00Z',
    sourceLocationId: 'LOC-CENTRAL',
    destinationLocationId: 'LOC-CENTRAL',
    staffId: 'Auditor-1',
    referenceNumber: 'ADJ-002',
    lines: [{ lineId: 'l-7', materialCode: 'MAT-0001', materialName: 'Bamboo Borak', quantity: '2.0000', unit: 'PCS' }],
    syncStatus: 'SYNCED',
    createdAt: '2026-10-20T14:00:00Z',
    modifiedAt: '2026-10-20T14:00:00Z',
  },
];

const stockAtCentral = calculateCurrentStock('MAT-0001', 'LOC-CENTRAL', mockTxs);
console.log('Stock at Central Warehouse:', stockAtCentral);
assert(stockAtCentral.openingStock === '100', 'Opening should be 100');
assert(stockAtCentral.receipts === '50', 'Receipts should be 50');
assert(stockAtCentral.acceptedReturns === '10', 'Returns should be 10');
assert(stockAtCentral.dispatches === '30', 'Dispatches should be 30');
assert(stockAtCentral.positiveAdjustments === '5', 'Pos adjustments should be 5');
assert(stockAtCentral.negativeAdjustments === '2', 'Neg adjustments should be 2');
assert(stockAtCentral.currentStock === '133', 'Current stock must be 133');

// A different location never sees this stock
assert(calculateCurrentStock('MAT-0001', 'LOC-BLOCK-A', mockTxs).currentStock === '0', 'Other location must have no stock');

console.log('✓ All Stock Calculation rules verified successfully!');
