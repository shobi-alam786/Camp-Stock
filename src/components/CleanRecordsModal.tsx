import { useEffect, useState } from 'react';
import type { InventoryTransaction } from '../types/inventory.ts';
import { isPinSet, isValidPin, lockedSeconds, setPin, verifyPin } from '../utils/pinLock.ts';

type Stage = 'create' | 'enter' | 'menu' | 'change' | 'confirm' | 'done';

interface Props {
  transactions: InventoryTransaction[];
  onWipe: () => Promise<void>;
  onClose: () => void;
}

const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);

/** Hidden tool (long-press the Camp Stock logo): PIN first, then delete every local record. */
export function CleanRecordsModal({ transactions, onWipe, onClose }: Props) {
  const [stage, setStage] = useState<Stage>(isPinSet() ? 'enter' : 'create');
  const [pin, setPinText] = useState('');
  const [pin2, setPin2] = useState('');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState(0);
  const [wait, setWait] = useState(lockedSeconds());

  const total = transactions.length;
  const unsynced = transactions.filter((t) => t.syncStatus !== 'SYNCED').length;

  useEffect(() => {
    if (wait <= 0) return;
    const id = setInterval(() => setWait(lockedSeconds()), 1000);
    return () => clearInterval(id);
  }, [wait]);

  const go = (s: Stage) => { setStage(s); setPinText(''); setPin2(''); setTyped(''); setError(''); };

  const savePin = async (next: Stage) => {
    if (!isValidPin(pin)) return setError('The PIN must be 4 or 6 digits.');
    if (pin !== pin2) return setError('The two PINs are not the same.');
    await setPin(pin);
    go(next);
  };

  const enter = async () => {
    const r = await verifyPin(pin);
    if (r.ok) return go('menu');
    setPinText('');
    setWait(r.lockedSeconds);
    setError(r.lockedSeconds > 0 ? `Too many wrong PINs. Wait ${r.lockedSeconds} seconds.` : `Wrong PIN. ${r.attemptsLeft} tries left.`);
  };

  const wipe = async () => {
    setBusy(true);
    try {
      setRemoved(total);
      await onWipe();
      go('done');
    } catch (e: any) {
      setError(`Could not delete: ${e?.message || 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-center text-lg tracking-[0.5em] outline-none focus:border-sky-500';
  const primary = 'rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-40';
  const danger = 'rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40';
  const plain = 'rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-xl">
        {(stage === 'create' || stage === 'change') && (
          <>
            <h3 className="text-base font-bold text-slate-900">{stage === 'create' ? 'Create a PIN' : 'Change PIN'}</h3>
            <p className="text-xs text-slate-500">Use 4 or 6 digits. You need this PIN to open the clean tool.</p>
            <input className={input} type="password" inputMode="numeric" autoFocus placeholder="PIN" value={pin} onChange={(e) => setPinText(digits(e.target.value))} />
            <input className={input} type="password" inputMode="numeric" placeholder="Repeat PIN" value={pin2} onChange={(e) => setPin2(digits(e.target.value))} />
            {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button className={plain} onClick={() => (stage === 'change' ? go('menu') : onClose())}>Cancel</button>
              <button className={primary} onClick={() => savePin('menu')}>Save PIN</button>
            </div>
          </>
        )}

        {stage === 'enter' && (
          <>
            <h3 className="text-base font-bold text-slate-900">Enter PIN</h3>
            <input className={input} type="password" inputMode="numeric" autoFocus placeholder="PIN" value={pin} disabled={wait > 0}
              onChange={(e) => setPinText(digits(e.target.value))}
              onKeyDown={(e) => { if (e.key === 'Enter' && (pin.length === 4 || pin.length === 6)) void enter(); }} />
            {wait > 0 ? <p className="text-xs font-semibold text-red-600">Too many wrong PINs. Wait {wait} seconds.</p> : error && <p className="text-xs font-semibold text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button className={plain} onClick={onClose}>Cancel</button>
              <button className={primary} disabled={wait > 0 || !(pin.length === 4 || pin.length === 6)} onClick={() => void enter()}>Open</button>
            </div>
          </>
        )}

        {stage === 'menu' && (
          <>
            <h3 className="text-base font-bold text-slate-900">Clean local records</h3>
            <p className="text-sm text-slate-600">Records on this computer: <b>{total}</b><br />Not sent to Kobo yet: <b className={unsynced > 0 ? 'text-red-600' : ''}>{unsynced}</b></p>
            <div className="flex flex-col gap-2">
              <button className={danger} onClick={() => go('confirm')}>Delete all local records</button>
              <button className={plain} onClick={() => go('change')}>Change PIN</button>
              <button className={plain} onClick={onClose}>Close</button>
            </div>
          </>
        )}

        {stage === 'confirm' && (
          <>
            <h3 className="text-base font-bold text-red-700">Delete all local records?</h3>
            <p className="text-sm text-slate-700">This removes <b>{total}</b> records and all physical counts from this computer. Stock becomes empty. You cannot undo this.</p>
            {unsynced > 0 && <p className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{unsynced} records were NOT sent to Kobo. They will be lost forever. Close this and press Close day and sync first.</p>}
            <p className="text-xs text-slate-500">Type DELETE to continue.</p>
            <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-center font-semibold uppercase outline-none focus:border-red-500" value={typed} onChange={(e) => setTyped(e.target.value)} />
            {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button className={plain} disabled={busy} onClick={() => go('menu')}>Back</button>
              <button className={danger} disabled={busy || typed.trim().toUpperCase() !== 'DELETE'} onClick={() => void wipe()}>{busy ? 'Deleting...' : 'Delete everything'}</button>
            </div>
          </>
        )}

        {stage === 'done' && (
          <>
            <h3 className="text-base font-bold text-slate-900">Done</h3>
            <p className="text-sm text-slate-600">{removed} records were removed from this computer. To bring back records that were already sent, use Restore Ledger from Kobo in Sync Centre.</p>
            <div className="flex justify-end"><button className={primary} onClick={onClose}>Close</button></div>
          </>
        )}
      </div>
    </div>
  );
}
