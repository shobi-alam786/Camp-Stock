import React, { useState } from 'react';
import { MaterialCatalogueItem } from '../types/inventory.ts';
import { COMMON_UNITS } from '../utils/form.ts';
import { Search, Plus, X } from 'lucide-react';

interface Props {
  catalogue: MaterialCatalogueItem[];
  /** current stock text for a material, or undefined to hide stock (receiving) */
  availability?: (code: string) => string;
  alreadySelected: Set<string>;
  onAdd: (items: MaterialCatalogueItem[]) => void;
  onClose: () => void;
  onCreateCustom: (name: string, unit: string) => MaterialCatalogueItem | string;
  onConfirmUnit: (code: string, unit: string) => void;
}

/** Search + multi-select list of materials, with "add custom material" and "set unit" inline. */
export function MaterialPicker({ catalogue, availability, alreadySelected, onAdd, onClose, onCreateCustom, onConfirmUnit }: Props) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [showCustom, setShowCustom] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customUnit, setCustomUnit] = useState('');
  const [customError, setCustomError] = useState('');
  const [unitFor, setUnitFor] = useState<MaterialCatalogueItem | null>(null);
  const [unitInput, setUnitInput] = useState('');

  const q = query.trim().toLowerCase();
  const list = catalogue.filter((m) => !q || m.name.toLowerCase().includes(q) || m.code.toLowerCase().includes(q));
  const toggle = (code: string) => setPicked((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]));

  const createCustom = () => {
    const res = onCreateCustom(customName, customUnit);
    if (typeof res === 'string') { setCustomError(res); return; }
    setPicked((p) => [...p, res.code]);
    setShowCustom(false); setCustomName(''); setCustomUnit(''); setCustomError('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-bold text-slate-900">Select materials</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or code"
              className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-sky-500" />
          </div>
          <button onClick={() => setShowCustom((v) => !v)}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <Plus className="h-4 w-4" /> Add custom material
          </button>

          {showCustom && (
            <div className="space-y-2 rounded-lg border border-sky-200 bg-sky-50 p-3">
              <p className="text-xs text-slate-600">For items outside the 45-item catalogue. The catalogue itself is never changed.</p>
              <input value={customName} onChange={(e) => { setCustomName(e.target.value); setCustomError(''); }} placeholder="Material name"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-500" />
              <div className="flex flex-wrap gap-1.5">
                {COMMON_UNITS.map((u) => (
                  <button key={u} onClick={() => setCustomUnit(u)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${customUnit.toUpperCase() === u ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>{u}</button>
                ))}
              </div>
              <input value={customUnit} onChange={(e) => { setCustomUnit(e.target.value.toUpperCase()); setCustomError(''); }} placeholder="Unit (type if not listed)"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-500" />
              {customError && <p className="text-xs font-semibold text-red-600">{customError}</p>}
              <button onClick={createCustom} className="w-full rounded-lg bg-sky-600 py-2 text-sm font-bold text-white hover:bg-sky-700">Add material</button>
            </div>
          )}
        </div>

        <div className="flex-1 space-y-1.5 overflow-y-auto px-5 pb-3">
          {list.map((m) => {
            const added = alreadySelected.has(m.code);
            const checked = added || picked.includes(m.code);
            const locked = !m.isUnitConfirmed;
            const avail = availability ? availability(m.code) : undefined;
            const low = avail !== undefined && (avail.startsWith('-') || avail === '0');
            return (
              <div key={m.code}
                onClick={() => !locked && !added && toggle(m.code)}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${checked ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-slate-50'} ${locked || added ? 'opacity-80' : 'cursor-pointer hover:border-sky-300'}`}>
                <input type="checkbox" readOnly checked={checked} disabled={locked || added} className="h-4 w-4" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{m.name}</p>
                  <p className="text-[11px] text-slate-500">{m.code}{m.isCustom ? ' • custom' : ''}{added ? ' • already added' : ''}</p>
                  {avail !== undefined && !locked && (
                    <p className={`text-xs font-medium ${low ? 'text-red-600' : 'text-emerald-600'}`}>Available: {avail} {m.unit}</p>
                  )}
                </div>
                {locked ? (
                  <button onClick={(e) => { e.stopPropagation(); setUnitFor(m); setUnitInput(''); }} className="rounded-lg px-2 py-1 text-xs font-bold text-amber-600 hover:bg-amber-50">Set unit</button>
                ) : (
                  <span className="text-xs text-slate-500">{m.unit}</span>
                )}
              </div>
            );
          })}
          {list.length === 0 && <p className="py-4 text-center text-sm text-slate-500">No match. Use “Add custom material”.</p>}
        </div>

        <div className="border-t border-slate-200 p-4">
          <button disabled={picked.length === 0}
            onClick={() => { onAdd(catalogue.filter((m) => picked.includes(m.code))); onClose(); }}
            className="w-full rounded-lg bg-sky-600 py-2.5 text-sm font-bold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300">
            {picked.length === 0 ? 'Select materials' : `Add ${picked.length} material(s)`}
          </button>
        </div>
      </div>

      {unitFor && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-5 shadow-xl">
            <h4 className="font-bold text-slate-900">Set unit: {unitFor.name}</h4>
            <p className="text-xs text-slate-500">Check the unit on the waybill or GRN. It is used for every transaction of this material.</p>
            <div className="flex flex-wrap gap-1.5">
              {COMMON_UNITS.map((u) => (
                <button key={u} onClick={() => setUnitInput(u)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${unitInput === u ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-300 text-slate-700'}`}>{u}</button>
              ))}
            </div>
            <input value={unitInput} onChange={(e) => setUnitInput(e.target.value.toUpperCase())} placeholder="Unit"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-500" />
            <div className="flex gap-2">
              <button onClick={() => setUnitFor(null)} className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-semibold text-slate-700">Cancel</button>
              <button disabled={!unitInput.trim()} onClick={() => { onConfirmUnit(unitFor.code, unitInput.trim()); setUnitFor(null); }}
                className="flex-1 rounded-lg bg-sky-600 py-2 text-sm font-bold text-white disabled:bg-slate-300">Confirm unit</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
