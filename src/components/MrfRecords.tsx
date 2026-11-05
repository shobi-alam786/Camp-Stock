import React, { useMemo, useState } from 'react';
import { CAMP_LOCATIONS, CampLocation, InventoryTransaction, MaterialCatalogueItem } from '../types/inventory.ts';
import { dailyBalances, mrfRecords } from '../utils/dailyReport.ts';
import { todayText } from '../utils/form.ts';
import { DateField } from './DateField.tsx';
import { inputClass } from './LinesEditor.tsx';
import { Search } from 'lucide-react';

interface Props {
  currentLocation: CampLocation;
  catalogue: MaterialCatalogueItem[];
  transactions: InventoryTransaction[];
}

/** Today's MRF Records: what was dispatched to / returned from blocks on one day, plus starting and closing balances. */
export function MrfRecords({ currentLocation, catalogue, transactions }: Props) {
  const [day, setDay] = useState(todayText());
  const [block, setBlock] = useState('');
  const [material, setMaterial] = useState('');
  const [query, setQuery] = useState('');

  const blocks = CAMP_LOCATIONS.filter((l) => l.type === 'BLOCK');
  const rows = useMemo(
    () => mrfRecords(transactions, currentLocation.id, day, block || null, material || null, query),
    [transactions, currentLocation.id, day, block, material, query]
  );
  const balances = useMemo(() => {
    const shown = new Set(rows.map((r) => r.materialCode));
    return dailyBalances(catalogue, transactions, currentLocation.id, day).filter((b) => shown.has(b.code));
  }, [rows, catalogue, transactions, currentLocation.id, day]);

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h3 className="text-base font-bold text-slate-900">Today's MRF Records</h3>
        <p className="text-xs text-slate-500">Materials dispatched to blocks and returned from them.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <DateField label="Date" value={day} onChange={setDay} />
        <div>
          <label className="text-xs font-semibold text-slate-600">Block</label>
          <select value={block} onChange={(e) => setBlock(e.target.value)} className={inputClass}>
            <option value="">All blocks</option>
            {blocks.map((b) => <option key={b.id} value={b.code}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600">Material</label>
          <select value={material} onChange={(e) => setMaterial(e.target.value)} className={inputClass}>
            <option value="">All materials</option>
            {catalogue.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
          </select>
        </div>
        <div className="relative sm:col-span-3">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search material"
            className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-sky-500" />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold text-slate-500">
            <tr>
              <th className="px-4 py-3">MRF</th>
              <th className="px-4 py-3">Materials</th>
              <th className="px-4 py-3 text-right">Dispatch Qty</th>
              <th className="px-4 py-3 text-right">Returned Qty</th>
              <th className="px-4 py-3 text-right">Damaged Qty</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-400">No MRF dispatches or returns for these filters.</td></tr>}
            {rows.map((r) => (
              <tr key={`${r.mrf}|${r.subBlock}|${r.block}|${r.materialCode}|${r.unit}`}>
                <td className="px-4 py-2.5 font-semibold text-slate-900">{r.mrf}</td>
                <td className="px-4 py-2.5 text-slate-700">{r.materialName}</td>
                <td className="px-4 py-2.5 text-right font-medium text-slate-900">{r.dispatchQty} <span className="text-xs text-slate-400">{r.unit}</span></td>
                <td className="px-4 py-2.5 text-right font-medium text-slate-900">{r.returnQty} <span className="text-xs text-slate-400">{r.unit}</span></td>
                <td className="px-4 py-2.5 text-right font-medium text-slate-900">{r.damagedQty} <span className="text-xs text-slate-400">{r.unit}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {balances.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
          <p className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-500">Starting and closing balance • {day}</p>
          <table className="w-full text-left text-sm">
            <thead className="text-xs font-semibold text-slate-500">
              <tr><th className="px-4 py-2.5">Material Name</th><th className="px-4 py-2.5 text-right">Starting Balance</th><th className="px-4 py-2.5 text-right">Closing Balance</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {balances.map((b) => (
                <tr key={b.code}>
                  <td className="px-4 py-2.5 font-medium text-slate-900">{b.name}</td>
                  <td className="px-4 py-2.5 text-right text-slate-700">{b.start} <span className="text-xs text-slate-400">{b.unit}</span></td>
                  <td className="px-4 py-2.5 text-right font-bold text-slate-900">{b.close} <span className="text-xs text-slate-400">{b.unit}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
