/**
 * Camp Stock Inventory Management System
 * OpenRosa XML Construction & Kobo REST API Parser for Multi-Material Repeat Groups
 */

import { InventoryTransaction, TransactionLine } from '../types/inventory.ts';

function escapeXml(str: string | undefined | null): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Builds standard OpenRosa 1.0 XML submission payload including Repeat Groups for material lines.
 */
export function buildOpenRosaXml(
  tx: InventoryTransaction,
  formId: string = 'camp_stock_transactions',
  formUuid: string = ''
): string {
  const instanceId = tx.koboInstanceId || `uuid:${tx.clientTxUuid}`;

  const headerTags = [
    `<client_tx_uuid>${escapeXml(tx.clientTxUuid)}</client_tx_uuid>`,
    `<tx_type>${escapeXml(tx.txType)}</tx_type>`,
    `<tx_date_time>${escapeXml(tx.txDateTime)}</tx_date_time>`,
    `<source_location>${escapeXml(tx.sourceLocationId)}</source_location>`,
    `<destination_location>${escapeXml(tx.destinationLocationId)}</destination_location>`,
    `<staff_id>${escapeXml(tx.staffId)}</staff_id>`,
    `<ref_no>${escapeXml(tx.referenceNumber)}</ref_no>`,
    `<notes>${escapeXml(tx.notes || '')}</notes>`,
    `<vehicle_number>${escapeXml(tx.vehicleNumber || '')}</vehicle_number>`,
    `<received_by>${escapeXml(tx.receivedBy || '')}</received_by>`,
    `<issued_by>${escapeXml(tx.issuedBy || '')}</issued_by>`,
    `<acknowledgement_by>${escapeXml(tx.acknowledgementBy || '')}</acknowledgement_by>`,
    `<drr_code>${escapeXml(tx.drrCode || '')}</drr_code>`,
    `<block>${escapeXml(tx.block || '')}</block>`,
    `<sub_block>${escapeXml(tx.subBlock || '')}</sub_block>`,
    `<mrf_number>${escapeXml(tx.mrfNumber || '')}</mrf_number>`,
    `<supplier_id>${escapeXml(tx.supplierId || '')}</supplier_id>`,
    `<supplier_name>${escapeXml(tx.supplierName || '')}</supplier_name>`,
    `<po_number>${escapeXml(tx.poNumber || '')}</po_number>`,
    `<handover_from_name>${escapeXml(tx.handoverFromName || '')}</handover_from_name>`,
    `<handover_from_phone>${escapeXml(tx.handoverFromPhone || '')}</handover_from_phone>`,
    `<handover_to_name>${escapeXml(tx.handoverToName || '')}</handover_to_name>`,
    `<handover_to_phone>${escapeXml(tx.handoverToPhone || '')}</handover_to_phone>`,
    `<handover_date>${escapeXml(tx.handoverDate || '')}</handover_date>`,
  ].join('');

  const repeatGroupTags = tx.lines
    .map((line) => {
      return [
        `<material_lines>`,
        `<material_code>${escapeXml(line.materialCode)}</material_code>`,
        `<material_name>${escapeXml(line.materialName || '')}</material_name>`,
        `<quantity>${escapeXml(line.quantity)}</quantity>`,
        `<damaged_quantity>${escapeXml(line.damagedQuantity || '0')}</damaged_quantity>`,
        `<unit>${escapeXml(line.unit)}</unit>`,
        `<line_notes>${escapeXml(line.notes || '')}</line_notes>`,
        `</material_lines>`,
      ].join('');
    })
    .join('');

  // Kobo's OpenRosa endpoint needs the deployed form UUID as formhub/uuid.
  // This is deployment__uuid from the asset API, not the asset UID or id_string.
  const formhubTag = formUuid ? `<formhub><uuid>${escapeXml(formUuid)}</uuid></formhub>` : '';
  const metaTag = `<meta><instanceID>${escapeXml(instanceId)}</instanceID></meta>`;

  return `<?xml version="1.0" encoding="UTF-8"?><${formId} id="${formId}">${formhubTag}${headerTags}${repeatGroupTags}${metaTag}</${formId}>`;
}

/**
 * Formats a multipart/form-data boundary payload for OpenRosa submission to /submission.
 */
const tag = (name: string, value: string | undefined | null) => `<${name}>${escapeXml(value || '')}</${name}>`;

function wrapForm(formId: string, formUuid: string, instanceId: string, body: string): string {
  const formhub = formUuid ? `<formhub><uuid>${escapeXml(formUuid)}</uuid></formhub>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?><${formId} id="${formId}">${formhub}${body}<meta><instanceID>${escapeXml(instanceId)}</instanceID></meta></${formId}>`;
}

