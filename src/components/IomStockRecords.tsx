import { useEffect, useMemo, useState } from 'react';
import { DateField } from './DateField.tsx';
import { inputClass } from './LinesEditor.tsx';
import { todayText } from '../utils/form.ts';
import { fetchIomRecords } from '../services/iomClient.ts';
import {
  EMPTY_FILTERS, IOM_DEFAULT_SERVER, IOM_DEFAULT_UID, IomFilters, IomRow,
  distinct, filterRows, formatQty, parseDataUrl, totalsByMaterial,
} from '../utils/iomRecords.ts';
import { iomWorkbook } from '../utils/iomExcel.ts';
import { iomLockedSeconds, loadIomSettings, saveIomSettings, verifyIomPassword } from '../utils/iomAccess.ts';

const PAGE = 300;

/** Read-only view of IOM Camp 13 stock records. Never writes to Camp Stock records or balances. */
export function IomStockRecords() {
  const [unlocked, setUnlocked] = useState(false);
  const [pw, setPw] = useState('');
  const [gateError, setGateError] = useState('');
  const [wait, setWait] = useState(iomLockedSeconds());

  const [settings, setSettings] = useState(() => loadIomSettings({ server: IOM_DEFAULT_SERVER, uid: IOM_DEFAULT_UID }));
  const [showConn, setShowConn] = useState(false);

  const [rangeMode, setRangeMode] = useState(false);
  const [from, setFrom] = useState(todayText());
  const [to, setTo] = useState(todayText());
  const [filters, setFilters] = useState<IomFilters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<IomRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [view, setView] = useState<'records' | 'totals'>('records');

  useEffect(() => {
    if (wait <= 0) return;
    const id = setInterval(() => setWait(iomLockedSeconds()), 1000);
    return () => clearInterval(id);
  }, [wait]);

  const effTo = rangeMode ? to : from;
  const visible = useMemo(() => filterRows(rows, from, effTo, filters), [rows, from, effTo, filters]);
  const totals = useMemo(() => totalsByMaterial(visible), [visible]);
  const submissionsShown = useMemo(() => new Set(visible.map((r) => r.koboId)).size, [visible]);
  const typeList = useMemo(() => distinct(rows, (r) => r.inventoryType), [rows]);

  const unlock = async () => {
    const r = await verifyIomPassword(pw);
    setPw('');
    if (r.ok) { setUnlocked(true); setGateError(''); return; }
    setWait(r.lockedSeconds);
    setGateError(r.lockedSeconds > 0 ? `Too many wrong attempts. Wait ${r.lockedSeconds} seconds.` : `Wrong password. ${r.attemptsLeft} tries left.`);
  };

  const load = async () => {
    if (rangeMode && from > to) { setError('The start date is after the end date.'); return; }
    setBusy(true); setError(''); setMessage(''); setProgress(''); setLimit(PAGE);
    const res = await fetchIomRecords(settings, from, effTo, (n, t) => setProgress(`Loaded ${n} of ${t} submissions...`));
    setBusy(false); setProgress('');
    if (res.error) { setError(res.error); return; }
    setRows(res.rows); setLoaded(true);
    setMessage(`${res.submissions} submission(s) loaded for ${rangeMode ? `${from} to ${to}` : from}${res.skippedDuplicates ? `, ${res.skippedDuplicates} duplicate(s) skipped` : ''}.`);
  };

  /** One Excel file with 4 sheets: All records, Received, Dispatched, Returned. */
  const exportExcel = () => {
    const bytes = iomWorkbook(visible);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `iom-stock-records-${from}${rangeMode ? `_to_${to}` : ''}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  if (!unlocked) {
    return (
      <div className="mx-auto mt-16 max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <h3 className="text-base font-bold text-slate-900">IOM Stock Records</h3>
        <p className="mt-1 text-xs text-slate-500">Enter the access password to continue.</p>
        <input
          type="password" autoFocus value={pw} disabled={wait > 0}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && pw) void unlock(); }}
          className={inputClass} placeholder="Password"
        />
        {(gateError || wait > 0) && <p className="mt-2 text-xs font-medium text-red-600">{wait > 0 ? `Locked. Try again in ${wait} seconds.` : gateError}</p>}
        <button
          onClick={() => void unlock()} disabled={!pw || wait > 0}
          className="mt-4 w-full rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
        >Open</button>
      </div>
    );
  }

  if (view === 'totals') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => setView('records')}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">← Back to IOM Stock Records</button>
          <h3 className="text-base font-bold text-slate-900">Totals by material</h3>
        </div>
        <p className="text-xs text-slate-500">
          {rangeMode ? `${from} to ${to}` : from} · {totals.length} material(s) from {visible.length} line(s). Totals follow the filters on the records screen.
        </p>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold text-slate-500">
              <tr><th className="px-4 py-2">Material</th><th className="px-4 py-2 text-right">Total</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {totals.map((t) => (
                <tr key={`${t.item}|${t.unit}`} className="hover:bg-slate-50/80">
                  <td className="px-4 py-2 text-slate-700">{t.item}</td>
                  <td className="px-4 py-2 text-right font-semibold text-slate-900">{t.total} {t.unit}</td>
                </tr>
              ))}
              {totals.length === 0 && <tr><td colSpan={2} className="px-4 py-6 text-center text-slate-400">No totals to show.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
        Read-only IOM records for Camp 13. Nothing here changes Camp Stock records or balances.
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
        <button onClick={() => setShowConn((v) => !v)} className="text-xs font-semibold text-sky-700">
          {showConn ? 'Hide connection' : 'Connection'}
        </button>
        {showConn && (
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div className="col-span-3"><label className="text-xs font-semibold text-slate-600">Paste Kobo data URL (fills Server and Form UID)</label>
              <input className={inputClass} placeholder="https://kf.kobo.iom.int/api/v2/assets/.../data/..."
                onChange={(e) => { const p = parseDataUrl(e.target.value); if (p) setSettings({ ...settings, ...p }); }} /></div>
            <div><label className="text-xs font-semibold text-slate-600">Server</label>
              <input className={inputClass} value={settings.server} onChange={(e) => setSettings({ ...settings, server: e.target.value })} /></div>
            <div><label className="text-xs font-semibold text-slate-600">Form UID</label>
              <input className={inputClass} value={settings.uid} onChange={(e) => setSettings({ ...settings, uid: e.target.value })} /></div>
            <div><label className="text-xs font-semibold text-slate-600">API token (optional, only if the data is not public)</label>
              <input type="password" className={inputClass} value={settings.token} onChange={(e) => setSettings({ ...settings, token: e.target.value })} /></div>
            <div className="col-span-3">
              <button onClick={() => { saveIomSettings(settings); setMessage('Connection saved on this computer.'); }}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Save connection</button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <input type="checkbox" checked={rangeMode} onChange={(e) => setRangeMode(e.target.checked)} /> Date range
          </label>
          <DateField label={rangeMode ? 'From (entry date)' : 'Entry date'} value={from} onChange={setFrom} />
          {rangeMode && <DateField label="To (entry date)" value={to} onChange={setTo} />}
          <button onClick={() => void load()} disabled={busy}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
            {busy ? 'Loading...' : 'Load from IOM Kobo'}
          </button>
          {loaded && <button onClick={exportExcel} disabled={visible.length === 0}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">Export Excel (4 sheets)</button>}
        </div>
        {progress && <p className="mt-2 text-xs text-slate-500">{progress}</p>}
        {message && <p className="mt-2 text-xs font-medium text-emerald-700">{message}</p>}
        {error && <p className="mt-2 text-xs font-medium text-red-600">{error}</p>}
      </div>

      {loaded && (
        <>
          <div className="grid grid-cols-3 gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <div><label className="text-xs font-semibold text-slate-600">Material</label>
              <input className={inputClass} value={filters.material} onChange={(e) => setFilters({ ...filters, material: e.target.value })} /></div>
            <div><label className="text-xs font-semibold text-slate-600">Type</label>
              <select className={inputClass} value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
                <option value="">All</option>{typeList.map((t) => <option key={t} value={t}>{t}</option>)}
              </select></div>
            <div><label className="text-xs font-semibold text-slate-600">Search DRR code or MRF</label>
              <input className={inputClass} placeholder="Type a DRR code or MRF number" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} /></div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">{submissionsShown} submission(s), {visible.length} material line(s)</p>
            <button onClick={() => setView('totals')} disabled={totals.length === 0}
              className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-100 disabled:opacity-50">
              Totals by material ({totals.length})
            </button>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-100 bg-slate-50 font-semibold text-slate-500">
                <tr>
                  <th className="px-3 py-2">Date</th><th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">MRF / Waybill</th><th className="px-3 py-2">DRR</th><th className="px-3 py-2">Material</th>
                  <th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2">Unit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.slice(0, limit).map((r) => (
                  <tr key={r.rowKey} className="hover:bg-slate-50/80">
                    <td className="px-3 py-2 whitespace-nowrap">{r.entryDate}</td>
                    <td className="px-3 py-2">{r.inventoryType}{r.inventorySubType ? ` • ${r.inventorySubType}` : ''}</td>
                    <td className="px-3 py-2">{r.mrfNo || r.waybillNo}</td>
                    <td className="px-3 py-2">{r.drrCode}</td>
                    <td className="px-3 py-2 font-medium text-slate-900">{r.item}</td>
                    <td className="px-3 py-2 text-right font-semibold">{formatQty(r.quantity)}</td>
                    <td className="px-3 py-2">{r.unit}</td>
                  </tr>
                ))}
                {visible.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">No records match.</td></tr>}
              </tbody>
            </table>
            {visible.length > limit && (
              <button onClick={() => setLimit(limit + PAGE)} className="w-full border-t border-slate-100 py-2 text-xs font-semibold text-sky-700 hover:bg-slate-50">
                Show more ({visible.length - limit} left)
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
