import React, { useState } from 'react';
import { CampLocation, DecimalSafe, InventoryTransaction, MaterialCatalogueItem } from '../types/inventory.ts';
import { autoRef, dateToIso, isValidQty, newId, SelectedLine, todayText } from '../utils/form.ts';
import { MaterialPicker } from './MaterialPicker.tsx';
import { DateField } from './DateField.tsx';
import { inputClass, LinesEditor, StepCard } from './LinesEditor.tsx';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

interface Props {
  currentLocation: CampLocation;
  catalogue: MaterialCatalogueItem[];
  availability: (code: string) => string;
  onSave: (tx: InventoryTransaction) => void;
  onCreateCustom: (name: string, unit: string) => MaterialCatalogueItem | string;
  onConfirmUnit: (code: string, unit: string) => void;
}

const REASONS = ['Damaged', 'Lost / missing', 'Found / surplus', 'Count correction', 'Data entry error', 'Other'];

/** Explicit stock correction. Materials come from the catalogue or are added as custom materials. */
export function AdjustmentsForm({ currentLocation, catalogue, availability, onSave, onCreateCustom, onConfirmUnit }: Props) {
  const [increase, setIncrease] = useState(false);
  const [reason, setReason] = useState('');
  const [staff, setStaff] = useState(() => { try { return localStorage.getItem('campstock_last_staff') || ''; } catch { return ''; } });
  const [date, setDate] = useState(todayText());
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<SelectedLine[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const over = (l: SelectedLine) => !increase && isValidQty(l.qty) && DecimalSafe.compare(l.qty.trim(), availability(l.code)) > 0;
  const validate = (): string => {
    if (!reason) return 'Choose the reason for this adjustment.';
    if (reason === 'Other' && !notes.trim()) return 'Describe the reason in the explanation.';
    if (lines.length === 0) return 'Add at least one material.';
    const bad = lines.find((l) => !isValidQty(l.qty));
    if (bad) return `Enter a valid quantity for ${catalogue.find((c) => c.code === bad.code)?.name}.`;
    if (!staff.trim()) return 'Enter the staff name.';
    if (!dateToIso(date)) return 'Date must be yyyy-MM-dd and not in the future.';
    return '';
  };

  const save = () => {
    const uuid = newId();
    const now = new Date().toISOString();
    const tx: InventoryTransaction = {
      clientTxUuid: uuid, txType: increase ? 'ADJUSTMENT_POS' : 'ADJUSTMENT_NEG', txDateTime: dateToIso(date) || now,
      sourceLocationId: currentLocation.id, destinationLocationId: currentLocation.id,
      staffId: staff.trim(), referenceNumber: autoRef('ADJ', date),
      notes: `Reason: ${reason}${notes.trim() ? `. ${notes.trim()}` : ''}`,
      lines: lines.map((l, i) => {
        const m = catalogue.find((c) => c.code === l.code)!;
        return { lineId: `${uuid}-line-${i + 1}`, materialCode: m.code, materialName: m.name, quantity: DecimalSafe.fromScaledInt(DecimalSafe.toScaledInt(l.qty)), unit: m.unit };
      }),
      syncStatus: 'PENDING', createdAt: now, modifiedAt: now,
    };
    onSave(tx);
    try { localStorage.setItem('campstock_last_staff', staff.trim()); } catch { /* ignore */ }
    setSuccess(`Adjustment ${tx.referenceNumber} saved (${tx.lines.length} materials).`);
    setLines([]); setReason(''); setNotes(''); setShowReview(false);
  };

  const chip = (on: boolean) => `rounded-full border px-3 py-1.5 text-xs font-semibold ${on ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`;
  const negative = lines.some(over);

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h3 className="text-base font-bold text-slate-900">Stock Adjustment</h3>
        <p className="text-xs text-slate-500">Use only to correct the record, never to hide a dispatch.</p>
      </div>
      {success && <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-4 text-xs font-semibold text-emerald-800"><CheckCircle2 className="h-4 w-4" />{success}</div>}

      <StepCard step={1} title="Direction and reason">
        <div className="flex gap-1.5">
          <button onClick={() => setIncrease(false)} className={chip(!increase)}>Decrease (−)</button>
          <button onClick={() => setIncrease(true)} className={chip(increase)}>Increase (+)</button>
        </div>
        <div className="flex flex-wrap gap-1.5">{REASONS.map((r) => <button key={r} onClick={() => setReason(r)} className={chip(reason === r)}>{r}</button>)}</div>
      </StepCard>

      <StepCard step={2} title="Materials" subtitle="Pick from the catalogue, or add a custom material">
        <LinesEditor
          lines={lines} catalogue={catalogue} qtyLabel={increase ? 'Quantity to add' : 'Quantity to remove'} onChange={setLines} onAdd={() => setShowPicker(true)}
          subtitle={(m) => `${m.code}${m.isCustom ? ' • custom' : ''} • Current ${availability(m.code)} ${m.unit}`}
          warning={(l) => (over(l) ? 'More than the current stock. Stock would go negative.' : null)}
        />
      </StepCard>

      <StepCard step={3} title="Details">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className="text-xs font-semibold text-slate-600">Staff (name or ID) *</label><input value={staff} onChange={(e) => setStaff(e.target.value)} className={inputClass} /></div>
          <DateField label="Date *" value={date} onChange={setDate} />
        </div>
        <div><label className="text-xs font-semibold text-slate-600">Explanation (required for Other)</label><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} /></div>
      </StepCard>

      {error && <div className="flex items-center gap-2 rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-800"><AlertCircle className="h-4 w-4" />{error}</div>}
      <button onClick={() => { const e = validate(); setError(e); setSuccess(''); if (!e) setShowReview(true); }}
        className="w-full rounded-lg bg-sky-600 py-2.5 text-sm font-bold text-white shadow-xs hover:bg-sky-700">Review adjustment</button>

      {showPicker && (
        <MaterialPicker catalogue={catalogue} availability={availability} alreadySelected={new Set(lines.map((l) => l.code))}
          onAdd={(items) => setLines((prev) => [...prev, ...items.filter((m) => !prev.some((l) => l.code === m.code)).map((m) => ({ code: m.code, qty: '' }))])}
          onClose={() => setShowPicker(false)} onCreateCustom={onCreateCustom} onConfirmUnit={onConfirmUnit} />
      )}

      {showReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md space-y-3 rounded-2xl bg-white p-5 shadow-xl">
            <h4 className="text-base font-bold text-slate-900">{increase ? 'Confirm increase' : 'Confirm decrease'}</h4>
            <p className="text-sm text-slate-700">Reason: {reason}</p>
            <ul className="space-y-1 text-sm text-slate-800">
              {lines.map((l) => { const m = catalogue.find((c) => c.code === l.code)!; return <li key={l.code}>• {m.name}: {increase ? '+' : '−'}{DecimalSafe.fromScaledInt(DecimalSafe.toScaledInt(l.qty))} {m.unit}</li>; })}
            </ul>
            {negative && <p className="text-xs font-semibold text-red-600">Stock will go negative for some items.</p>}
            <p className="text-xs text-slate-500">This creates a permanent ledger record.</p>
            <div className="flex gap-2">
              <button onClick={() => setShowReview(false)} className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-semibold text-slate-700">Back</button>
              <button onClick={save} className="flex-1 rounded-lg bg-sky-600 py-2 text-sm font-bold text-white hover:bg-sky-700">Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
