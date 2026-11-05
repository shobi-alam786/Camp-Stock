import React, { useMemo, useState } from 'react';
import { CampLocation, DecimalSafe, InventoryTransaction, MaterialCatalogueItem } from '../types/inventory.ts';
import { buildHandover, handoverSnapshot, validateHandover } from '../utils/catalogueOps.ts';
import { todayText } from '../utils/form.ts';
import { DateField } from './DateField.tsx';
import { Printer, UserCheck } from 'lucide-react';

interface Props {
  currentLocation: CampLocation;
  catalogue: MaterialCatalogueItem[];
  transactions: InventoryTransaction[];
  onSave: (tx: InventoryTransaction) => void;
}

const field = 'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-500';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Opens a clean page with the handover slip and starts the print dialog (Save as PDF works too). */
function printHandover(tx: InventoryTransaction, locationName: string) {
  const w = window.open('', '_blank', 'width=800,height=900');
  if (!w) return;
  const rows = tx.lines
    .map((l) => `<tr><td>${esc(l.materialName)}</td><td>${esc(l.unit)}</td><td style="text-align:right">${esc(l.quantity)}</td></tr>`)
    .join('');
  w.document.write(`<!doctype html><html><head><title>Staff Handover ${esc(tx.referenceNumber)}</title>
<style>body{font-family:Arial,sans-serif;padding:28px;color:#111}h1{font-size:20px;margin:0 0 4px}
table{border-collapse:collapse;width:100%;margin-top:14px}td,th{border:1px solid #999;padding:6px 8px;font-size:13px;text-align:left}
.two{display:flex;gap:24px;margin-top:14px}.two div{flex:1;border:1px solid #999;padding:10px;font-size:13px}
.sig{display:flex;gap:24px;margin-top:48px}.sig div{flex:1;border-top:1px solid #111;padding-top:6px;font-size:12px}</style></head><body>
<h1>Staff Handover - Stock Balance</h1>
<div style="font-size:13px">Ref: <b>${esc(tx.referenceNumber)}</b> &nbsp;|&nbsp; Date: <b>${esc(tx.handoverDate || '')}</b></div>
<div class="two"><div><b>Handing over</b><br>${esc(tx.handoverFromName || '')}<br>Phone: ${esc(tx.handoverFromPhone || '')}</div>
<div><b>Taking over</b><br>${esc(tx.handoverToName || '')}<br>Phone: ${esc(tx.handoverToPhone || '')}</div></div>
<table><thead><tr><th>Material</th><th>Unit</th><th style="text-align:right">Balance</th></tr></thead><tbody>${rows || '<tr><td colspan="3">No stock at this location.</td></tr>'}</tbody></table>
${tx.notes ? `<p style="font-size:13px">Notes: ${esc(tx.notes)}</p>` : ''}
<div class="sig"><div>Signature: ${esc(tx.handoverFromName || '')}</div><div>Signature: ${esc(tx.handoverToName || '')}</div></div>
<script>window.onload=function(){window.print()}</script></body></html>`);
  w.document.close();
}

/** Staff changes camp: the leaving staff hands the current stock balance to the next staff. Stock is not changed. */
export function StaffHandover({ currentLocation, catalogue, transactions, onSave }: Props) {
  const [fromName, setFromName] = useState('');
  const [fromPhone, setFromPhone] = useState('');
  const [toName, setToName] = useState('');
  const [toPhone, setToPhone] = useState('');
  const [date, setDate] = useState(todayText());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const snapshot = useMemo(
    () => handoverSnapshot(catalogue, currentLocation.id, transactions),
    [catalogue, currentLocation.id, transactions]
  );
  const history = useMemo(
    () =>
      transactions
        .filter((t) => t.txType === 'STAFF_HANDOVER' && t.sourceLocationId === currentLocation.id)
        .sort((a, b) => (b.handoverDate || '').localeCompare(a.handoverDate || '') || b.createdAt.localeCompare(a.createdAt)),
    [transactions, currentLocation.id]
  );

  const submit = () => {
    setDone('');
    const input = { locationId: currentLocation.id, fromName, fromPhone, toName, toPhone, date, notes };
    const err = validateHandover(input);
    setError(err);
    if (err) return;
    const tx = buildHandover(input, snapshot);
    onSave(tx);
    setDone(`Handover ${tx.referenceNumber} saved with ${tx.lines.length} material balance(s).`);
    setFromName(''); setFromPhone(''); setToName(''); setToPhone(''); setNotes('');
  };

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex items-center gap-2">
          <UserCheck className="h-5 w-5 text-sky-600" />
          <h4 className="text-sm font-bold text-slate-800">Staff Handover</h4>
        </div>
        <p className="text-xs text-slate-500">Use this when a staff member changes camp. The current stock balance below is saved with both staff details. Stock itself does not change.</p>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2 rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-bold text-slate-700">Handing over (leaving)</p>
            <div>
              <label className="text-xs font-semibold text-slate-600">Name *</label>
              <input value={fromName} onChange={(e) => setFromName(e.target.value)} className={field} />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Phone number *</label>
              <input value={fromPhone} onChange={(e) => setFromPhone(e.target.value)} inputMode="tel" placeholder="+880..." className={field} />
            </div>
          </div>
          <div className="space-y-2 rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-bold text-slate-700">Taking over (next staff)</p>
            <div>
              <label className="text-xs font-semibold text-slate-600">Name *</label>
              <input value={toName} onChange={(e) => setToName(e.target.value)} className={field} />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Phone number *</label>
              <input value={toPhone} onChange={(e) => setToPhone(e.target.value)} inputMode="tel" placeholder="+880..." className={field} />
            </div>
          </div>
        </div>

        <DateField label="Handover date *" value={date} onChange={setDate} />
        <div>
          <label className="text-xs font-semibold text-slate-600">Notes (optional)</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={field} />
        </div>

        <div>
          <p className="text-xs font-bold text-slate-700">Stock balance being handed over ({snapshot.length} materials)</p>
          <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-100">
            {snapshot.length === 0 ? (
              <p className="p-3 text-center text-xs text-slate-400">No stock recorded at this location.</p>
            ) : (
              <table className="w-full text-xs">
                <tbody className="divide-y divide-slate-100">
                  {snapshot.map((l) => (
                    <tr key={l.material.code}>
                      <td className="px-3 py-1.5 text-slate-800">{l.material.name}</td>
                      <td className={`px-3 py-1.5 text-right font-bold ${DecimalSafe.isNegative(l.balance) ? 'text-red-600' : 'text-slate-900'}`}>{l.balance} {l.material.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
        {done && <p className="text-xs font-semibold text-emerald-600">{done}</p>}
        <button onClick={submit} className="w-full rounded-lg bg-sky-600 py-2.5 text-sm font-bold text-white shadow-xs hover:bg-sky-700">
          Record Staff Handover
        </button>
      </div>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <h4 className="text-sm font-bold text-slate-800">Handover History</h4>
        <div className="max-h-[640px] divide-y divide-slate-100 overflow-y-auto">
          {history.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No staff handovers recorded here yet.</p>
          ) : (
            history.map((t) => (
              <div key={t.clientTxUuid} className="py-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">{t.handoverDate} • {t.referenceNumber}</span>
                  <button onClick={() => printHandover(t, currentLocation.name)} className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50">
                    <Printer className="h-3.5 w-3.5" /> Print
                  </button>
                </div>
                <p className="mt-1 text-slate-700">{t.handoverFromName} ({t.handoverFromPhone}) → {t.handoverToName} ({t.handoverToPhone})</p>
                <p className="text-slate-500">{t.lines.length} material balance(s) recorded</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
