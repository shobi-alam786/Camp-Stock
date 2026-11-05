import React from 'react';
import { MaterialCatalogueItem } from '../types/inventory.ts';
import { SelectedLine } from '../utils/form.ts';
import { Plus, X } from 'lucide-react';

interface Props {
  lines: SelectedLine[];
  catalogue: MaterialCatalogueItem[];
  qtyLabel: string;
  subtitle: (m: MaterialCatalogueItem) => string;
  warning: (line: SelectedLine, m: MaterialCatalogueItem) => string | null;
  onChange: (lines: SelectedLine[]) => void;
  onAdd: () => void;
}

export function LinesEditor({ lines, catalogue, qtyLabel, subtitle, warning, onChange, onAdd }: Props) {
  return (
    <div className="space-y-3">
      {lines.length === 0 && <p className="text-sm text-slate-500">No materials added yet.</p>}
      {lines.map((line, i) => {
        const m = catalogue.find((c) => c.code === line.code);
        if (!m) return null;
        const warn = warning(line, m);
        return (
          <div key={line.code} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{m.name}</p>
                <p className="text-xs text-slate-500">{subtitle(m)}</p>
              </div>
              <button onClick={() => onChange(lines.filter((_, j) => j !== i))} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Remove"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                inputMode="decimal"
                value={line.qty}
                onChange={(e) => onChange(lines.map((l, j) => (j === i ? { ...l, qty: e.target.value.replace(',', '.') } : l)))}
                placeholder={qtyLabel}
                className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-sky-500 ${warn ? 'border-red-400' : 'border-slate-200'}`}
              />
              <span className="w-20 text-xs font-semibold text-slate-500">{m.unit}</span>
            </div>
            {warn && <p className="mt-1 text-xs font-semibold text-red-600">{warn}</p>}
          </div>
        );
      })}
      <button onClick={onAdd} className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
        <Plus className="h-4 w-4" /> {lines.length === 0 ? 'Select materials' : 'Add more materials'}
      </button>
    </div>
  );
}

export function StepCard({ step, title, subtitle, children }: { step: number; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <div className="flex items-center gap-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-600 text-xs font-bold text-white">{step}</span>
        <div>
          <p className="text-sm font-bold text-slate-900">{title}</p>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

export const inputClass = 'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-500';
