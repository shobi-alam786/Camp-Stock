/**
 * Camp Stock Inventory Management System
 * Core Data Models, Types, and Stock Rules
 */

export const UNIT_NEEDS_CONFIRMATION = 'NEEDS_CONFIRMATION' as const;

export type MaterialUnit =
  | typeof UNIT_NEEDS_CONFIRMATION
  | 'PCS'
  | 'BAGS'
  | 'CFT'
  | 'KG'
  | 'METERS'
  | 'ROLLS'
  | 'SHEETS'
  | 'TINS'
  | string;

export interface MaterialCatalogueItem {
  code: string;
  name: string;
  unit: MaterialUnit;
  isUnitConfirmed: boolean;
  notes?: string;
  /** true = added on a device by a user; never one of the 45 catalogue items */
  isCustom?: boolean;
  /** false = hidden from the material pickers (history is kept). Missing = active. Stored on this device only. */
  isActive?: boolean;
}

export interface Supplier {
  supplierId: string;
  name: string;
  phone?: string;
  contactPerson?: string;
  notes?: string;
  isActive: boolean;
}

/** Suppliers read from the printed delivery list (11 Oct 2026). Editable. */
export const DEFAULT_SUPPLIERS: ReadonlyArray<Supplier> = [
  { supplierId: 'SUP-0001', name: 'M/S Zia Enterprise', isActive: true },
  { supplierId: 'SUP-0002', name: 'M/S Chaytara Construction', isActive: true },
  { supplierId: 'SUP-0003', name: 'Ayan Corporation', isActive: true },
  { supplierId: 'SUP-0004', name: 'S. R Enterprise', isActive: true },
  { supplierId: 'SUP-0005', name: 'M/S Azizi Enterprise', isActive: true },
];

/**
 * Initial Material Catalogue: exactly 45 items.
 * Names and codes preserved verbatim. Units initially set to NEEDS_CONFIRMATION.
 */
