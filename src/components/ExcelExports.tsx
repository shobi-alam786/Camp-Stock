import { useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import type { CampLocation, InventoryTransaction, MaterialCatalogueItem, Supplier } from '../types/inventory.ts';
import { DateField } from './DateField.tsx';
import { todayText } from '../utils/form.ts';
import { MAX_STOCK_DAYS, daysBetween, handoverSuppliersWorkbook, recordsWorkbook, stockWorkbook } from '../utils/appExcel.ts';

interface Props {
  currentLocation: CampLocation;
  catalogue: MaterialCatalogueItem[];
  suppliers: Supplier[];
  transactions: InventoryTransaction[];
  /** Pulls the newest records from Kobo (when configured) and merges them with this computer's records. */
  loadAllRecords: () => Promise<InventoryTransaction[]>;
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function download(bytes: Uint8Array<ArrayBuffer>, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: XLSX_TYPE }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Three Excel files: Records (4 sheets), Staff Handover & Supplies (2 sheets), Stock balances (5 sheets). */
export function ExcelExports({ currentLocation, catalogue, suppliers, transactions, loadAllRecords }: Props) {
  const [from, setFrom] = useState(todayText());
  const [to, setTo] = useState(todayText());
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const run = async (key: string, build: (all: InventoryTransaction[]) => Uint8Array<ArrayBuffer>, file: string) => {
    setBusy(key); setMessage('');
    try {
      const all = await loadAllRecords().catch(() => transactions);
      download(build(all), file);
      setMessage(`${file} saved to your Downloads.`);
    } catch (e: any) {
      setMessage(`Export failed: ${e?.message || e}`);
    } finally {
      setBusy('');
    }
  };

  const rangeError = from > to ? 'The start date is after the end date.' : daysBetween(from, to).length >= MAX_STOCK_DAYS && to > daysBetween(from, to)[MAX_STOCK_DAYS - 1] ? `Choose at most ${MAX_STOCK_DAYS} days.` : '';
  const btn = 'w-full rounded-lg bg-emerald-600 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50';

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-slate-900">Excel Exports</h3>
        <p className="text-xs text-slate-500">Each button makes one .xlsx file with separate sheets. Records are updated from Kobo first when Kobo is set up.</p>
      </div>
      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-3">
        <div className="flex h-full flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <FileSpreadsheet className="h-6 w-6 text-emerald-600" />
          <h4 className="text-sm font-bold text-slate-800">Records</h4>
          <p className="text-xs text-slate-500">Sheets: All records, Received, Dispatched, Returned.</p>
          <button className={`${btn} mt-auto`} disabled={!!busy} onClick={() => run('rec', recordsWorkbook, `camp-stock-records-${todayText()}.xlsx`)}>
            {busy === 'rec' ? 'Preparing...' : 'Export Records (4 sheets)'}
          </button>
        </div>
        <div className="flex h-full flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <FileSpreadsheet className="h-6 w-6 text-amber-600" />
          <h4 className="text-sm font-bold text-slate-800">Staff Handover & Supplies</h4>
          <p className="text-xs text-slate-500">Sheets: Staff Handover (with items), Supplies (suppliers and their deliveries).</p>
          <button className={`${btn} mt-auto`} disabled={!!busy} onClick={() => run('hs', (all) => handoverSuppliersWorkbook(all, suppliers), `camp-stock-handover-supplies-${todayText()}.xlsx`)}>
            {busy === 'hs' ? 'Preparing...' : 'Export Handover & Supplies (2 sheets)'}
          </button>
        </div>
        <div className="flex h-full flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <FileSpreadsheet className="h-6 w-6 text-indigo-600" />
          <h4 className="text-sm font-bold text-slate-800">Stock Balances</h4>
          <p className="text-xs text-slate-500">{currentLocation.name}. Sheets: Material list, Starting Balance, Current Balance, Stock Adjustments, Daily Closing Balance.</p>
          <div className="grid grid-cols-2 gap-2">
            <DateField label="From" value={from} onChange={setFrom} />
            <DateField label="To" value={to} onChange={setTo} />
          </div>
          {rangeError && <p className="text-xs font-medium text-red-600">{rangeError}</p>}
          <button className={`${btn} mt-auto`} disabled={!!busy || !!rangeError}
            onClick={() => run('stock', (all) => stockWorkbook(catalogue, all, currentLocation.id, from, to), `camp-stock-balances-${from}${to !== from ? `_to_${to}` : ''}.xlsx`)}>
            {busy === 'stock' ? 'Preparing...' : 'Export Stock Balances (5 sheets)'}
          </button>
        </div>
      </div>
      {message && <p className="text-xs font-medium text-emerald-700">{message}</p>}
    </div>
  );
}