/**
 * The three Kobo forms and the record types each one holds:
 *   RECORDS  - "Camp Stock - Records": received, dispatched, returned
 *   HANDOVER - "Camp Stock - Staff Handover & Supplies": staff handovers
 *   STOCK    - "Camp Stock - Stock Balance": starting balance (baseline / opening) and stock adjustments
 */
export type KoboFormGroup = 'RECORDS' | 'HANDOVER' | 'STOCK';

export function formGroupFor(txType: string): KoboFormGroup {
  if (txType === 'STAFF_HANDOVER') return 'HANDOVER';
  if (txType === 'STOCK_BASELINE' || txType === 'OPENING_STOCK' || txType === 'ADJUSTMENT_POS' || txType === 'ADJUSTMENT_NEG') return 'STOCK';
  return 'RECORDS';
}

/** Builds the submission for whichever of the three forms the transaction belongs to. Only that form's fields are sent. */
export function buildFormXml(tx: InventoryTransaction, formId: string, formUuid: string): string {
  const group = formGroupFor(tx.txType);
  const common =
    tag('client_tx_uuid', tx.clientTxUuid) + tag('tx_type', tx.txType) + tag('tx_date_time', tx.txDateTime) +
    tag('source_location', tx.sourceLocationId) + tag('destination_location', tx.destinationLocationId) +
    tag('staff_id', tx.staffId) + tag('ref_no', tx.referenceNumber);
  let header = common;
  if (group === 'RECORDS') {
    header +=
      tag('notes', tx.notes) + tag('vehicle_number', tx.vehicleNumber) +
      tag('received_by', tx.receivedBy) + tag('issued_by', tx.issuedBy) + tag('acknowledgement_by', tx.acknowledgementBy) +
      tag('drr_code', tx.drrCode) + tag('block', tx.block) + tag('sub_block', tx.subBlock) + tag('mrf_number', tx.mrfNumber) +
      tag('supplier_id', tx.supplierId) + tag('supplier_name', tx.supplierName) + tag('po_number', tx.poNumber);
  } else if (group === 'HANDOVER') {
    header +=
      tag('notes', tx.notes) + tag('handover_from_name', tx.handoverFromName) + tag('handover_from_phone', tx.handoverFromPhone) +
      tag('handover_to_name', tx.handoverToName) + tag('handover_to_phone', tx.handoverToPhone) + tag('handover_date', tx.handoverDate);
  } else {
    header += tag('notes', tx.notes);
  }
  const lines = tx.lines
    .map((l) =>
      `<material_lines>${tag('material_code', l.materialCode)}${tag('material_name', l.materialName)}${tag('quantity', l.quantity)}` +
      (group === 'RECORDS' ? tag('damaged_quantity', l.damagedQuantity || '0') : '') +
      `${tag('unit', l.unit)}${tag('line_notes', l.notes)}</material_lines>`)
    .join('');
  return wrapForm(formId, formUuid, tx.koboInstanceId || `uuid:${tx.clientTxUuid}`, header + lines);
}

/** "Camp Stock - Material Catalogue" form: one record per create/change, newest record per code wins. */
export function buildCatalogueXml(
  formId: string, formUuid: string, recordUuid: string,
  item: { code: string; name: string; unit: string; isUnitConfirmed: boolean; isActive?: boolean; notes?: string }, updatedBy: string,
  locationId = 'LOC-CENTRAL', currentStock = '0'
): string {
  return wrapForm(
    formId, formUuid, `uuid:${recordUuid}`,
    tag('client_tx_uuid', recordUuid) + tag('material_code', item.code) + tag('material_name', item.name) + tag('unit', item.unit) +
    tag('unit_confirmed', item.isUnitConfirmed ? 'yes' : 'no') + tag('status', item.isActive === false ? 'inactive' : 'active') +
    tag('notes', item.notes) + tag('updated_by', updatedBy) + tag('location_id', locationId) + tag('current_stock', currentStock)
  );
}

export function buildMultipartSubmission(xmlContent: string, boundary: string): string {
  return [
    `--${boundary}`,
    `Content-Disposition: form-data; name="xml_submission_file"; filename="submission.xml"`,
    `Content-Type: text/xml; charset=utf-8`,
    ``,
    xmlContent,
    `--${boundary}--`,
    ``,
  ].join('\r\n');
}

/**
 * Parses KoboToolbox REST API v2 JSON record into an InventoryTransaction.
 * In Kobo v2 JSON, repeat groups are returned either as a nested array of objects
 * or with slashed keys (`material_lines/material_code`).
 */
