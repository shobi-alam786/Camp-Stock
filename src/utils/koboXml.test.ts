import { buildOpenRosaXml, parseKoboSubmissionJson } from './koboXml.ts';
import { InventoryTransaction } from '../types/inventory.ts';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('--- Testing Repeat Group XML Construction & Parsing ---');

// Regression test: OpenRosa submissions must include Kobo's deployed form UUID.
const formUuidXml = buildOpenRosaXml({
  clientTxUuid: '550e8400-e29b-41d4-a716-446655440000',
  txType: 'RECEIPT',
  txDateTime: '2026-10-20T08:00:00Z',
  sourceLocationId: 'LOC-CENTRAL',
  destinationLocationId: 'LOC-CENTRAL',
  staffId: 'Test Staff',
  referenceNumber: 'TEST-001',
  lines: [{ lineId: 'line-1', materialCode: 'MAT-0001', materialName: 'Test', quantity: '1', unit: 'PCS' }],
  syncStatus: 'PENDING',
  createdAt: '2026-10-20T08:00:00Z',
  modifiedAt: '2026-10-20T08:00:00Z',
}, 'camp_stock_transactions', 'd64dc1e280714b1cbc745698e8d09999');
assert(formUuidXml.includes('<formhub><uuid>d64dc1e280714b1cbc745698e8d09999</uuid></formhub>'), 'OpenRosa XML must include deployed form UUID');

// Test Case 1: 1-line Dispatch
const tx1Line: InventoryTransaction = {
  clientTxUuid: '550e8400-e29b-41d4-a716-446655440001',
  txType: 'DISPATCH',
  txDateTime: '2026-10-20T08:00:00Z',
  sourceLocationId: 'LOC-CENTRAL',
  destinationLocationId: 'LOC-BLOCK-A',
  staffId: 'Staff-Alpha',
  referenceNumber: 'DSP-2026-001',
  lines: [
    {
      lineId: 'l-1',
      materialCode: 'MAT-0001',
      materialName: 'Bamboo Borak',
      quantity: '50.0000',
      unit: 'PCS',
      notes: 'Initial shelter frame',
    },
  ],
  syncStatus: 'PENDING',
  createdAt: '2026-10-20T08:00:00Z',
  modifiedAt: '2026-10-20T08:00:00Z',
};

const xml1 = buildOpenRosaXml(tx1Line);
console.log('1-Line XML length:', xml1.length);
assert(xml1.includes('<material_code>MAT-0001</material_code>'), 'XML must contain MAT-0001');
assert(xml1.includes('<quantity>50.0000</quantity>'), 'XML must contain quantity 50.0000');
assert(xml1.includes('<instanceID>uuid:550e8400-e29b-41d4-a716-446655440001</instanceID>'), 'XML must include instanceID');

// Test Case 2: 3-line Dispatch
const tx3Line: InventoryTransaction = {
  clientTxUuid: '550e8400-e29b-41d4-a716-446655440002',
  txType: 'DISPATCH',
  txDateTime: '2026-10-20T09:30:00Z',
  sourceLocationId: 'LOC-CENTRAL',
  destinationLocationId: 'LOC-BLOCK-B',
  staffId: 'Staff-Beta',
  referenceNumber: 'DSP-2026-002',
  lines: [
    { lineId: 'l-1', materialCode: 'MAT-0001', materialName: 'Bamboo Borak', quantity: '20.0000', unit: 'PCS' },
    { lineId: 'l-2', materialCode: 'MAT-0013', materialName: 'Nails 1 in', quantity: '5.0000', unit: 'KG' },
    { lineId: 'l-3', materialCode: 'MAT-0026', materialName: 'Nylon Rope 3mm', quantity: '10.0000', unit: 'ROLLS' },
  ],
  syncStatus: 'PENDING',
  createdAt: '2026-10-20T09:30:00Z',
  modifiedAt: '2026-10-20T09:30:00Z',
};

const xml3 = buildOpenRosaXml(tx3Line);
const count3 = (xml3.match(/<material_lines>/g) || []).length;
assert(count3 === 3, `Expected 3 repeat group tags in XML, found ${count3}`);

// Test Case 3: Large Multi-line Dispatch (10 lines)
const tx10Line: InventoryTransaction = {
  clientTxUuid: '550e8400-e29b-41d4-a716-446655440003',
  txType: 'DISPATCH',
  txDateTime: '2026-10-20T11:00:00Z',
  sourceLocationId: 'LOC-CENTRAL',
  destinationLocationId: 'LOC-BLOCK-C',
  staffId: 'Staff-Gamma',
  referenceNumber: 'DSP-2026-003',
  lines: Array.from({ length: 10 }).map((_, i) => ({
    lineId: `line-${i + 1}`,
    materialCode: `MAT-000${i + 1}`,
    materialName: `Material ${i + 1}`,
    quantity: `${(i + 1) * 10}.0000`,
    unit: 'PCS',
  })),
  syncStatus: 'PENDING',
  createdAt: '2026-10-20T11:00:00Z',
  modifiedAt: '2026-10-20T11:00:00Z',
};

const xml10 = buildOpenRosaXml(tx10Line);
const count10 = (xml10.match(/<material_lines>/g) || []).length;
assert(count10 === 10, `Expected 10 repeat group tags in XML, found ${count10}`);
console.log('✓ 1-line, 3-line, and 10-line XML repeat-group construction verified.');

