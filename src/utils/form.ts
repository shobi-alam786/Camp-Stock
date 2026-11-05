import { DecimalSafe } from '../types/inventory.ts';

const QTY = /^\d{1,9}(\.\d{1,4})?$/;

/** Positive number, at most 4 decimals (same rule as the Android app). */
export const isValidQty = (t: string) => QTY.test(t.trim()) && DecimalSafe.isPositive(t.trim());

/** "2026-10-20" -> ISO instant at the current time of day; null if invalid or in the future. */
export function dateToIso(text: string, now: Date = new Date()): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d, now.getHours(), now.getMinutes(), now.getSeconds());
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  return date > endOfToday ? null : date.toISOString();
}

export const todayText = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

export const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);

export const autoRef = (prefix: string, date: string) => `${prefix}-${date.replace(/-/g, '')}-${newId().slice(0, 4).toUpperCase()}`;

export const COMMON_UNITS = ['PCS', 'CUM', 'BUNDLE', 'BAG', 'KG', 'ROLL', 'M', 'LTR', 'SET'];

export interface SelectedLine {
  code: string;
  qty: string;
}

/** Last staff name typed on this device (convenience only; localStorage may be unavailable). */
export function getLastStaff(): string {
  try { return localStorage.getItem('campstock_last_staff') || ''; } catch { return ''; }
}
export function setLastStaff(name: string): void {
  try { if (name.trim()) localStorage.setItem('campstock_last_staff', name.trim()); } catch { /* ignore */ }
}