export type KoboFormKind = 'TX' | 'RECEIPT' | 'DISPATCH';

export function parseKoboSubmissionJson(
  record: Record<string, any>,
  kind: KoboFormKind = 'TX',
  /** The dispatch sheet has no material code column: codes and units are found by material name here. */
  catalogue: ReadonlyArray<{ code: string; name: string; unit: string }> = []
): InventoryTransaction {
  const clientTxUuid =
    record['client_tx_uuid'] ||
    record['meta/instanceID']?.replace(/^uuid:/, '') ||
    `kobo-${record['_id']}`;

  const txTypeValue: string = kind === 'RECEIPT' ? 'RECEIPT' : record['tx_type'];
  const isDispatchForm = kind === 'DISPATCH';
  const rawLines = (isDispatchForm ? record['dispatch_details'] : record['material_lines']) || [];
  let drr: string = record['drr_code'] || '';
  let mrf: string = record['mrf_number'] || '';
  let sub: string = record['sub_block'] || '';
  const g = (item: any, name: string) => item[`dispatch_details/${name}`] ?? item[name] ?? '';
  const lines: TransactionLine[] = Array.isArray(rawLines) && isDispatchForm
    ? rawLines.map((item: any, idx: number) => {
      drr = drr || g(item, 'drr_code');
      mrf = mrf || g(item, 'mrf_number');
      const isReturn = txTypeValue === 'RETURN';
      const matName: string = String(g(item, 'materials'));
      const known = catalogue.find((m) => m.name.trim().toLowerCase() === matName.trim().toLowerCase());
      return {
        lineId: `${clientTxUuid}-line-${idx + 1}`,
        materialCode: known?.code || matName,
        materialName: matName,
        quantity: String(g(item, isReturn ? 'returned_qty' : 'dispatch_qty') || '0'),
        damagedQuantity: String(g(item, 'damaged_qty') || '0'),
        unit: known?.unit || '',
        notes: '',
      };
    })
    : Array.isArray(rawLines)
      ? rawLines.map((item: any, idx: number) => {
        // Handle both flat slashed keys and unslashed keys in Kobo repeat groups
        const materialCode = item['material_lines/material_code'] || item['material_code'] || '';
        const quantity = String(item['material_lines/quantity'] || item['quantity'] || '0');
        const damagedQuantity = String(item['material_lines/damaged_quantity'] || item['damaged_quantity'] || '0');
        const unit = item['material_lines/unit'] || item['unit'] || '';
        const materialName = item['material_lines/material_name'] || item['material_name'] || '';
        const notes = item['material_lines/line_notes'] || item['line_notes'] || '';
        return {
          lineId: `${clientTxUuid}-line-${idx + 1}`,
          materialCode,
          materialName, // empty for old records: looked up from the catalogue
          quantity,
          damagedQuantity,
          unit,
          notes,
        };
      })
      : [];

  return {
    clientTxUuid,
    txType: txTypeValue as InventoryTransaction['txType'],
    txDateTime: record['tx_date_time'] || record['_submission_time'],
    sourceLocationId: record['source_location'],
    destinationLocationId: record['destination_location'],
    staffId: record['staff_id'] || '',
    referenceNumber: record['ref_no'] || '',
    notes: record['notes'] || undefined,
    vehicleNumber: record['vehicle_number'] || undefined,
    receivedBy: record['received_by'] || undefined,
    issuedBy: record['issued_by'] || undefined,
    acknowledgementBy: record['acknowledgement_by'] || undefined,
    drrCode: drr || undefined,
    block: record['block'] || undefined,
    subBlock: sub || undefined,
    mrfNumber: mrf || undefined,
    supplierId: record['supplier_id'] || undefined,
    supplierName: record['supplier_name'] || undefined,
    poNumber: record['po_number'] || undefined,
    handoverFromName: record['handover_from_name'] || undefined,
    handoverFromPhone: record['handover_from_phone'] || undefined,
    handoverToName: record['handover_to_name'] || undefined,
    handoverToPhone: record['handover_to_phone'] || undefined,
    handoverDate: record['handover_date'] || undefined,
    lines,
    syncStatus: 'SYNCED',
    koboSubmissionId: record['_id'],
    koboInstanceId: record['meta/instanceID'] || (record['_uuid'] ? `uuid:${record['_uuid']}` : `uuid:${clientTxUuid}`),
    createdAt: record['_submission_time'] || new Date().toISOString(),
    modifiedAt: record['_submission_time'] || new Date().toISOString(),
  };
}
