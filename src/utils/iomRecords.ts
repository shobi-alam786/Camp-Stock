/**
 * IOM Stock Records (read-only).
 * Pure logic: build the Kobo query, flatten submissions into one row per material,
 * remove duplicates by Kobo _id, and filter. Nothing here touches Camp Stock records or balances.
 */

export const IOM_DEFAULT_SERVER = 'https://kf.kobo.iom.int';
export const IOM_DEFAULT_UID = 'aP3n8sFSQ8FJFpbpFduYd4';
export const IOM_STORAGE_CODE = '13';
export const IOM_PAGE_SIZE = 500;

export interface IomRow {
  /** Kobo submission _id (shared by every material line of one submission). */
  koboId: number;
  /** Unique per material line: `${koboId}#${lineIndex}`. */
  rowKey: string;
  entryDate: string;
  entryBy: string;
  inventoryType: string;
  inventorySubType: string;
  mrfNo: string;
  drrCode: string;
  warehouse: string;
  waybillNo: string;
  category: string;
  subCategory: string;
  item: string;
  unit: string;
  quantity: string;
  subStorage: string;
  // Extra Kobo fields, filled when the form returns them (Received uses supplier / PO / GRN / PRF).
  camp: string;
  supplier: string;
  poNumber: string;
  grnNumber: string;
  prfNumber: string;
  project: string;
  code: string;
  castingYard: string;
  description: string;
}

export interface IomFilters {
  material: string;
  type: string;
  /** One search box: matches the DRR code or the MRF number. */
  search: string;
}

export const EMPTY_FILTERS: IomFilters = { material: '', type: '', search: '' };

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

export const isIsoDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Kobo "query" parameter: Camp 13 storage plus an inclusive entry_date range (ISO dates compare correctly as text). */
export function buildQuery(from: string, to: string): string {
  const q: Record<string, unknown> = { sd_storage: IOM_STORAGE_CODE };
  if (isIsoDay(from) || isIsoDay(to)) {
    const range: Record<string, string> = {};
    if (isIsoDay(from)) range.$gte = from;
    if (isIsoDay(to)) range.$lte = to;
    q.entry_date = range;
  }
  return JSON.stringify(q);
}

export function buildFirstUrl(server: string, uid: string, from: string, to: string, limit = IOM_PAGE_SIZE): string {
  const base = server.trim().replace(/\/+$/, '');
  const params = new URLSearchParams({ format: 'json', limit: String(limit), query: buildQuery(from, to) });
  return `${base}/api/v2/assets/${encodeURIComponent(uid.trim())}/data/?${params.toString()}`;
}

/** Accepts a pasted Kobo data URL (https://server/api/v2/assets/UID/data/...) and returns its server and form UID. */
export function parseDataUrl(text: string): { server: string; uid: string } | null {
  const m = text.trim().match(/^(https?:\/\/[^/\s]+)\/api\/v2\/assets\/([A-Za-z0-9]+)(?:\/|\?|$)/i);
  return m ? { server: m[1].replace(/^http:/i, 'https:'), uid: m[2] } : null;
}

