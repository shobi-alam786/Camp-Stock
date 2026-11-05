import React, { useMemo, useState } from 'react';
import { CampLocation, InventoryTransaction, MaterialCatalogueItem } from '../types/inventory.ts';
import { dailyBalances } from '../utils/dailyReport.ts';
import { todayText } from '../utils/form.ts';
import { DateField } from './DateField.tsx';
import { Search } from 'lucide-react';

interface Props {
  currentLocation: CampLocation;
  catalogue: MaterialCatalogueItem[];
  transactions: InventoryTransaction[];
}

/** Daily Records: every material's starting and closing balance for the chosen date. */
export function DailyRecords({ currentLocation, catalogue, transactions }: Props) {
  const [day, setDay] = useState(todayText());
  const [query, setQuery] = useState('');
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return dailyBalances(catalogue, transactions, currentLocation.id, day).filter((b) => !q || b.name.toLowerCase().includes(q));
  }, [catalogue, transactions, currentLocation.id, day, query]);

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h3 className="text-base font-bold text-slate-900">Daily Records</h3>
        <p className="text-xs text-slate-500">Starting and closing balance of every material for the chosen date.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <DateField label="Date" value={day} onChange={setDay} />
        <div>
          <label className="text-xs font-semibold text-slate-600">Search material</label>
          <div className="relative mt-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Material name"
              className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-sky-500" />
          </div>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold text-slate-500">
            <tr><th className="px-4 py-3">Material Name</th><th className="px-4 py-3 text-right">Starting Balance</th><th className="px-4 py-3 text-right">Closing Balance</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((b) => (
              <tr key={b.code} className="hover:bg-slate-50/80">
                <td className="px-4 py-2.5 font-medium text-slate-900">{b.name}</td>
                <td className="px-4 py-2.5 text-right text-slate-700">{b.start} <span className="text-xs text-slate-400">{b.unit}</span></td>
                <td className={`px-4 py-2.5 text-right font-bold ${b.close.startsWith('-') ? 'text-red-600' : 'text-slate-900'}`}>{b.close} <span className="text-xs text-slate-400">{b.unit}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
