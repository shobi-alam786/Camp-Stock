import React, { useEffect, useMemo, useState } from 'react';
import {
  CAMP_LOCATIONS, CampLocation, DecimalSafe, InventoryTransaction, MaterialCatalogueItem,
} from '../types/inventory.ts';
import { drrRows, NO_MRF } from '../utils/drrReport.ts';
import { autoRef, dateToIso, isValidQty, newId, SelectedLine, todayText } from '../utils/form.ts';
import { MaterialPicker } from './MaterialPicker.tsx';
import { DateField } from './DateField.tsx';
import { inputClass, LinesEditor, StepCard } from './LinesEditor.tsx';
import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface Props {
  currentLocation: CampLocation;
  catalogue: MaterialCatalogueItem[];
  transactions: InventoryTransaction[];
  availability: (code: string) => string;
  onSave: (tx: InventoryTransaction) => void;
  onCreateCustom: (name: string, unit: string) => MaterialCatalogueItem | string;
  onConfirmUnit: (code: string, unit: string) => void;
}

const lastStaff = () => { try { return localStorage.getItem('campstock_last_staff') || ''; } catch { return ''; } };

/** Dispatch: 1 destination + DRR-CODE / Sub-Block / MRF, 2 materials (multi-select), 3 details, then review. */
export function DispatchForm({ currentLocation, catalogue, transactions, availability, onSave, onCreateCustom, onConfirmUnit }: Props) {
  const destinations = useMemo(
    () => [...CAMP_LOCATIONS].filter((l) => l.id !== currentLocation.id).sort((a, b) => Number(a.type !== 'BLOCK') - Number(b.type !== 'BLOCK') || a.id.localeCompare(b.id)),
    [currentLocation.id]
  );
  const [destId, setDestId] = useState('');
  const [blockMode, setBlockMode] = useState(false);
  const [drr, setDrr] = useState('');
  const [subBlock, setSubBlock] = useState('');
  const [mrf, setMrf] = useState('');
  const [voucher, setVoucher] = useState('');
  const [staff, setStaff] = useState(lastStaff());
  const [acknowledgementBy, setAcknowledgementBy] = useState('');
  const [date, setDate] = useState(todayText());
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<SelectedLine[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => { setDestId(''); setBlockMode(false); }, [currentLocation.id]);

  const blockDests = destinations.filter((d) => d.type === 'BLOCK');
  const warehouseDests = destinations.filter((d) => d.type !== 'BLOCK');
  const dest = destinations.find((d) => d.id === destId);
  const isBlock = dest?.type === 'BLOCK';
  const rows = useMemo(() => drrRows(transactions), [transactions]);

  const drrCodes = Array.from(new Set(rows.map((r) => r.drrCode)));
  const subSuggestions = Array.from(new Set(rows.filter((r) => r.drrCode.toLowerCase() === drr.trim().toLowerCase()).map((r) => r.subBlock).filter((s) => !s.startsWith('('))));
  const mrfSuggestions = Array.from(new Set(rows.filter((r) => r.drrCode.toLowerCase() === drr.trim().toLowerCase() && (!subBlock.trim() || r.subBlock.toLowerCase() === subBlock.trim().toLowerCase())).map((r) => r.mrfNumber).filter((m) => m !== NO_MRF)));
  const mrfOther = mrf.trim() ? rows.find((r) => r.mrfNumber.toLowerCase() === mrf.trim().toLowerCase() && r.drrCode.toLowerCase() !== drr.trim().toLowerCase()) : undefined;
  const mrfEarlier = mrf.trim() ? new Set(rows.filter((r) => r.mrfNumber.toLowerCase() === mrf.trim().toLowerCase() && r.drrCode.toLowerCase() === drr.trim().toLowerCase()).map((r) => r.txUuid)).size : 0;

  const short = (l: SelectedLine) => isValidQty(l.qty) && DecimalSafe.compare(l.qty.trim(), availability(l.code)) > 0;
  const shortages = lines.filter(short);

  const validate = (): string => {
    if (!dest) return blockMode ? 'Select the block.' : 'Choose where the materials are going.';
    if (isBlock) {
      if (!drr.trim()) return 'Enter the DRR-CODE.';
      if (!subBlock.trim()) return 'Enter the Sub-Block.';
      if (!mrf.trim()) return 'Enter the MRF number.';
    }
    if (lines.length === 0) return 'Add at least one material.';
    const bad = lines.find((l) => !isValidQty(l.qty));
    if (bad) return `Enter a valid quantity for ${catalogue.find((c) => c.code === bad.code)?.name}.`;
    if (!staff.trim()) return 'Enter the Releasing Person.';
    if (!dateToIso(date)) return 'Date must be yyyy-MM-dd and not in the future.';
    return '';
  };

  const save = () => {
    if (!dest) return;
    const uuid = newId();
    const now = new Date().toISOString();
    const tx: InventoryTransaction = {
      clientTxUuid: uuid, txType: 'DISPATCH', txDateTime: dateToIso(date) || now,
      sourceLocationId: currentLocation.id, destinationLocationId: dest.id,
      staffId: staff.trim(), issuedBy: staff.trim(), acknowledgementBy: acknowledgementBy.trim() || undefined, referenceNumber: (!isBlock && voucher.trim()) || autoRef('DSP', date), notes: notes.trim() || undefined,
      drrCode: isBlock ? drr.trim().toUpperCase() : undefined, block: isBlock ? dest.code : undefined,
      subBlock: isBlock ? subBlock.trim() : undefined, mrfNumber: isBlock ? mrf.trim().toUpperCase() : undefined,
      lines: lines.map((l, i) => {
        const m = catalogue.find((c) => c.code === l.code)!;
        return { lineId: `${uuid}-line-${i + 1}`, materialCode: m.code, materialName: m.name, quantity: DecimalSafe.fromScaledInt(DecimalSafe.toScaledInt(l.qty)), unit: m.unit };
      }),
      syncStatus: 'PENDING', createdAt: now, modifiedAt: now,
    };
    onSave(tx);
    try { localStorage.setItem('campstock_last_staff', staff.trim()); } catch { /* ignore */ }
    setSuccess(`Dispatch ${tx.referenceNumber} saved (${tx.lines.length} materials). It will sync when online.`);
    setLines([]); setVoucher(''); setNotes(''); setShowReview(false);
  };

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h3 className="text-base font-bold text-slate-900">Dispatch Materials</h3>
        <p className="text-xs text-slate-500">Direct dispatch, no manager approval needed.</p>
      </div>
      {success && <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-4 text-xs font-semibold text-emerald-800"><CheckCircle2 className="h-4 w-4" />{success}</div>}

      <StepCard step={1} title="Dispatch details">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className="text-xs font-semibold text-slate-600">Issued by / Releasing Person *</label><input value={staff} onChange={(e) => setStaff(e.target.value)} className={inputClass} /></div>
          <div><label className="text-xs font-semibold text-slate-600">Received / acknowledged by</label><input value={acknowledgementBy} onChange={(e) => setAcknowledgementBy(e.target.value)} className={inputClass} /></div>
          <DateField label="Date *" value={date} onChange={setDate} />
        </div>
        <div><label className="text-xs font-semibold text-slate-600">Notes (optional)</label><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} /></div>
      </StepCard>

      <StepCard step={2} title="Destination" subtitle="Choose Block, or another camp warehouse">
        <div className="flex flex-wrap gap-1.5">
          {blockDests.length > 0 && (
            <button onClick={() => { setBlockMode(true); if (!isBlock) setDestId(''); }}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${blockMode ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>Block</button>
          )}
          {warehouseDests.map((d) => (
            <button key={d.id} onClick={() => { setBlockMode(false); setDestId(d.id); }}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${destId === d.id ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>{d.name}</button>
          ))}
        </div>
        {blockMode && (
          <div>
            <label className="text-xs font-semibold text-slate-600">Block *</label>
            <select value={isBlock ? destId : ''} onChange={(e) => setDestId(e.target.value)} className={inputClass}>
              <option value="">-- Select block --</option>
              {blockDests.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        )}
        {isBlock && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="text-xs font-semibold text-slate-600">DRR-CODE *</label>
              <input list="drr-list" value={drr} onChange={(e) => setDrr(e.target.value.toUpperCase())} className={inputClass} />
              <datalist id="drr-list">{drrCodes.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Sub-Block *</label>
              <input list="sub-list" value={subBlock} onChange={(e) => setSubBlock(e.target.value.toUpperCase())} className={inputClass} />
              <datalist id="sub-list">{subSuggestions.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">MRF Number *</label>
              <input list="mrf-list" value={mrf} onChange={(e) => setMrf(e.target.value.toUpperCase())} className={inputClass} />
              <datalist id="mrf-list">{mrfSuggestions.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
          </div>
        )}
        {dest && !isBlock && (
          <div>
            <label className="text-xs font-semibold text-slate-600">Waybill / slip number (optional, generated if empty)</label>
            <input value={voucher} onChange={(e) => setVoucher(e.target.value)} className={inputClass} />
          </div>
        )}
        {mrfOther && (
          <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 p-2 text-xs font-semibold text-amber-800"><AlertTriangle className="h-3.5 w-3.5" />MRF {mrfOther.mrfNumber} was already dispatched for DRR {mrfOther.drrCode}. Check the number.</p>
        )}
        {mrfEarlier > 0 && !mrfOther && <p className="text-xs text-slate-500">This MRF already has {mrfEarlier} earlier dispatch(es) for this DRR. This one is added to it.</p>}
      </StepCard>

      <StepCard step={3} title="Materials" subtitle="Select several at once, then enter quantities">
        <LinesEditor
          lines={lines} catalogue={catalogue} qtyLabel="Quantity" onChange={setLines} onAdd={() => setShowPicker(true)}
          subtitle={(m) => `${m.code} • Available ${availability(m.code)} ${m.unit}`}
          warning={(l, m) => (short(l) ? `Only ${availability(m.code)} ${m.unit} available. Short by ${DecimalSafe.subtract(l.qty.trim(), availability(m.code))}.` : null)}
        />
      </StepCard>

      {error && <div className="flex items-center gap-2 rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-800"><AlertCircle className="h-4 w-4" />{error}</div>}
      <button onClick={() => { const e = validate(); setError(e); setSuccess(''); if (!e) setShowReview(true); }}
        className="w-full rounded-lg bg-sky-600 py-2.5 text-sm font-bold text-white shadow-xs hover:bg-sky-700">
        Review dispatch{lines.length ? ` (${lines.length} items)` : ''}
      </button>

      {showPicker && (
        <MaterialPicker catalogue={catalogue} availability={availability} alreadySelected={new Set(lines.map((l) => l.code))}
          onAdd={(items) => setLines((prev) => [...prev, ...items.filter((m) => !prev.some((l) => l.code === m.code)).map((m) => ({ code: m.code, qty: '' }))])}
          onClose={() => setShowPicker(false)} onCreateCustom={onCreateCustom} onConfirmUnit={onConfirmUnit} />
      )}

      {showReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md space-y-3 rounded-2xl bg-white p-5 shadow-xl">
            <h4 className="text-base font-bold text-slate-900">Review dispatch</h4>
            <div className="space-y-0.5 text-sm text-slate-700">
              <p className="font-semibold">To: {dest?.name}</p>
              {isBlock && <><p>DRR-CODE: {drr.trim().toUpperCase()}</p><p>Sub-Block: {subBlock.trim()}</p><p>MRF: {mrf.trim().toUpperCase()}</p></>}
            </div>
            <ul className="space-y-1 border-t border-slate-200 pt-2 text-sm">
              {lines.map((l) => {
                const m = catalogue.find((c) => c.code === l.code)!;
                return <li key={l.code} className={short(l) ? 'font-semibold text-red-600' : 'text-slate-800'}>• {m.name}: {DecimalSafe.fromScaledInt(DecimalSafe.toScaledInt(l.qty))} {m.unit}{short(l) ? ' (SHORT)' : ''}</li>;
              })}
            </ul>
            {shortages.length > 0 && <p className="text-xs font-semibold text-red-600">Stock will go negative for the items marked SHORT. Dispatch only if the stock record is wrong or a receipt is still to be entered.</p>}
            <div className="flex gap-2">
              <button onClick={() => setShowReview(false)} className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-semibold text-slate-700">Back</button>
              <button onClick={save} className={`flex-1 rounded-lg py-2 text-sm font-bold text-white ${shortages.length ? 'bg-red-600 hover:bg-red-700' : 'bg-sky-600 hover:bg-sky-700'}`}>{shortages.length ? 'Dispatch anyway' : 'Confirm dispatch'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
