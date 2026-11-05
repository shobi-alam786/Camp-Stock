import React, { useMemo, useState } from 'react';
import { CampLocation, DecimalSafe, InventoryTransaction, MaterialCatalogueItem, Supplier } from '../types/inventory.ts';
import { autoRef, dateToIso, isValidQty, newId, SelectedLine, todayText } from '../utils/form.ts';
import { MaterialPicker } from './MaterialPicker.tsx';
import { DateField } from './DateField.tsx';
import { inputClass, LinesEditor, StepCard } from './LinesEditor.tsx';
import { AlertCircle, CheckCircle2, Plus } from 'lucide-react';

interface Props {
  currentLocation: CampLocation;
  catalogue: MaterialCatalogueItem[];
  suppliers: Supplier[];
  transactions: InventoryTransaction[];
  onSave: (tx: InventoryTransaction) => void;
  onAddSupplier: (name: string, phone: string) => Supplier | string;
  onCreateCustom: (name: string, unit: string) => MaterialCatalogueItem | string;
  onConfirmUnit: (code: string, unit: string) => void;
}

const lastStaff = () => { try { return localStorage.getItem('campstock_last_staff') || ''; } catch { return ''; } };

/** Goods receipt: supplier, PO, GRN number, several materials in one record. */
export function ReceiveForm({ currentLocation, catalogue, suppliers, transactions, onSave, onAddSupplier, onCreateCustom, onConfirmUnit }: Props) {
  const [supplierId, setSupplierId] = useState('');
  const [po, setPo] = useState('');
  const [grn, setGrn] = useState('');
  const [staff, setStaff] = useState(lastStaff());
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [receivedBy, setReceivedBy] = useState('');
  const [date, setDate] = useState(todayText());
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<SelectedLine[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [newSupName, setNewSupName] = useState('');
  const [newSupPhone, setNewSupPhone] = useState('');
  const [supError, setSupError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const supplier = suppliers.find((s) => s.supplierId === supplierId);
  const receipts = useMemo(() => transactions.filter((t) => t.txType === 'RECEIPT'), [transactions]);
  const poSuggestions = Array.from(new Set(receipts.filter((t) => t.supplierId === supplierId).map((t) => t.poNumber).filter(Boolean))) as string[];
  const duplicateGrn = !!supplier && !!grn.trim() && receipts.some((t) => t.supplierId === supplierId && t.referenceNumber.toLowerCase() === grn.trim().toLowerCase());

  const validate = (): string => {
    if (!supplier) return 'Choose the supplier.';
    if (!grn.trim()) return 'Enter the GRN / delivery number.';
    if (duplicateGrn) return `GRN ${grn.trim()} is already recorded for ${supplier.name}.`;
    if (lines.length === 0) return 'Add at least one material.';
    const bad = lines.find((l) => !isValidQty(l.qty));
    if (bad) return `Enter a valid quantity for ${catalogue.find((c) => c.code === bad.code)?.name}.`;
    if (!staff.trim()) return 'Enter the receiving staff name.';
    if (!dateToIso(date)) return 'Date must be yyyy-MM-dd and not in the future.';
    return '';
  };

  const save = () => {
    if (!supplier) return;
    const uuid = newId();
    const now = new Date().toISOString();
    const tx: InventoryTransaction = {
      clientTxUuid: uuid, txType: 'RECEIPT', txDateTime: dateToIso(date) || now,
      sourceLocationId: 'SUPPLIER', destinationLocationId: currentLocation.id,
      staffId: staff.trim(), referenceNumber: grn.trim(), notes: notes.trim() || undefined,
      supplierId: supplier.supplierId, supplierName: supplier.name, poNumber: po.trim() || undefined,
      vehicleNumber: vehicleNumber.trim() || undefined, receivedBy: receivedBy.trim() || undefined,
      lines: lines.map((l, i) => {
        const m = catalogue.find((c) => c.code === l.code)!;
        return { lineId: `${uuid}-line-${i + 1}`, materialCode: m.code, materialName: m.name, quantity: DecimalSafe.fromScaledInt(DecimalSafe.toScaledInt(l.qty)), unit: m.unit };
      }),
      syncStatus: 'PENDING', createdAt: now, modifiedAt: now,
    };
    onSave(tx);
    try { localStorage.setItem('campstock_last_staff', staff.trim()); } catch { /* ignore */ }
    setSuccess(`Receipt ${tx.referenceNumber} from ${supplier.name} saved (${tx.lines.length} materials).`);
    setLines([]); setGrn(''); setPo(''); setNotes('');
  };

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h3 className="text-base font-bold text-slate-900">Receive Materials (Goods Received Note)</h3>
      </div>
      {success && <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-4 text-xs font-semibold text-emerald-800"><CheckCircle2 className="h-4 w-4" />{success}</div>}

      <StepCard step={1} title="Supplier & documents" subtitle="As written on the GRN">
        <div>
          <label className="text-xs font-semibold text-slate-600">Supplier *</label>
          <div className="flex gap-2">
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inputClass}>
              <option value="">-- Choose supplier --</option>
              {suppliers.filter((s) => s.isActive).map((s) => <option key={s.supplierId} value={s.supplierId}>{s.name}</option>)}
            </select>
            <button onClick={() => setAddingSupplier((v) => !v)} className="mt-1 flex items-center gap-1 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Plus className="h-3.5 w-3.5" />New</button>
          </div>
        </div>
        {addingSupplier && (
          <div className="space-y-2 rounded-lg border border-sky-200 bg-sky-50 p-3">
            <input value={newSupName} onChange={(e) => { setNewSupName(e.target.value); setSupError(''); }} placeholder="Supplier name" className={inputClass} />
            <input value={newSupPhone} onChange={(e) => setNewSupPhone(e.target.value)} placeholder="Phone (optional)" className={inputClass} />
            {supError && <p className="text-xs font-semibold text-red-600">{supError}</p>}
            <button onClick={() => { const r = onAddSupplier(newSupName, newSupPhone); if (typeof r === 'string') { setSupError(r); return; } setSupplierId(r.supplierId); setAddingSupplier(false); setNewSupName(''); setNewSupPhone(''); }}
              className="w-full rounded-lg bg-sky-600 py-2 text-sm font-bold text-white hover:bg-sky-700">Save supplier</button>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold text-slate-600">PO number (optional)</label>
            <input list="po-list" value={po} onChange={(e) => setPo(e.target.value.toUpperCase())} className={inputClass} />
            <datalist id="po-list">{poSuggestions.map((p) => <option key={p} value={p} />)}</datalist>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">GRN / delivery number *</label>
            <input value={grn} onChange={(e) => setGrn(e.target.value)} className={`${inputClass} ${duplicateGrn ? 'border-red-400' : ''}`} />
            {duplicateGrn && <p className="mt-1 text-xs font-semibold text-red-600">Already recorded for this supplier.</p>}
          </div>
        </div>
      </StepCard>

      <StepCard step={2} title="Materials received" subtitle="Quantity as counted at the warehouse">
        <LinesEditor lines={lines} catalogue={catalogue} qtyLabel="Quantity received" onChange={setLines} onAdd={() => setShowPicker(true)}
          subtitle={(m) => m.code} warning={() => null} />
      </StepCard>

      <StepCard step={3} title="Receipt details">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className="text-xs font-semibold text-slate-600">Receiving staff *</label><input value={staff} onChange={(e) => setStaff(e.target.value)} className={inputClass} /></div>
          <DateField label="Date received *" value={date} onChange={setDate} />
          <div><label className="text-xs font-semibold text-slate-600">Vehicle number</label><input value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} className={inputClass} /></div>
          <div><label className="text-xs font-semibold text-slate-600">Received by</label><input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} className={inputClass} /></div>
        </div>
        <div><label className="text-xs font-semibold text-slate-600">Notes (condition, batch, shortage...)</label><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} /></div>
      </StepCard>

      {error && <div className="flex items-center gap-2 rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-800"><AlertCircle className="h-4 w-4" />{error}</div>}
      <button onClick={() => { const e = validate(); setError(e); setSuccess(''); if (!e) save(); }}
        className="w-full rounded-lg bg-sky-600 py-2.5 text-sm font-bold text-white shadow-xs hover:bg-sky-700">
        Record receipt{lines.length ? ` (${lines.length} items)` : ''}
      </button>

      {showPicker && (
        <MaterialPicker catalogue={catalogue} alreadySelected={new Set(lines.map((l) => l.code))}
          onAdd={(items) => setLines((prev) => [...prev, ...items.filter((m) => !prev.some((l) => l.code === m.code)).map((m) => ({ code: m.code, qty: '' }))])}
          onClose={() => setShowPicker(false)} onCreateCustom={onCreateCustom} onConfirmUnit={onConfirmUnit} />
      )}
    </div>
  );
}
