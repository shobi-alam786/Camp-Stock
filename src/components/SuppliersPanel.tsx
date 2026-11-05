import React, { useState } from 'react';
import { DecimalSafe, InventoryTransaction, Supplier } from '../types/inventory.ts';
import { inputClass } from './LinesEditor.tsx';
import { Plus, Search } from 'lucide-react';

interface Props {
  suppliers: Supplier[];
  transactions: InventoryTransaction[];
  onAdd: (name: string, phone: string) => Supplier | string;
  onUpdate: (s: Supplier) => string | null;
}

/** Supplier list with delivery history and totals per material. */
export function SuppliersPanel({ suppliers, transactions, onAdd, onUpdate }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [contact, setContact] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const receipts = transactions.filter((t) => t.txType === 'RECEIPT');
  const shown = suppliers.filter((s) => !query || s.name.toLowerCase().includes(query.toLowerCase()));

  const openForm = (s: Supplier | null) => {
    setEditing(s); setAdding(s === null); setError('');
    setName(s?.name || ''); setPhone(s?.phone || ''); setContact(s?.contactPerson || ''); setNotes(s?.notes || '');
  };
  const submit = () => {
    if (editing) {
      const err = onUpdate({ ...editing, name: name.trim(), phone: phone.trim(), contactPerson: contact.trim(), notes: notes.trim() });
      if (err) { setError(err); return; }
    } else {
      const r = onAdd(name, phone);
      if (typeof r === 'string') { setError(r); return; }
    }
    setEditing(null); setAdding(false);
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-slate-900">Suppliers</h3>
          <p className="text-xs text-slate-500">{suppliers.length} suppliers • deliveries come from Receive Materials</p>
        </div>
        <button onClick={() => openForm(null)} className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white hover:bg-sky-700"><Plus className="h-3.5 w-3.5" />Add supplier</button>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search suppliers" className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-sky-500" />
      </div>

      {(adding || editing) && (
        <div className="space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-4">
          <p className="text-sm font-bold text-slate-900">{editing ? 'Edit supplier' : 'Add supplier'}</p>
          <input value={name} onChange={(e) => { setName(e.target.value); setError(''); }} placeholder="Supplier / vendor name" className={inputClass} />
          <div className="grid grid-cols-2 gap-2">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" className={inputClass} />
            <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Contact person (optional)" className={inputClass} />
          </div>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" className={inputClass} />
          {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setAdding(false); setEditing(null); }} className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-semibold text-slate-700">Cancel</button>
            <button onClick={submit} className="flex-1 rounded-lg bg-sky-600 py-2 text-sm font-bold text-white hover:bg-sky-700">Save</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {shown.map((s) => {
          const mine = receipts
            .filter((t) => t.supplierId === s.supplierId || (!t.supplierId && (t.supplierName || '').toLowerCase() === s.name.toLowerCase()))
            .sort((a, b) => b.txDateTime.localeCompare(a.txDateTime));
          const totals = new Map<string, { name: string; unit: string; total: string }>();
          for (const t of mine) for (const l of t.lines) {
            const k = `${l.materialCode}|${l.unit}`;
            totals.set(k, { name: l.materialName || l.materialCode, unit: l.unit, total: DecimalSafe.add(totals.get(k)?.total || '0', l.quantity) });
          }
          const expanded = open === s.supplierId;
          return (
            <div key={s.supplierId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <button onClick={() => setOpen(expanded ? null : s.supplierId)} className="w-full text-left">
                <p className="text-sm font-bold text-slate-900">{s.name}</p>
                {(s.phone || s.contactPerson) && <p className="text-xs text-slate-500">{[s.phone, s.contactPerson].filter(Boolean).join(' • ')}</p>}
                <p className={`text-xs ${mine.length ? 'text-emerald-600' : 'text-slate-500'}`}>
                  {mine.length ? `${mine.length} deliver${mine.length === 1 ? 'y' : 'ies'} • last ${mine[0].txDateTime.slice(0, 10)}` : 'No deliveries recorded yet'}
                </p>
              </button>
              {expanded && (
                <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-xs">
                  {s.notes && <p className="text-slate-600">Notes: {s.notes}</p>}
                  {totals.size > 0 && (
                    <div>
                      <p className="font-semibold text-slate-800">Total supplied</p>
                      {Array.from(totals.values()).map((t) => <p key={t.name + t.unit} className="text-slate-700">• {t.name}: {t.total} {t.unit}</p>)}
                    </div>
                  )}
                  {mine.length > 0 && (
                    <div>
                      <p className="font-semibold text-slate-800">Deliveries</p>
                      {mine.map((t) => (
                        <div key={t.clientTxUuid} className="mt-1">
                          <p className="font-medium text-slate-800">{t.txDateTime.slice(0, 10)} • GRN {t.referenceNumber}{t.poNumber ? ` • PO ${t.poNumber}` : ''}</p>
                          {t.lines.map((l) => <p key={l.lineId} className="pl-3 text-slate-500">{l.materialName || l.materialCode}: {l.quantity} {l.unit}</p>)}
                        </div>
                      ))}
                    </div>
                  )}
                  <button onClick={() => openForm(s)} className="font-semibold text-sky-700 hover:underline">Edit supplier</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