// Test Case 4: Round-trip JSON Parsing (as received from Kobo REST API v2)
const simulatedKoboJsonRecord = {
  _id: 987654321,
  _submission_time: '2026-10-20T09:30:15Z',
  client_tx_uuid: '550e8400-e29b-41d4-a716-446655440002',
  tx_type: 'DISPATCH',
  tx_date_time: '2026-10-20T09:30:00Z',
  source_location: 'LOC-CENTRAL',
  destination_location: 'LOC-BLOCK-B',
  staff_id: 'Staff-Beta',
  ref_no: 'DSP-2026-002',
  'meta/instanceID': 'uuid:550e8400-e29b-41d4-a716-446655440002',
  material_lines: [
    {
      'material_lines/material_code': 'MAT-0001',
      'material_lines/quantity': '20.0000',
      'material_lines/unit': 'PCS',
      'material_lines/line_notes': '',
    },
    {
      'material_lines/material_code': 'MAT-0013',
      'material_lines/quantity': '5.0000',
      'material_lines/unit': 'KG',
      'material_lines/line_notes': '',
    },
    {
      'material_lines/material_code': 'MAT-0026',
      'material_lines/quantity': '10.0000',
      'material_lines/unit': 'ROLLS',
      'material_lines/line_notes': '',
    },
  ],
};

const parsedTx = parseKoboSubmissionJson(simulatedKoboJsonRecord);
assert(parsedTx.clientTxUuid === '550e8400-e29b-41d4-a716-446655440002', 'UUID match');
assert(parsedTx.lines.length === 3, 'Must have parsed 3 lines');
assert(parsedTx.lines[0].materialCode === 'MAT-0001', 'Line 1 material code match');
assert(parsedTx.lines[0].quantity === '20.0000', 'Line 1 quantity match');
assert(parsedTx.lines[1].materialCode === 'MAT-0013', 'Line 2 material code match');
assert(parsedTx.lines[2].materialCode === 'MAT-0026', 'Line 3 material code match');
assert(parsedTx.koboSubmissionId === 987654321, 'Kobo submission ID recorded');
assert(parsedTx.syncStatus === 'SYNCED', 'Status marked SYNCED');

console.log('✓ Kobo REST API v2 repeat-group JSON parsing verified.');

// Test Case 5: Duplicate Prevention via Query Verification
console.log('--- Testing Query-Before-Retry Idempotency Logic ---');
function simulateCheckBeforeRetry(
  txToSync: InventoryTransaction,
  remoteSubmissions: any[]
): { shouldSubmit: boolean; existingSubmissionId?: number } {
  // Query Kobo by client_tx_uuid
  const existing = remoteSubmissions.find((s) => s.client_tx_uuid === txToSync.clientTxUuid);
  if (existing) {
    return { shouldSubmit: false, existingSubmissionId: existing._id };
  }
  return { shouldSubmit: true };
}

const remoteRecords = [simulatedKoboJsonRecord];

// 5a: A transaction that timed out previously, but actually succeeded on server
const ambiguousTx = { ...tx3Line };
const check1 = simulateCheckBeforeRetry(ambiguousTx, remoteRecords);
assert(!check1.shouldSubmit, 'Ambiguous transaction already exists on Kobo; MUST NOT re-submit');
assert(check1.existingSubmissionId === 987654321, 'Existing submission ID retrieved to reconcile');

// 5b: A new transaction never sent
const brandNewTx = { ...tx1Line };
const check2 = simulateCheckBeforeRetry(brandNewTx, remoteRecords);
assert(check2.shouldSubmit, 'Brand new transaction not found on Kobo; allowed to submit');

console.log('✓ Query-before-retry idempotency logic verified successfully.');

// Paper register fields and damaged-return quantity are mapped into Kobo XML.
const paperFieldsTx: InventoryTransaction = {
  clientTxUuid: 'paper-fields-test', txType: 'RETURN', txDateTime: '2026-10-22T10:00:00Z',
  sourceLocationId: 'LOC-BLOCK-A', destinationLocationId: 'LOC-CENTRAL', staffId: 'Receiver', referenceNumber: 'RET-1',
  vehicleNumber: 'TRUCK-7', receivedBy: 'Storekeeper', issuedBy: 'Issuer', acknowledgementBy: 'Block representative',
  lines: [{ lineId: 'paper-line', materialCode: 'MAT-0005', materialName: 'Cement', quantity: '10', damagedQuantity: '3', unit: 'BAGS' }],
  syncStatus: 'PENDING', createdAt: '2026-10-22T10:00:00Z', modifiedAt: '2026-10-22T10:00:00Z'
};
const paperXml = buildOpenRosaXml(paperFieldsTx);
assert(paperXml.includes('<vehicle_number>TRUCK-7</vehicle_number>'), 'XML includes vehicle number');
assert(paperXml.includes('<received_by>Storekeeper</received_by>'), 'XML includes receiver');
assert(paperXml.includes('<issued_by>Issuer</issued_by>'), 'XML includes issuer');
assert(paperXml.includes('<acknowledgement_by>Block representative</acknowledgement_by>'), 'XML includes dispatch acknowledgement');
assert(paperXml.includes('<damaged_quantity>3</damaged_quantity>'), 'XML includes damaged return quantity');
