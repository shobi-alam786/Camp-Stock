import React, { useMemo, useState } from 'react';
import { CampLocation, DecimalSafe, InventoryTransaction, MaterialCatalogueItem, calculateCurrentStock } from '../types/inventory.ts';
import { COMMON_UNITS, getLastStaff } from '../utils/form.ts';
import { isValidOpeningQty, parseBulkMaterials } from '../utils/catalogueOps.ts';
import { AlertTriangle, CheckCircle2, ListPlus, Plus, Search, Trash2, X } from 'lucide-react';

export interface MaterialEdit {
  unit: string;
  name: string;
  isActive: boolean;
  currentStockQty: string;
}

interface Props {
  currentLocation: CampLocation;
  catalogue: MaterialCatalogueItem[];
  transactions: InventoryTransaction[];
  /** returns an error text, or null when saved */
  onEdit: (code: string, edit: MaterialEdit, staff: string) => string | null;
  /** rows are already checked; returns an error text, or null when saved */
  onBulkAdd: (rows: Array<{ name: string; unit: string; qty: string }>, staff: string) => string | null;
  onDelete: (codes: string[]) => string | null;
}

const CATALOGUE_DELETE_PASSWORD = '786143';

const field = 'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-500';

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function CatalogueManager({ currentLocation, catalogue, transactions, onEdit, onBulkAdd, onDelete }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE' | 'UNIT'>('ALL');
  const [editing, setEditing] = useState<MaterialCatalogueItem | null>(null);
  const [addMode, setAddMode] = useState<null | 'one' | 'bulk'>(null);
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [showDelete, setShowDelete] = useState(false);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalogue
      .filter((m) => !q || m.name.toLowerCase().includes(q) || m.code.toLowerCase().includes(q))
      .filter((m) =>
        filter === 'ACTIVE' ? m.isActive !== false
          : filter === 'INACTIVE' ? m.isActive === false
            : filter === 'UNIT' ? !m.isUnitConfirmed
              : true)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      .map((m) => ({ m, s: calculateCurrentStock(m.code, currentLocation.id, transactions) }));
  }, [catalogue, query, filter, currentLocation.id, transactions]);

  const unconfirmed = catalogue.filter((m) => !m.isUnitConfirmed).length;
  const custom = catalogue.filter((m) => m.isCustom).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-900">Material Catalogue ({catalogue.length} items)</h3>
          <p className="text-xs text-slate-500">
            Current stock. {custom} custom, {unconfirmed} need a unit.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setAddMode('one')} className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white hover:bg-sky-700">
            <Plus className="h-4 w-4" /> Add Material
          </button>
          <button onClick={() => setAddMode('bulk')} className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
            <ListPlus className="h-4 w-4" /> Add Many
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or code"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-sky-500" />
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-sky-500">
          <option value="ALL">All materials</option>
          <option value="ACTIVE">Active only</option>
          <option value="INACTIVE">Inactive only</option>
          <option value="UNIT">Needs unit</option>
        </select>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
          <input
            type="checkbox"
            checked={rows.length > 0 && rows.every(({ m }) => selectedCodes.includes(m.code))}
            onChange={(event) => setSelectedCodes((current) => event.target.checked
              ? [...new Set([...current, ...rows.map(({ m }) => m.code)])]
              : current.filter((code) => !rows.some(({ m }) => m.code === code)))}
          />
          Select visible ({selectedCodes.length} selected)
        </label>
        <button
          onClick={() => setShowDelete(true)}
          disabled={selectedCodes.length === 0}
          className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" /> Delete selected
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold text-slate-500">
            <tr>
              <th className="w-10 px-3 py-3" aria-label="Select material" />
              <th className="px-4 py-3">Material</th>
              <th className="px-4 py-3">Unit</th>
              <th className="px-4 py-3 text-right">Current Stock</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-400">No materials match.</td></tr>
            )}
            {rows.map(({ m, s }) => (
              <tr key={m.code} className={`hover:bg-slate-50/80 ${m.isActive === false ? 'opacity-60' : ''}`}>
                <td className="px-3 py-3">
                  <input
                    type="checkbox"
                    aria-label={`Select ${m.name}`}
                    checked={selectedCodes.includes(m.code)}
                    onChange={(event) => setSelectedCodes((current) => event.target.checked
                      ? [...current, m.code]
                      : current.filter((code) => code !== m.code))}
                  />
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900">{m.name}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${m.isUnitConfirmed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
                    {m.isUnitConfirmed ? m.unit : 'NEEDS UNIT'}
                  </span>
                </td>
                <td className={`px-4 py-3 text-right font-bold ${DecimalSafe.isNegative(s.currentStock) ? 'text-red-600' : 'text-slate-900'}`}>{s.currentStock}</td>
                <td className="px-4 py-3">
                  {m.isActive === false ? (
                    <span className="text-xs font-semibold text-slate-500">Inactive</span>
                  ) : m.isUnitConfirmed ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> Active</span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs font-bold text-amber-600"><AlertTriangle className="h-3.5 w-3.5" /> Blocked</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => setEditing(m)} className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditDialog
          key={editing.code}
          material={editing}
          location={currentLocation}
          currentStock={calculateCurrentStock(editing.code, currentLocation.id, transactions).currentStock}
          onClose={() => setEditing(null)}
          onSave={(edit, staff) => {
            const err = onEdit(editing.code, edit, staff);
            if (!err) setEditing(null);
            return err;
          }}
        />
      )}

      {addMode && (
        <AddDialog
          mode={addMode}
          location={currentLocation}
          existingNames={catalogue.map((m) => m.name)}
          onClose={() => setAddMode(null)}
          onSave={(list, staff) => {
            const err = onBulkAdd(list, staff);
            if (!err) setAddMode(null);
            return err;
          }}
        />
      )}

      {showDelete && (
        <DeleteMaterialsDialog
          count={selectedCodes.length}
          onClose={() => setShowDelete(false)}
          onDelete={(password) => {
            const error = password === CATALOGUE_DELETE_PASSWORD
              ? onDelete(selectedCodes)
              : 'Incorrect password.';
            if (!error) {
              setSelectedCodes([]);
              setShowDelete(false);
            }
            return error;
          }}
        />
      )}
    </div>
  );
}