export const INITIAL_MATERIAL_CATALOGUE: ReadonlyArray<MaterialCatalogueItem> = [
  { code: 'MAT-0001', name: 'Bamboo Borak', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0002', name: 'Bamboo Mulli', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0003', name: 'Brick Chips', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0004', name: 'Bricks', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0005', name: 'Cement', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0006', name: 'Sand', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0007', name: 'Steel Reinforcing Bar 8mm', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0008', name: 'Steel Reinforcing Bar 10mm', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0009', name: 'Steel Reinforcing Bar 12mm', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0010', name: 'Georoll (Grey) 100 x 5 m', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0011', name: 'Brick Dust', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0012', name: 'Dry Hydrate', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0013', name: 'Nails 1 in', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0014', name: 'Nails 1.5 in', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0015', name: 'Nails 2 in', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0016', name: 'Threaded Rod 12mm (6 ft)', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0017', name: 'Washers', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0018', name: 'Buttress Column 6x6x96 in', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0019', name: 'Precast Beam 5x4x69 in', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0020', name: 'Precast Beam 5x5x69 in', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0021', name: 'Invert Slab 24x24x in', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false, notes: 'Missing final dimension in original catalogue' },
  { code: 'MAT-0022', name: 'Permeable Block 24x16x3 in', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0023', name: 'PVC Pipe 4 in', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0024', name: 'PVC Pipe 8 in', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0025', name: 'Plain Sheet', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0026', name: 'Nylon Rope 3mm', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0027', name: 'Nylon Rope 6mm', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0028', name: 'Steel Tie Wire #18', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0029', name: 'Steel Tie Wire #22', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0030', name: 'Sandbag Geotextile', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0031', name: 'Sandbag Jute', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0032', name: 'Arm', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false, notes: 'Meaning unconfirmed' },
  { code: 'MAT-0033', name: 'Light', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0034', name: 'Nails', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0035', name: 'Solar Panel', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0036', name: 'Black Plastic 4ft x 50m', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0037', name: 'Shelter Grade Tarpaulin (6x4)', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0038', name: 'Plywood 4ft x 8ft x 1/2 in', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0039', name: 'Paint 3.64 L', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0040', name: 'Paint Brush 25mm', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0041', name: 'Paint Brush 50mm', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0042', name: 'Steel Stackers', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0043', name: 'Steel Tie Wire #14', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0044', name: 'Nail 3 in', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
  { code: 'MAT-0045', name: 'Treated Borak Bamboo', unit: UNIT_NEEDS_CONFIRMATION, isUnitConfirmed: false },
];

/**
 * 9 Standard Warehouse & Camp Locations
 */
export interface CampLocation {
  id: string;
  name: string;
  type: 'CENTRAL_WAREHOUSE' | 'BLOCK' | 'OTHER_WAREHOUSE';
  code: string;
}

export const CAMP_LOCATIONS: ReadonlyArray<CampLocation> = [
  { id: 'LOC-CENTRAL', name: 'Central Camp Warehouse', type: 'CENTRAL_WAREHOUSE', code: 'CW' },
  { id: 'LOC-BLOCK-A', name: 'Block A', type: 'BLOCK', code: 'A' },
  { id: 'LOC-BLOCK-B', name: 'Block B', type: 'BLOCK', code: 'B' },
  { id: 'LOC-BLOCK-C', name: 'Block C', type: 'BLOCK', code: 'C' },
  { id: 'LOC-BLOCK-D', name: 'Block D', type: 'BLOCK', code: 'D' },
  { id: 'LOC-BLOCK-E', name: 'Block E', type: 'BLOCK', code: 'E' },
  { id: 'LOC-BLOCK-F', name: 'Block F', type: 'BLOCK', code: 'F' },
  { id: 'LOC-BLOCK-G', name: 'Block G', type: 'BLOCK', code: 'G' },
  { id: 'LOC-OTHER', name: 'Other Camp Warehouse', type: 'OTHER_WAREHOUSE', code: 'OW' },
];

/**
 * Inventory Transaction Types
 */
export type TransactionType =
  | 'OPENING_STOCK'       // Legacy opening entries retained for migration/history
  | 'STOCK_BASELINE'      // Replaceable absolute current-stock baseline per material/location
  | 'RECEIPT'             // Materials received at warehouse (Supplier/Purchase)
  | 'DISPATCH'            // Materials dispatched directly from warehouse to destination
  | 'RETURN'              // Materials returned from field to warehouse
  | 'ADJUSTMENT_POS'      // Positive inventory count adjustment (+ discrepancy)
  | 'ADJUSTMENT_NEG'      // Negative inventory count adjustment (- discrepancy)
  | 'STAFF_HANDOVER';     // Staff changes camp: stock balance handed to the next staff. Never changes stock.

/**
 * Synchronization Status
 */
export type SyncStatus =
  | 'PENDING'             // Saved locally, awaiting sync
  | 'SYNCING'             // Currently being transmitted
  | 'SYNCED'              // Confirmed on KoboToolbox with submission ID
  | 'OUTCOME_UNKNOWN'     // Ambiguous network timeout; requires query check before retry
  | 'FAILED'              // Permanent validation error or API rejection
  | 'CONFLICT';           // Mismatch or duplicate flagged

/**
 * Single Material Line in a Transaction (e.g. within a multi-material dispatch)
 */
export interface TransactionLine {
  lineId: string;
  materialCode: string;
  materialName: string;
  quantity: string;       // Decimal-safe string (e.g. "125.0000")
  unit: string;
  notes?: string;
  /** Quantity from this returned line that is damaged; never treated as usable stock. */
  damagedQuantity?: string;
}

/**
 * Inventory Transaction Header
 */
export interface InventoryTransaction {
  clientTxUuid: string;       // Client-generated UUID (idempotency key)
  txType: TransactionType;
  txDateTime: string;         // ISO-8601 string (e.g. 2026-10-20T08:30:00Z)
  sourceLocationId: string;   // Location ID
  destinationLocationId: string; // Destination location ID (or external)
  staffId: string;            // Warehouse officer / staff name or ID
  referenceNumber: string;    // Waybill, GRN, or Dispatch voucher ref
  notes?: string;
  // Paper-register fields; optional for compatibility with historical transactions.
  vehicleNumber?: string;
  receivedBy?: string;
  issuedBy?: string;
  acknowledgementBy?: string;
  // --- DRR dispatch fields (DISPATCH / RETURN to or from a block) ---
  drrCode?: string;
  block?: string;             // "A".."G"
  subBlock?: string;
  mrfNumber?: string;
  // --- Staff handover fields (STAFF_HANDOVER only) ---
  handoverFromName?: string;
  handoverFromPhone?: string;
  handoverToName?: string;
  handoverToPhone?: string;
  handoverDate?: string;      // yyyy-MM-dd
  // --- Receipt fields ---
  supplierId?: string;
  supplierName?: string;
  poNumber?: string;
  lines: TransactionLine[];   // 1 to N material lines
  syncStatus: SyncStatus;
  koboSubmissionId?: number;  // Kobo "_id" of the ONE submission this record maps to (set after the first successful send / pull)
  koboInstanceId?: string;    // Kobo "_uuid" as instance id, e.g. uuid:...
  lastSyncAttempt?: string;   // Timestamp
  syncErrorMessage?: string;
  createdAt: string;
  modifiedAt: string;
}

/**
 * A STOCK_BASELINE whose reference number starts with this prefix is a stock-count SNAPSHOT:
 * its quantity is EXACTLY what the user typed as the stock on hand at its date/time, and only movements
 * dated after it change the stock. Older baselines (other prefixes) keep the previous rule
 * (baseline + every movement), so existing data is not re-interpreted.
 */
export const SNAPSHOT_REF_PREFIX = 'SNAP-';

export const isSnapshotBaseline = (tx: { txType: string; referenceNumber?: string }): boolean =>
  tx.txType === 'STOCK_BASELINE' && (tx.referenceNumber || '').startsWith(SNAPSHOT_REF_PREFIX);

/** Milliseconds for an ISO date/time (any offset). Unparseable text counts as 0. */
export const instantOf = (value: string | undefined | null): number => {
  const t = Date.parse(String(value ?? ''));
  return Number.isNaN(t) ? 0 : t;
};

/**
 * Physical Stock Count Audit
 */
export interface PhysicalStockCount {
  countId: string;
  countDate: string;
  locationId: string;
  materialCode: string;
  unit: string;
  systemCalculatedQty: string;
  physicalCountedQty: string;
  discrepancyQty: string;     // physical - system
  auditedByStaffId: string;
  approvedAdjustmentTxUuid?: string;
  notes?: string;
  status: 'PENDING_REVIEW' | 'ADJUSTMENT_CREATED' | 'DISMISSED';
}

/**
 * Decimal-Safe Arithmetic Utilities
 * Uses integer scaling (4 decimal places: 1 unit = 10,000 sub-units)
 * to prevent IEEE 754 binary floating-point drift.
 */
export const DecimalSafe = {
  SCALE: 10_000n,
  DECIMAL_PLACES: 4,

  toScaledInt(val: string | number): bigint {
    const s = String(val).trim();
    if (!s) return 0n;
    const parts = s.split('.');
    const integerPart = BigInt(parts[0] || '0');
    let fractionalStr = (parts[1] || '').padEnd(4, '0').slice(0, 4);
    const fractionalPart = BigInt(fractionalStr);
    return integerPart < 0n
      ? integerPart * 10000n - fractionalPart
      : integerPart * 10000n + fractionalPart;
  },

  fromScaledInt(scaled: bigint): string {
    const isNegative = scaled < 0n;
    const absVal = isNegative ? -scaled : scaled;
    const integerPart = absVal / 10000n;
    const fractionalPart = absVal % 10000n;
    const paddedFrac = fractionalPart.toString().padStart(4, '0').replace(/0+$/, '');
    const fracStr = paddedFrac.length > 0 ? `.${paddedFrac}` : '';
    return `${isNegative ? '-' : ''}${integerPart.toString()}${fracStr}`;
  },

  add(a: string, b: string): string {
    return this.fromScaledInt(this.toScaledInt(a) + this.toScaledInt(b));
  },

  subtract(a: string, b: string): string {
    return this.fromScaledInt(this.toScaledInt(a) - this.toScaledInt(b));
  },

  compare(a: string, b: string): number {
    const diff = this.toScaledInt(a) - this.toScaledInt(b);
    return diff > 0n ? 1 : diff < 0n ? -1 : 0;
  },

  isPositive(a: string): boolean {
    return this.toScaledInt(a) > 0n;
  },

  isNegative(a: string): boolean {
    return this.toScaledInt(a) < 0n;
  },

  isZero(a: string): boolean {
    return this.toScaledInt(a) === 0n;
  },
};

/**
 * Stock Calculation Function (Rule 9)
 *
 * Current stock = opening stock
 *               + receipts
 *               + accepted returns
 *               − dispatches
 *               + positive adjustments
 *               − negative adjustments.
 *
 */
export function calculateCurrentStock(
  materialCode: string,
  locationId: string,
  transactions: InventoryTransaction[]
): {
  openingStock: string;
  receipts: string;
  acceptedReturns: string;
  dispatches: string;
  positiveAdjustments: string;
  negativeAdjustments: string;
  currentStock: string;
} {
  let legacyOpening = 0n;
  let baseline: { time: string; qty: bigint; snapshot: boolean } | null = null;
  let receipts = 0n;
  let returns = 0n;
  let dispatches = 0n;
  let posAdj = 0n;
  let negAdj = 0n;
  // Every movement with its date/time and signed effect: a snapshot baseline needs to know which ones come after it.
  const moves: Array<{ time: string; delta: bigint }> = [];

  for (const tx of transactions) {
    for (const line of tx.lines) {
      if (line.materialCode !== materialCode) continue;
      const qtyScaled = DecimalSafe.toScaledInt(line.quantity);

      switch (tx.txType) {
        case 'OPENING_STOCK':
          if (tx.destinationLocationId === locationId) legacyOpening += qtyScaled;
          break;

        case 'STOCK_BASELINE':
          if (tx.destinationLocationId === locationId && (!baseline || instantOf(tx.txDateTime) > instantOf(baseline.time) || (instantOf(tx.txDateTime) === instantOf(baseline.time) && tx.txDateTime > baseline.time))) {
            baseline = { time: tx.txDateTime, qty: qtyScaled, snapshot: isSnapshotBaseline(tx) };
          }
          break;

        case 'RECEIPT':
          if (tx.destinationLocationId === locationId) {
            receipts += qtyScaled;
            moves.push({ time: tx.txDateTime, delta: qtyScaled });
          }
          break;

        case 'RETURN':
          // Accepted return adds back to warehouse stock
          if (tx.destinationLocationId === locationId) {
            const damagedScaled = DecimalSafe.toScaledInt(line.damagedQuantity || '0');
            returns += qtyScaled - damagedScaled;
            moves.push({ time: tx.txDateTime, delta: qtyScaled - damagedScaled });
          }
          break;

        case 'DISPATCH':
          if (tx.sourceLocationId === locationId) {
            dispatches += qtyScaled;
            moves.push({ time: tx.txDateTime, delta: -qtyScaled });
          }
          break;

        case 'ADJUSTMENT_POS':
          if (tx.destinationLocationId === locationId || tx.sourceLocationId === locationId) {
            posAdj += qtyScaled;
            moves.push({ time: tx.txDateTime, delta: qtyScaled });
          }
          break;

        case 'ADJUSTMENT_NEG':
          if (tx.sourceLocationId === locationId || tx.destinationLocationId === locationId) {
            negAdj += qtyScaled;
            moves.push({ time: tx.txDateTime, delta: -qtyScaled });
          }
          break;
      }
    }
  }

  let opening: bigint;
  if (baseline && baseline.snapshot) {
    // Snapshot: current stock = the exact quantity entered + movements dated after it.
    // "opening" is shown as the value that makes opening + all movements = that current stock.
    const at = instantOf(baseline.time);
    let upToSnapshot = 0n;
    for (const m of moves) if (instantOf(m.time) <= at) upToSnapshot += m.delta;
    opening = baseline.qty - upToSnapshot;
  } else {
    opening = baseline?.qty ?? legacyOpening;
  }
  const current =
    opening +
    receipts +
    returns +
    posAdj -
    dispatches -
    negAdj;

  return {
    openingStock: DecimalSafe.fromScaledInt(opening),
    receipts: DecimalSafe.fromScaledInt(receipts),
    acceptedReturns: DecimalSafe.fromScaledInt(returns),
    dispatches: DecimalSafe.fromScaledInt(dispatches),
    positiveAdjustments: DecimalSafe.fromScaledInt(posAdj),
    negativeAdjustments: DecimalSafe.fromScaledInt(negAdj),
    currentStock: DecimalSafe.fromScaledInt(current),
  };
}

/**
 * Validation: verifies whether a material line is permitted for stock movement.
 * Fails if unit is NEEDS_CONFIRMATION or empty.
 */
export function validateMaterialForTransaction(item: MaterialCatalogueItem): {
  allowed: boolean;
  reason?: string;
} {
  if (!item.isUnitConfirmed || item.unit === UNIT_NEEDS_CONFIRMATION || !item.unit.trim()) {
    return {
      allowed: false,
      reason: `Material ${item.code} (${item.name}) has an unconfirmed unit (${item.unit}). Unit must be confirmed before stock transactions can be performed.`,
    };
  }
  return { allowed: true };
}