/** The server sometimes hands back http:// in `next`; keep everything on https. */
export function safeNextUrl(next: unknown): string | null {
  const s = str(next);
  if (!s) return null;
  return s.replace(/^http:\/\//i, 'https://');
}

/**
 * Reads a field by name from the line first, then from the submission. Kobo may prefix the name with a group
 * (`rpt_items/code`, `grp_x/camp`), so a key that merely ends with `/name` is accepted too.
 */
function pick(name: string, ...sources: Array<Record<string, any> | undefined>): string {
  for (const src of sources) {
    if (!src) continue;
    for (const k of [name, `rpt_items/${name}`]) if (src[k] !== undefined && src[k] !== null) return str(src[k]);
    const key = Object.keys(src).find((k) => k.endsWith(`/${name}`));
    if (key) return str(src[key]);
  }
  return '';
}

/** One submission -> one row per material line. A submission with no lines still yields one row so it is not lost. */
export function flattenSubmission(sub: Record<string, any>): IomRow[] {
  const koboId = Number(sub?._id);
  if (!Number.isFinite(koboId)) return [];
  const base = {
    koboId,
    entryDate: str(sub.entry_date) || str(sub.today),
    entryBy: str(sub.entry_by),
    inventoryType: str(sub.inventory_type),
    inventorySubType: str(sub.inventory_sub_type),
    mrfNo: str(sub.mrf_no),
    drrCode: str(sub.drr_code),
    warehouse: str(sub.warehouse),
    waybillNo: str(sub.waybill_no),
  };
  const items: any[] = Array.isArray(sub.rpt_items) ? sub.rpt_items : [];
  const extra = (it?: Record<string, any>) => ({
    camp: pick('camp', it, sub),
    supplier: pick('supplier', it, sub),
    poNumber: pick('po_number', it, sub),
    grnNumber: pick('grn_number', it, sub),
    prfNumber: pick('prf_number', it, sub),
    project: pick('project', it, sub),
    code: pick('code', it, sub),
    castingYard: pick('casting_yard', it, sub),
    description: pick('description', it, sub),
  });
  if (items.length === 0) {
    return [{ ...base, ...extra(), rowKey: `${koboId}#0`, category: '', subCategory: '', item: '', unit: '', quantity: '', subStorage: '' }];
  }
  return items.map((it, i) => ({
    ...base,
    ...extra(it),
    rowKey: `${koboId}#${i}`,
    category: str(it?.['rpt_items/category']),
    subCategory: str(it?.['rpt_items/sub_category']),
    item: str(it?.['rpt_items/items']),
    unit: str(it?.['rpt_items/unit']),
    quantity: str(it?.['rpt_items/quantity']),
    subStorage: str(it?.['rpt_items/sub_storage']),
  }));
}

/** Merge new submissions into the existing rows. A Kobo _id already present is skipped, so paging twice never duplicates. */
export function mergeSubmissions(existing: IomRow[], incoming: Array<Record<string, any>>): { rows: IomRow[]; added: number; skipped: number } {
  const seen = new Set<number>(existing.map((r) => r.koboId));
  const rows = existing.slice();
  let added = 0;
  let skipped = 0;
  for (const sub of incoming) {
    const id = Number(sub?._id);
    if (!Number.isFinite(id)) continue;
    // Camp 13 only: a submission that names another storage is never shown, whatever the server returned.
    if (sub.sd_storage !== undefined && str(sub.sd_storage) !== IOM_STORAGE_CODE) continue;
    if (seen.has(id)) { skipped++; continue; }
    seen.add(id);
    added++;
    rows.push(...flattenSubmission(sub));
  }
  return { rows, added, skipped };
}

/** Client-side guard: even if the server query ignored the range, only rows inside it are shown. */
export function inRange(row: IomRow, from: string, to: string): boolean {
  if (isIsoDay(from) && row.entryDate < from) return false;
  if (isIsoDay(to) && row.entryDate > to) return false;
  return true;
}

const has = (hay: string, needle: string) => !needle.trim() || hay.toLowerCase().includes(needle.trim().toLowerCase());

export function filterRows(rows: IomRow[], from: string, to: string, f: IomFilters): IomRow[] {
  return rows.filter((r) =>
    inRange(r, from, to) &&
    has(r.item, f.material) &&
    (!f.type || r.inventoryType === f.type) &&
    (has(r.mrfNo, f.search) || has(r.drrCode, f.search)));
}

export function distinct(rows: IomRow[], pick: (r: IomRow) => string): string[] {
  return Array.from(new Set(rows.map(pick).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

/** Parse a plain decimal string ("1.5", "-0.25", "150") into a scaled BigInt. Returns null if it is not a plain number. */
function parseDecimal(text: string): { int: bigint; scale: number } | null {
  const m = text.trim().replace(/,/g, '').match(/^([+-]?)(\d*)(?:\.(\d*))?$/);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return null;
  const frac = m[3] ?? '';
  const int = BigInt(`${m[1] === '-' ? '-' : ''}${m[2] || '0'}${frac}`);
  return { int, scale: frac.length };
}

/** Exact decimal sum of quantity strings (no floating point). Non-numbers are skipped. */
export function sumDecimals(values: string[]): string {
  const parsed = values.map(parseDecimal).filter((v): v is { int: bigint; scale: number } => v !== null);
  const scale = parsed.reduce((m, v) => Math.max(m, v.scale), 0);
  let total = 0n;
  for (const v of parsed) total += v.int * 10n ** BigInt(scale - v.scale);
  const neg = total < 0n;
  const digits = (neg ? -total : total).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  // Keep every decimal place: 0.170 + 0.250 = 0.420, never 0.42.
  const frac = digits.slice(digits.length - scale);
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}

/** Display the quantity exactly as Kobo supplied it; do not normalize or pad decimal places. */
export function formatQty(text: string): string {
  return text;
}

/** Totals per material and unit, exact decimal arithmetic; the total keeps its trailing zeros (0.170 + 0.250 = 0.420). */
export function totalsByMaterial(rows: IomRow[]): Array<{ item: string; unit: string; total: string }> {
  const groups = new Map<string, { item: string; unit: string; values: string[] }>();
  for (const r of rows) {
    if (!parseDecimal(r.quantity)) continue;
    const key = `${r.item}|${r.unit}`;
    const cur = groups.get(key) ?? { item: r.item, unit: r.unit, values: [] };
    cur.values.push(r.quantity);
    groups.set(key, cur);
  }
  return Array.from(groups.values())
    .map((g) => ({ item: g.item, unit: g.unit, total: formatQty(sumDecimals(g.values)) }))
    .sort((a, b) => a.item.localeCompare(b.item));
}