function DeleteMaterialsDialog({ count, onClose, onDelete }: {
  count: number;
  onClose: () => void;
  onDelete: (password: string) => string | null;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  return (
    <Modal title="Delete catalogue materials" onClose={onClose}>
      <p className="text-sm text-slate-700">Permanently remove {count} selected material(s) from the catalogue? Existing transaction history will be retained.</p>
      <label className="block text-xs font-semibold text-slate-600">Developer password
        <input type="password" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} className={field} />
      </label>
      {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
        <button onClick={() => setError(onDelete(password) || '')} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700">Delete materials</button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ edit

function EditDialog({ material, location, currentStock, onClose, onSave }: {
  material: MaterialCatalogueItem;
  location: CampLocation;
  currentStock: string;
  onClose: () => void;
  onSave: (edit: MaterialEdit, staff: string) => string | null;
}) {
  const [name, setName] = useState(material.name);
  const [unit, setUnit] = useState(material.isUnitConfirmed ? material.unit : '');
  const [qty, setQty] = useState(currentStock);
  const [active, setActive] = useState(material.isActive !== false);
  const [staff, setStaff] = useState(getLastStaff());
  const [error, setError] = useState('');

  const qtyChanged = isValidOpeningQty(qty) && DecimalSafe.compare(qty, currentStock) !== 0;

  const submit = () => {
    if (!name.trim()) return setError('Enter the material name.');
    if (!unit.trim()) return setError('Enter the unit. It is needed before this material can be used.');
    if (!isValidOpeningQty(qty)) return setError('Quantity must be 0 or more, with at most 4 decimals.');
    if (qtyChanged && !staff.trim()) return setError('Enter your name. It is saved with the quantity change.');
    setError(onSave({ unit, name, isActive: active, currentStockQty: qty }, staff) || '');
  };

  return (
    <Modal title={`Edit ${material.code}`} onClose={onClose}>
      <div>
        <label className="text-xs font-semibold text-slate-600">Material name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} disabled={!material.isCustom} className={`${field} disabled:bg-slate-50 disabled:text-slate-500`} />
        {!material.isCustom && <p className="mt-1 text-[11px] text-slate-400">Names of the original 45 materials are kept as they are.</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-slate-600">Unit *</label>
          <input list="unit-list" value={unit} onChange={(e) => setUnit(e.target.value.toUpperCase())} placeholder="e.g. PCS" className={field} />
          <datalist id="unit-list">{COMMON_UNITS.map((u) => <option key={u} value={u} />)}</datalist>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600">Status</label>
          <select value={active ? 'ACTIVE' : 'INACTIVE'} onChange={(e) => setActive(e.target.value === 'ACTIVE')} className={field}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive (hidden from lists)</option>
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs font-semibold text-slate-600">Current Stock quantity *</label>
        <input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} className={field} />
        <p className="mt-1 text-[11px] text-slate-500">
          Now {currentStock}. Current Stock is recalculated from this number.
          {qtyChanged && <> New Current Stock: <strong>{DecimalSafe.fromScaledInt(DecimalSafe.toScaledInt(qty))}</strong>.</>}
        </p>
      </div>
      {qtyChanged && (
        <div>
          <label className="text-xs font-semibold text-slate-600">Your name *</label>
          <input value={staff} onChange={(e) => setStaff(e.target.value)} className={field} />
        </div>
      )}
      {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
        <button onClick={submit} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-700">Save</button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ add one / add many

function AddDialog({ mode, location, existingNames, onClose, onSave }: {
  mode: 'one' | 'bulk';
  location: CampLocation;
  existingNames: string[];
  onClose: () => void;
  onSave: (rows: Array<{ name: string; unit: string; qty: string }>, staff: string) => string | null;
}) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [qty, setQty] = useState('');
  const [text, setText] = useState('');
  const [staff, setStaff] = useState(getLastStaff());
  const [error, setError] = useState('');

  const bulkRows = useMemo(() => (mode === 'bulk' ? parseBulkMaterials(text, existingNames) : []), [mode, text, existingNames]);
  const bad = bulkRows.filter((r) => r.error);

  const submit = () => {
    let rows: BulkOk[];
    if (mode === 'one') {
      const parsed = parseBulkMaterials(`${name.replace(/[,;\t]/g, ' ')}, ${unit}, ${qty}`, existingNames);
      if (parsed.length === 0 || parsed[0].error) return setError(parsed[0]?.error || 'Enter a name and a unit.');
      rows = parsed;
    } else {
      if (bulkRows.length === 0) return setError('Paste at least one line.');
      if (bad.length > 0) return setError('Fix the lines marked in red first.');
      rows = bulkRows;
    }
    const hasQty = rows.some((r) => !DecimalSafe.isZero(r.qty));
    if (hasQty && !staff.trim()) return setError('Enter your name. It is saved with the current-stock quantities.');
    setError(onSave(rows.map((r) => ({ name: r.name, unit: r.unit, qty: r.qty })), staff) || '');
  };

  return (
    <Modal title={mode === 'one' ? 'Add material' : 'Add many materials'} onClose={onClose}>
      {mode === 'one' ? (
        <>
          <div>
            <label className="text-xs font-semibold text-slate-600">Material name *</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={field} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-600">Unit *</label>
              <input list="unit-list-add" value={unit} onChange={(e) => setUnit(e.target.value.toUpperCase())} placeholder="e.g. PCS" className={field} />
              <datalist id="unit-list-add">{COMMON_UNITS.map((u) => <option key={u} value={u} />)}</datalist>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Current Stock quantity</label>
              <input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" className={field} />
            </div>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-slate-600">One material per line: <strong>Name, Unit, Quantity</strong>. Quantity can be left empty.</p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} autoFocus
            placeholder={'Cement, BAG, 120\nSand, CUM, 15.5\nSolar Lamp, PCS, 40'}
            className={`${field} font-mono`} />
          {bulkRows.length > 0 && (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg bg-slate-50 p-2 text-xs">
              {bulkRows.map((r) => (
                <p key={r.line} className={r.error ? 'text-red-600' : 'text-slate-700'}>
                  {r.line}. {r.name || '(no name)'} - {r.unit || '?'} - {r.qty}{r.error ? `  ✗ ${r.error}` : '  ✓'}
                </p>
              ))}
            </div>
          )}
        </>
      )}
      <p className="text-[11px] text-slate-500">The quantity is saved as the current-stock baseline for this warehouse.</p>
      <div>
        <label className="text-xs font-semibold text-slate-600">Your name</label>
        <input value={staff} onChange={(e) => setStaff(e.target.value)} className={field} />
      </div>
      {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
        <button onClick={submit} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-700">
          {mode === 'one' ? 'Add material' : `Add ${bulkRows.length || ''} materials`}
        </button>
      </div>
    </Modal>
  );
}

type BulkOk = { name: string; unit: string; qty: string };
