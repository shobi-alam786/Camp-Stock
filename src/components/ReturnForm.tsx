import React, { useMemo, useState } from 'react';
import { CAMP_LOCATIONS, CampLocation, DecimalSafe, InventoryTransaction, MaterialCatalogueItem } from '../types/inventory.ts';
import { MrfMatch, searchMrf } from '../utils/dailyReport.ts';
import { autoRef, dateToIso, isValidQty, newId, SelectedLine, todayText } from '../utils/form.ts';
import { MaterialPicker } from './MaterialPicker.tsx';
import { DateField } from './DateField.tsx';
import { inputClass, LinesEditor, StepCard } from './LinesEditor.tsx';
import { AlertCircle, CheckCircle2, Search } from 'lucide-react';

interface Props {
  currentLocation: CampLocation;
  catalogue: MaterialCatalogueItem[];
  transactions: InventoryTransaction[];
  onSave: (tx: InventoryTransaction) => void;
  onCreateCustom: (name: string, unit: string) => MaterialCatalogueItem | string;
  onConfirmUnit: (code: string, unit: string) => void;
}

const blocks = CAMP_LOCATIONS.filter((l) => l.type === 'BLOCK');

/** Returns: search the released MRF to fill in block, DRR, sub-block and materials, then enter what came back. */
export function ReturnForm({ currentLocation, catalogue, transactions, onSave, onCreateCustom, onConfirmUnit }: Props) {
  const [search, setSearch] = useState('');
  const [blockCode, setBlockCode] = useState('');
  const [drr, setDrr] = useState('');
  const [subBlock, setSubBlock] = useState('');
  const [mrf, setMrf] = useState('');
  const [slip, setSlip] = useState('');
  const [date, setDate] = useState(todayText());
  const [notes, setNotes] = useState('');
  const [receiver, setReceiver] = useState(() => { try { return localStorage.getItem('campstock_last_staff') || ''; } catch { return ''; } });
  const [lines, setLines] = useState<SelectedLine[]>([]);
  const [damagedByCode, setDamagedByCode] = useState<Record<string, string>>({});
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const matches = useMemo(() => searchMrf(transactions, search), [transactions, search]);

  const pick = (m: MrfMatch) => {
    setBlockCode(m.block); setDrr(m.drrCode); setSubBlock(m.subBlock); setMrf(m.mrf.toUpperCase());
    setLines(m.lines.filter((l) => catalogue.some((c) => c.code === l.materialCode)).map((l) => ({ code: l.materialCode, qty: '' })));
    setSearch(''); setError(''); setSuccess('');
  };

  const netIssued = (code: string): string => {
    if (!mrf.trim()) return '';
    let total = 0n;
    for (const tx of transactions) {
      if ((tx.txType !== 'DISPATCH' && tx.txType !== 'RETURN') || (tx.block || '') !== blockCode) continue;
      if ((tx.mrfNumber || '').trim().toLowerCase() !== mrf.trim().toLowerCase()) continue;
      if (subBlock.trim() && (tx.subBlock || '').trim().toLowerCase() !== subBlock.trim().toLowerCase()) continue;
      for (const l of tx.lines) if (l.materialCode === code) {
        const q = DecimalSafe.toScaledInt(l.quantity);
        total += tx.txType === 'DISPATCH' ? q : -q;
      }
    }
    return DecimalSafe.fromScaledInt(total);
  };
  const over = (l: SelectedLine) => !!mrf.trim() && isValidQty(l.qty) && DecimalSafe.compare(l.qty.trim(), netIssued(l.code)) > 0;

  const filled = lines.filter((l) => l.qty.trim() !== '');

  const validate = (): string => {
    if (!blockCode) return 'Select the block the materials come from (or search the MRF number).';
    if (!drr.trim()) return 'Enter the DRR-CODE these materials were dispatched for.';
    if (filled.length === 0) return 'Enter the returned quantity for at least one material.';
    const bad = filled.find((l) => !isValidQty(l.qty));
    if (bad) return `Enter a valid quantity for ${catalogue.find((c) => c.code === bad.code)?.name}.`;
    for (const line of filled) { const damaged = damagedByCode[line.code] || '0'; if (!/^\d+(?:\.\d+)?$/.test(damaged) || DecimalSafe.compare(damaged, line.qty) > 0) return `Damaged quantity for ${catalogue.find((c) => c.code === line.code)?.name} must be between 0 and the returned quantity.`; }
    if (!dateToIso(date)) return 'Date must be yyyy-MM-dd and not in the future.';
    if (!receiver.trim()) return 'Enter the name of the person receiving the returned materials.';
    return '';
  };

  const save = () => {
    const blk = blocks.find((b) => b.code === blockCode)!;
    const uuid = newId();
    const now = new Date().toISOString();
    const tx: InventoryTransaction = {
      clientTxUuid: uuid, txType: 'RETURN', txDateTime: dateToIso(date) || now,
      sourceLocationId: blk.id, destinationLocationId: currentLocation.id,
      staffId: receiver.trim(), referenceNumber: slip.trim() || autoRef('RET', date), notes: notes.trim() || undefined,
      drrCode: drr.trim().toUpperCase(), block: blk.code, subBlock: subBlock.trim() || undefined, mrfNumber: mrf.trim().toUpperCase() || undefined,
      lines: filled.map((l, i) => {
        const m = catalogue.find((c) => c.code === l.code)!;
        return { lineId: `${uuid}-line-${i + 1}`, materialCode: m.code, materialName: m.name, quantity: DecimalSafe.fromScaledInt(DecimalSafe.toScaledInt(l.qty)), damagedQuantity: DecimalSafe.fromScaledInt(DecimalSafe.toScaledInt(damagedByCode[l.code] || '0')), unit: m.unit };
      }),
      syncStatus: 'PENDING', createdAt: now, modifiedAt: now,
    };
    onSave(tx);
    try { localStorage.setItem('campstock_last_staff', receiver.trim()); } catch { /* ignore */ }
    setSuccess(`Return ${tx.referenceNumber} saved (${tx.lines.length} materials). It will sync when online.`);
    setLines([]); setDamagedByCode({}); setSlip(''); setNotes(''); setMrf(''); setSubBlock(''); setDrr(''); setBlockCode('');
  };

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h3 className="text-base font-bold text-slate-900">Return Materials</h3>
        <p className="text-xs text-slate-500">From a block back into the warehouse.</p>
      </div>
      {success && <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-4 text-xs font-semibold text-emerald-800"><CheckCircle2 className="h-4 w-4" />{success}</div>}

      <StepCard step={1} title="Find the released MRF" subtitle="Search the MRF number to fill in the details automatically">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search MRF number"
            className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-sky-500" />
        </div>
        {search.trim() && matches.length === 0 && <p className="text-xs text-slate-500">No dispatched MRF matches "{search.trim()}". You can still fill in the details below.</p>}
        {matches.map((m) => (
          <button key={`${m.mrf}|${m.block}|${m.subBlock}`} onClick={() => pick(m)}
            className="flex w-full items-center justify-between rounded-lg border border-slate-200 p-3 text-left hover:border-sky-400 hover:bg-sky-50/50">
            <div>
              <p className="text-sm font-bold text-slate-900">{m.mrf.toUpperCase()}</p>
              <p className="text-xs text-slate-500">Block {m.block}{m.subBlock ? ` • ${m.subBlock}` : ''}{m.drrCode ? ` • ${m.drrCode}` : ''} • {m.lines.length} material(s) • {m.lastDate.slice(0, 10)}</p>
            </div>
            <span className="text-xs font-semibold text-sky-700">Use</span>
          </button>
        ))}
      </StepCard>

      <StepCard step={2} title="Returned from" subtitle="Checked automatically when you pick an MRF above">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold text-slate-600">Block *</label>
            <select value={blockCode} onChange={(e) => setBlockCode(e.target.value)} className={inputClass}>
              <option value="">-- Select block --</option>
              {blocks.map((b) => <option key={b.id} value={b.code}>{b.name}</option>)}
            </select>
          </div>
          <div><label className="text-xs font-semibold text-slate-600">DRR-CODE *</label><input value={drr} onChange={(e) => setDrr(e.target.value.toUpperCase())} className={inputClass} /></div>
          <div><label className="text-xs font-semibold text-slate-600">Sub-Block (optional)</label><input value={subBlock} onChange={(e) => setSubBlock(e.target.value.toUpperCase())} className={inputClass} /></div>
          <div><label className="text-xs font-semibold text-slate-600">MRF Number (optional)</label><input value={mrf} onChange={(e) => setMrf(e.target.value.toUpperCase())} className={inputClass} /></div>
        </div>
      </StepCard>

      <StepCard step={3} title="Materials returned" subtitle="Enter a quantity only for what is actually brought back. Leave the others empty.">
        <LinesEditor
          lines={lines} catalogue={catalogue} qtyLabel="Total quantity returned" onChange={setLines} onAdd={() => setShowPicker(true)}
          subtitle={(m) => (mrf.trim() ? `${m.code} • Dispatched (net): ${netIssued(m.code)} ${m.unit}` : m.code)}
          warning={(l) => (over(l) ? 'More than was dispatched for this MRF. Check before saving.' : null)}
        />
        {lines.filter((l) => l.qty.trim() !== '').map((l) => { const m = catalogue.find((c) => c.code === l.code); return <div key={l.code} className="grid grid-cols-2 gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><div className="text-xs font-semibold text-slate-700">{m?.name || l.code}<div className="font-normal text-slate-500">Usable quantity = total − damaged</div></div><div><label className="text-xs font-semibold text-slate-600">Damaged quantity</label><input type="number" min="0" step="any" value={damagedByCode[l.code] || '0'} onChange={(e) => setDamagedByCode((prev) => ({ ...prev, [l.code]: e.target.value }))} className={inputClass} /></div></div>; })}
      </StepCard>

      <StepCard step={4} title="Return details">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <DateField label="Date *" value={date} onChange={setDate} />
          <div><label className="text-xs font-semibold text-slate-600">Return slip number (optional)</label><input value={slip} onChange={(e) => setSlip(e.target.value)} className={inputClass} /></div>
        </div>
        <div><label className="text-xs font-semibold text-slate-600">Condition / reason (optional)</label><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} /></div>
        <div><label className="text-xs font-semibold text-slate-600">Returned materials receiver name *</label><input value={receiver} onChange={(e) => setReceiver(e.target.value)} className={inputClass} /></div>
      </StepCard>

      {error && <div className="flex items-center gap-2 rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-800"><AlertCircle className="h-4 w-4" />{error}</div>}
      <button onClick={() => { const e = validate(); setError(e); setSuccess(''); if (!e) save(); }}
        className="w-full rounded-lg bg-sky-600 py-2.5 text-sm font-bold text-white shadow-xs hover:bg-sky-700">
        Record return{filled.length ? ` (${filled.length} items)` : ''}
      </button>

      {showPicker && (
        <MaterialPicker catalogue={catalogue} alreadySelected={new Set(lines.map((l) => l.code))}
          onAdd={(items) => setLines((prev) => [...prev, ...items.filter((m) => !prev.some((l) => l.code === m.code)).map((m) => ({ code: m.code, qty: '' }))])}
          onClose={() => setShowPicker(false)} onCreateCustom={onCreateCustom} onConfirmUnit={onConfirmUnit} />
      )}
    </div>
  );
}
