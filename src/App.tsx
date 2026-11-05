/**
 * Camp Stock Inventory Management System
 * Windows Application & Field Operations Dashboard
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { applyOpeningBalance, OPENING_BALANCE_FLAG } from './utils/openingBalance.ts';
import {
  CAMP_LOCATIONS,
  CampLocation,
  INITIAL_MATERIAL_CATALOGUE,
  MaterialCatalogueItem,
  InventoryTransaction,
  PhysicalStockCount,
  calculateCurrentStock,
  DecimalSafe,
  validateMaterialForTransaction,
  UNIT_NEEDS_CONFIRMATION,
  TransactionType,
  Supplier,
} from './types/inventory.ts';
import { DispatchForm } from './components/DispatchForm.tsx';
import { ReceiveForm } from './components/ReceiveForm.tsx';
import { MrfRecords } from './components/MrfRecords.tsx';
import { IomStockRecords } from './components/IomStockRecords.tsx';
import { ReturnForm } from './components/ReturnForm.tsx';
import { AdjustmentsForm } from './components/AdjustmentsForm.tsx';
import { DailyRecords } from './components/DailyRecords.tsx';
import { localDay } from './utils/dailyReport.ts';
import { findDuplicates } from './utils/duplicateCheck.ts';
import { SuppliersPanel } from './components/SuppliersPanel.tsx';
import { newId, setLastStaff } from './utils/form.ts';
import { CatalogueManager, MaterialEdit } from './components/CatalogueManager.tsx';
import { StaffHandover } from './components/StaffHandover.tsx';
import { CleanRecordsModal } from './components/CleanRecordsModal.tsx';
import { buildBaselineRecords, buildSnapshotBaseline, newCustomMaterial } from './utils/catalogueOps.ts';
import { mergeRemote } from './utils/syncRules.ts';
import { syncTransaction } from './services/syncEngine.ts';
import { localDb } from './services/db.ts';
import { ExcelExports } from './components/ExcelExports.tsx';
import { SyncDraftEditor } from './components/SyncDraftEditor.tsx';
import { ADDITIONAL_MATERIALS } from './types/additionalMaterials.ts';
import { koboClient, KoboServerConfig, DEFAULT_UID_CATALOGUE } from './services/koboClient.ts';
import {
  Package,
  Layers,
  ArrowDownLeft,
  ArrowUpRight,
  RotateCcw,
  Repeat,
  Sliders,
  ClipboardCheck,
  History,
  Grid,
  FileText,
  RefreshCw,
  Settings,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Warehouse,
  Search,
  Plus,
  Send,
  Building2,
  ExternalLink,
  ShieldCheck,
  Smartphone,
  ChevronRight,
  Info,
  Printer,
  Download,
  Filter,
  FolderKanban,
  Truck,
} from 'lucide-react';

export default function App() {
  const protectedScreenPassword = '786143Arkan';
  // Navigation & Location
  const [currentLocation] = useState<CampLocation>(CAMP_LOCATIONS[0]);
  const [activeScreen, setActiveScreen] = useState<string>('dashboard');
  const [lockedScreen, setLockedScreen] = useState<string | null>(null);
  const [screenPassword, setScreenPassword] = useState('');
  const [screenPasswordError, setScreenPasswordError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Domain Entities
  const [catalogue, setCatalogue] = useState<MaterialCatalogueItem[]>([...INITIAL_MATERIAL_CATALOGUE, ...ADDITIONAL_MATERIALS]);
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [editingSyncDraft, setEditingSyncDraft] = useState<InventoryTransaction | null>(null);
  const [physicalCounts, setPhysicalCounts] = useState<PhysicalStockCount[]>([]);
  const [showClean, setShowClean] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startLongPress = () => { longPressTimer.current = setTimeout(() => setShowClean(true), 800); };
  const cancelLongPress = () => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; } };
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  // Windows shortcut for IOM Stock Records: hold Ctrl, then press I, S, R in order (each within 2 seconds of the last).
  useEffect(() => {
    let step = 0;
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) { step = 0; return; }
      const k = e.key.toLowerCase();
      if (k === 'control') return;
      const now = Date.now();
      if (now - last > 2000) step = 0;
      const seq = ['i', 's', 'r'];
      if (k === seq[step]) {
        e.preventDefault();
        step += 1; last = now;
        if (step === seq.length) { step = 0; setActiveScreen('iom'); }
      } else {
        step = k === seq[0] ? 1 : 0;
        if (step === 1) { e.preventDefault(); last = now; }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Configuration
  const [koboConfig, setKoboConfig] = useState<KoboServerConfig>(() => {
    const defaults: KoboServerConfig = {
      serverUrl: 'https://kf.kobotoolbox.org',
      formUid: '',
      formId: 'camp_stock_records',
      token: '',
      uidHandover: '',
      uidStock: '',
      uidCatalogue: DEFAULT_UID_CATALOGUE,
    };
    try {
      const saved = JSON.parse(localStorage.getItem('campStockKoboConfig') || 'null');
      return saved ? { ...defaults, ...saved } : defaults;
    } catch {
      return defaults;
    }
  });
  const [syncMessage, setSyncMessage] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [configStatusMessage, setConfigStatusMessage] = useState('');

  const requestScreen = (screenId: string) => {
    if (screenId === 'catalogue' || screenId === 'settings') {
      setLockedScreen(screenId);
      setScreenPassword('');
      setScreenPasswordError('');
      return;
    }
    setActiveScreen(screenId);
  };

  const unlockScreen = () => {
    if (screenPassword !== protectedScreenPassword) {
      setScreenPasswordError('Incorrect password.');
      return;
    }
    if (lockedScreen) setActiveScreen(lockedScreen);
    setLockedScreen(null);
    setScreenPassword('');
    setScreenPasswordError('');
  };

  // Modals & Sub-forms
  const [confirmUnitModal, setConfirmUnitModal] = useState<MaterialCatalogueItem | null>(null);
  const [newUnitInput, setNewUnitInput] = useState('');

  // Shared Transaction Form States
  const [txRefNo, setTxRefNo] = useState('');
  const [txStaffId, setTxStaffId] = useState('');
  const [txSelectedMaterial, setTxSelectedMaterial] = useState<MaterialCatalogueItem | null>(null);
  const [txQuantity, setTxQuantity] = useState('');
  const [txDestinationLocation, setTxDestinationLocation] = useState<string>(CAMP_LOCATIONS[1].id);
  const [txNotes, setTxNotes] = useState('');
  const [txFormError, setTxFormError] = useState('');
  const [txSuccessMessage, setTxSuccessMessage] = useState('');

  // Physical Count Audit Form
  const [countMaterial, setCountMaterial] = useState<MaterialCatalogueItem | null>(null);
  const [physicalObservedQty, setPhysicalObservedQty] = useState('');
  const [countAuditor, setCountAuditor] = useState('');
  const [countNotes, setCountNotes] = useState('');
  const [countMessage, setCountMessage] = useState('');

  // Load from IndexedDB on startup
  useEffect(() => {
    async function loadData() {
      const dbCatalogue = await localDb.getAllCatalogue();
      if (dbCatalogue.length > 0) setCatalogue(dbCatalogue);
      const dbTransactions = await localDb.getAllTransactions();
      if (dbTransactions.length > 0) setTransactions(dbTransactions);

      // One-time: Camp 13 stock balance of 18-10-2026 (only the difference is added; safe to repeat)
      try {
        if (!localStorage.getItem(OPENING_BALANCE_FLAG)) {
          const result = applyOpeningBalance(dbCatalogue.length > 0 ? dbCatalogue : [...INITIAL_MATERIAL_CATALOGUE, ...ADDITIONAL_MATERIALS], dbTransactions);
          if (result) {
            setCatalogue(result.catalogue);
            result.changedItems.forEach((m) => localDb.updateCatalogueItem(m));
            if (result.tx) setTransactions((prev) => [result.tx!, ...prev]);
            localStorage.setItem(OPENING_BALANCE_FLAG, 'done');
          }
        }
      } catch (e) {
        console.error('Opening balance import failed', e);
      }
      setSuppliers(await localDb.getAllSuppliers());
      setPhysicalCounts(await localDb.getAllPhysicalCounts());
    }
    loadData();
  }, []);

  // Sync to IndexedDB
  useEffect(() => {
    transactions.forEach((tx) => localDb.saveTransaction(tx));
  }, [transactions]);

  // Calculations
  const unconfirmedCount = catalogue.filter((m) => !m.isUnitConfirmed).length;
  const pendingSyncCount = transactions.filter(
    (t) => t.syncStatus === 'PENDING' || t.syncStatus === 'FAILED' || t.syncStatus === 'OUTCOME_UNKNOWN'
  ).length;
  const pendingTransactions = transactions.filter(
    (t) => t.syncStatus === 'PENDING' || t.syncStatus === 'FAILED' || t.syncStatus === 'OUTCOME_UNKNOWN'
  );
  const dashboardTransactions = transactions.filter((t) =>
    t.txType === 'RECEIPT' || t.txType === 'DISPATCH' || t.txType === 'RETURN'
  );
  const dashboardPendingSyncCount = dashboardTransactions.filter(
    (t) => t.syncStatus === 'PENDING' || t.syncStatus === 'FAILED' || t.syncStatus === 'OUTCOME_UNKNOWN'
  ).length;
  const historyTransactions = transactions.filter((transaction) =>
    transaction.txType === 'RECEIPT' || transaction.txType === 'DISPATCH'
  );

  // Dashboard: today's activity at the current location
  const todayStats = useMemo(() => {
    const today = localDay(new Date().toISOString());
    const stat = (pick: (t: InventoryTransaction) => boolean) => {
      const list = transactions.filter((t) => localDay(t.txDateTime) === today && pick(t));
      return { records: list.length, lines: list.reduce((n, t) => n + t.lines.length, 0) };
    };
    return {
      dispatch: stat((t) => t.txType === 'DISPATCH' && t.sourceLocationId === currentLocation.id),
      received: stat((t) => t.txType === 'RECEIPT' && t.destinationLocationId === currentLocation.id),
      returns: stat((t) => t.txType === 'RETURN' && t.destinationLocationId === currentLocation.id),
    };
  }, [transactions, currentLocation.id]);

  const currentStockMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof calculateCurrentStock>>();
    for (const mat of catalogue) {
      map.set(mat.code, calculateCurrentStock(mat.code, currentLocation.id, transactions));
    }
    return map;
  }, [catalogue, currentLocation.id, transactions]);

  // Print a purpose-built stock summary instead of printing the current application screen.
  const printCurrentStockSummary = () => {
    const rows = catalogue
      .filter((material) => material.isActive !== false || !DecimalSafe.isZero(currentStockMap.get(material.code)?.currentStock ?? '0'))
      .map((material) => {
        const stock = currentStockMap.get(material.code)?.currentStock ?? '0';
        const isNegative = DecimalSafe.isNegative(stock);
        const status = isNegative ? 'Deficit' : !material.isUnitConfirmed ? 'Locked' : 'Available';
        return { name: material.name, unit: material.isUnitConfirmed ? material.unit : 'Needs confirmation', stock, status };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const escapeHtml = (value: string) =>
      value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char);
    const printedAt = new Date().toLocaleString();
    const tableRows = rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td class="unit">${escapeHtml(row.unit)}</td>
        <td class="number">${escapeHtml(row.stock)}</td>
        <td>${escapeHtml(row.status)}</td>
      </tr>`).join('');

    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Camp Stock Inventory – Current Stock Summary</title>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 0; font-size: 10pt; }
  h1 { font-size: 18pt; margin: 0 0 7px; text-align: center; }
  .meta { display: flex; justify-content: space-between; gap: 20px; margin: 0 0 16px; font-size: 10pt; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  th, td { border: 1px solid #374151; padding: 7px 9px; text-align: left; }
  th { background: #e5e7eb !important; font-weight: 700; }
  td.number { text-align: right; font-variant-numeric: tabular-nums; }
  td.unit { width: 15%; }
  .footer { margin-top: 12px; font-weight: 700; text-align: right; }
  @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
</style></head><body>
<h1>Camp Stock Inventory – Current Stock Summary</h1>
<div class="meta"><span><strong>Warehouse / Camp:</strong> ${escapeHtml(currentLocation.name)}</span><span><strong>Print date &amp; time:</strong> ${escapeHtml(printedAt)}</span></div>
<table><thead><tr><th>Material Name</th><th>Unit</th><th>Current Stock</th><th>Status</th></tr></thead>
<tbody>${tableRows || '<tr><td colspan="4">No materials available.</td></tr>'}</tbody></table>
<div class="footer">Total materials: ${rows.length}</div>
<script>window.addEventListener('load', () => { window.focus(); window.print(); });</script>
</body></html>`;

    const printFrame = document.createElement('iframe');
    printFrame.title = 'Current Stock Summary print preview';
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = '0';
    printFrame.onload = () => {
      const frameWindow = printFrame.contentWindow;
      if (!frameWindow) return;
      frameWindow.addEventListener('afterprint', () => printFrame.remove(), { once: true });
    };
    document.body.appendChild(printFrame);
    const frameDocument = printFrame.contentDocument;
    if (!frameDocument) {
      printFrame.remove();
      return;
    }
    frameDocument.open();
    frameDocument.write(html);
    frameDocument.close();
  };

  // Materials shown in pickers: inactive ones are hidden (their history stays in every report)
  const activeCatalogue = useMemo(() => catalogue.filter((m) => m.isActive !== false), [catalogue]);

  // Handler: Catalogue edit (unit, status, name of custom items, current-stock quantity at the current location)
  const handleEditMaterial = (code: string, edit: MaterialEdit, staff: string): string | null => {
    const mat = catalogue.find((m) => m.code === code);
    if (!mat) return 'Material not found.';
    const name = mat.isCustom ? edit.name.trim().replace(/\s+/g, ' ') : mat.name;
    const clash = catalogue.find((m) => m.code !== code && m.name.toLowerCase() === name.toLowerCase());
    if (clash) return `"${clash.name}" already exists (${clash.code}).`;
    const updated: MaterialCatalogueItem = {
      ...mat, name, unit: edit.unit.trim().toUpperCase(), isUnitConfirmed: true, isActive: edit.isActive,
    };
    // The exact quantity typed is stored. The first count creates one record; later counts of the same material
    // change that SAME record (same Kobo submission), so Kobo never gets a second submission for it.
    const change = buildSnapshotBaseline({ material: updated, locationId: currentLocation.id, desiredQty: edit.currentStockQty, transactions, staff });
    setCatalogue((prev) => prev.map((m) => (m.code === code ? updated : m)));
    localDb.updateCatalogueItem(updated);
    if (change) {
      const next = change.tx;
      setTransactions((prev) => (change.replaces ? prev.map((t) => (t.clientTxUuid === next.clientTxUuid ? next : t)) : [next, ...prev]));
      setLastStaff(staff);
    }
    return null;
  };

  // Handler: add one or many materials, each with its current-stock quantity at the current location
  const handleBulkAdd = (rows: Array<{ name: string; unit: string; qty: string }>, staff: string): string | null => {
    const items = rows.map((r) => newCustomMaterial(r.name, r.unit));
    // one record per material (one material = one Kobo submission)
    const baselines = buildBaselineRecords({ items: items.map((m, i) => ({ material: m, qty: rows[i].qty })), locationId: currentLocation.id, staff });
    setCatalogue((prev) => [...prev, ...items]);
    localDb.addCatalogueItems(items);
    if (baselines.length > 0) { setTransactions((prev) => [...baselines, ...prev]); setLastStaff(staff); }
    return null;
  };

  const handleDeleteMaterials = (codes: string[]): string | null => {
    const codeSet = new Set(codes);
    const removed = catalogue.filter((material) => codeSet.has(material.code));
    if (removed.length !== codeSet.size) return 'Some selected materials are no longer in the catalogue. Refresh and try again.';
    setCatalogue((current) => current.filter((material) => !codeSet.has(material.code)));
    void localDb.deleteCatalogueItems(codes).catch(() => {
      setCatalogue((current) => [...current, ...removed].sort((a, b) => a.name.localeCompare(b.name)));
    });
    return null;
  };

  // Handler: save a finished multi-line transaction (Dispatch / Receive forms)
  const handleSaveTx = (tx: InventoryTransaction) => setTransactions((prev) => [tx, ...prev]);

  // Handler: custom material (never touches the 45 catalogue items)
  const handleCreateCustom = (name: string, unit: string): MaterialCatalogueItem | string => {
    const n = name.trim().replace(/\s+/g, ' ');
    const u = unit.trim().toUpperCase();
    if (!n || !u) return 'Enter a name and a unit.';
    const dup = catalogue.find((m) => m.name.toLowerCase() === n.toLowerCase());
    if (dup) return `"${dup.name}" already exists (${dup.code}). Select it from the list instead.`;
    const item: MaterialCatalogueItem = {
      code: `CUS-${newId().replace(/-/g, '').slice(0, 6).toUpperCase()}`,
      name: n, unit: u, isUnitConfirmed: true, isCustom: true, notes: 'Custom material added on device',
    };
    setCatalogue((prev) => [...prev, item]);
    localDb.updateCatalogueItem(item);
    return item;
  };

  // Handlers: suppliers
  const handleAddSupplier = (name: string, phone: string): Supplier | string => {
    const n = name.trim().replace(/\s+/g, ' ');
    if (!n) return 'Enter the supplier name.';
    const dup = suppliers.find((s) => s.name.toLowerCase() === n.toLowerCase());
    if (dup) return `A supplier named "${dup.name}" already exists.`;
    const sup: Supplier = { supplierId: `SUP-${newId().replace(/-/g, '').slice(0, 6).toUpperCase()}`, name: n, phone: phone.trim(), isActive: true };
    setSuppliers((prev) => [...prev, sup]);
    localDb.saveSuppliers([sup]);
    return sup;
  };
  const handleUpdateSupplier = (sup: Supplier): string | null => {
    if (!sup.name) return 'Enter the supplier name.';
    const dup = suppliers.find((s) => s.supplierId !== sup.supplierId && s.name.toLowerCase() === sup.name.toLowerCase());
    if (dup) return `A supplier named "${dup.name}" already exists.`;
    setSuppliers((prev) => prev.map((s) => (s.supplierId === sup.supplierId ? sup : s)));
    localDb.saveSuppliers([sup]);
    return null;
  };

  // Handler: Confirm Unit
  const handleConfirmUnit = async (code: string, unit: string) => {
    if (!unit.trim()) return;
    const cleanUnit = unit.trim().toUpperCase();
    const updated = catalogue.map((m) =>
      m.code === code ? { ...m, unit: cleanUnit, isUnitConfirmed: true } : m
    );
    setCatalogue(updated);
    const item = updated.find((m) => m.code === code);
    if (item) await localDb.updateCatalogueItem(item);
    setConfirmUnitModal(null);
    setNewUnitInput('');
  };

  // Handler: Record Transaction
  const handleRecordTransaction = (type: TransactionType) => {
    setTxFormError('');
    setTxSuccessMessage('');

    if (!txRefNo.trim() || !txStaffId.trim() || !txSelectedMaterial || !txQuantity.trim()) {
      setTxFormError('Please fill in all mandatory fields.');
      return;
    }

    const valResult = validateMaterialForTransaction(txSelectedMaterial);
    if (!valResult.allowed) {
      setTxFormError(valResult.reason || 'Material unit not confirmed.');
      return;
    }

    const uuid = crypto.randomUUID ? crypto.randomUUID() : `tx-${Date.now()}`;
    const now = new Date().toISOString();

    const newTx: InventoryTransaction = {
      clientTxUuid: uuid,
      txType: type,
      txDateTime: now,
      sourceLocationId:
        type === 'RECEIPT' ? 'SUPPLIER' : currentLocation.id,
      destinationLocationId:
        type === 'RECEIPT' || type === 'RETURN' || type === 'ADJUSTMENT_POS' || type === 'ADJUSTMENT_NEG'
          ? currentLocation.id
          : txDestinationLocation,
      staffId: txStaffId.trim(),
      referenceNumber: txRefNo.trim(),
      notes: txNotes.trim() || undefined,
      lines: [
        {
          lineId: `${uuid}-line-1`,
          materialCode: txSelectedMaterial.code,
          materialName: txSelectedMaterial.name,
          quantity: DecimalSafe.fromScaledInt(DecimalSafe.toScaledInt(txQuantity)),
          unit: txSelectedMaterial.unit,
        },
      ],
      syncStatus: 'PENDING',
      createdAt: now,
      modifiedAt: now,
    };

    setTransactions((prev) => [newTx, ...prev]);
    setTxSuccessMessage(`Transaction ${newTx.referenceNumber} recorded (saved locally in IndexedDB).`);
    setTxRefNo('');
    setTxQuantity('');
    setTxNotes('');
  };

  // Handlers: physical count review. Stock is only changed here, by an explicit adjustment.
  const handleCreateCountAdjustment = (c: PhysicalStockCount) => {
    if (c.status !== 'PENDING_REVIEW') return;
    const nowQty = currentStockMap.get(c.materialCode)?.currentStock || '0';
    if (!DecimalSafe.isZero(DecimalSafe.subtract(nowQty, c.systemCalculatedQty))) {
      setCountMessage('Stock changed after this count, so no adjustment was made. Dismiss it and count again.');
      return;
    }
    if (DecimalSafe.isZero(c.discrepancyQty)) {
      setCountMessage('No difference, nothing to adjust.');
      return;
    }
    const positive = DecimalSafe.isPositive(c.discrepancyQty);
    const qty = positive ? c.discrepancyQty : c.discrepancyQty.replace('-', '');
    const mat = catalogue.find((m) => m.code === c.materialCode);
    const uuid = newId();
    const iso = new Date().toISOString();
    const tx: InventoryTransaction = {
      clientTxUuid: uuid,
      txType: positive ? 'ADJUSTMENT_POS' : 'ADJUSTMENT_NEG',
      txDateTime: c.countDate,
      sourceLocationId: c.locationId,
      destinationLocationId: c.locationId,
      staffId: c.auditedByStaffId,
      referenceNumber: `ADJ-CNT-${c.countId.replace(/-/g, '').slice(0, 6).toUpperCase()}`,
      notes: `Reason: Physical count ${c.countDate.slice(0, 10)}. System ${c.systemCalculatedQty}, counted ${c.physicalCountedQty}.`,
      lines: [{ lineId: `${uuid}-line-1`, materialCode: c.materialCode, materialName: mat?.name || c.materialCode, quantity: qty, unit: c.unit }],
      syncStatus: 'PENDING',
      createdAt: iso,
      modifiedAt: iso,
    };
    const updated: PhysicalStockCount = { ...c, status: 'ADJUSTMENT_CREATED', approvedAdjustmentTxUuid: uuid };
    setTransactions((prev) => [tx, ...prev]);
    setPhysicalCounts((prev) => prev.map((x) => (x.countId === c.countId ? updated : x)));
    localDb.savePhysicalCount(updated);
    setCountMessage('Adjustment created and queued for sync.');
  };
  const handleDismissCount = (c: PhysicalStockCount) => {
    if (c.status !== 'PENDING_REVIEW') return;
    const updated: PhysicalStockCount = { ...c, status: 'DISMISSED' };
    setPhysicalCounts((prev) => prev.map((x) => (x.countId === c.countId ? updated : x)));
    localDb.savePhysicalCount(updated);
    setCountMessage('Count dismissed. Stock was not changed.');
  };

  // Handler: Physical Count Audit
  const handleRecordPhysicalCount = () => {
    if (!countMaterial || !physicalObservedQty.trim() || !countAuditor.trim()) return;

    const summary = currentStockMap.get(countMaterial.code);
    const systemQty = summary?.currentStock || '0';
    const discrepancy = DecimalSafe.subtract(physicalObservedQty, systemQty);

    const count: PhysicalStockCount = {
      countId: newId(),
      countDate: new Date().toISOString(),
      locationId: currentLocation.id,
      materialCode: countMaterial.code,
      unit: countMaterial.unit,
      systemCalculatedQty: systemQty,
      physicalCountedQty: physicalObservedQty,
      discrepancyQty: discrepancy,
      auditedByStaffId: countAuditor,
      notes: countNotes,
      status: 'PENDING_REVIEW',
    };

    setPhysicalCounts((prev) => [count, ...prev]);
    localDb.savePhysicalCount(count);
    setCountMaterial(null);
    setPhysicalObservedQty('');
    setCountAuditor('');
    setCountNotes('');
  };

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Warehouse },
    { id: 'stock', label: 'Current Stock', icon: Layers },
    { id: 'receive', label: 'Receive Materials', icon: ArrowDownLeft },
    { id: 'dispatch', label: 'Dispatch Materials', icon: ArrowUpRight },
    { id: 'drr', label: "Today's MRF Records", icon: FolderKanban },
    { id: 'suppliers', label: 'Suppliers', icon: Truck },
    { id: 'returns', label: 'Returns', icon: RotateCcw },
    { id: 'transfers', label: 'Staff Handover', icon: Repeat },
    { id: 'adjustments', label: 'Stock Adjustments', icon: Sliders },
    { id: 'counts', label: 'Physical Counts', icon: ClipboardCheck },
    { id: 'history', label: 'Transaction History', icon: History },
    { id: 'daily', label: 'Daily Records', icon: Grid },
    { id: 'catalogue', label: 'Material Catalogue', icon: Package },
    { id: 'reports', label: 'Reports', icon: FileText },
    { id: 'sync', label: 'Sync Centre', icon: RefreshCw },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 font-sans text-slate-800 antialiased">
      {showClean && (
        <CleanRecordsModal
          transactions={transactions}
          onClose={() => setShowClean(false)}
          onWipe={async () => {
            await localDb.clearAllRecords();
            setTransactions([]);
            setPhysicalCounts([]);
          }}
        />
      )}
      {editingSyncDraft && (
        <SyncDraftEditor
          transaction={editingSyncDraft}
          catalogue={catalogue}
          suppliers={suppliers}
          onClose={() => setEditingSyncDraft(null)}
          onSave={(updated) => {
            setTransactions((current) => current.map((transaction) =>
              transaction.clientTxUuid === updated.clientTxUuid ? updated : transaction
            ));
            void localDb.saveTransaction(updated);
            setEditingSyncDraft(null);
            setSyncMessage('Draft updated locally. Review it before syncing to Kobo.');
          }}
        />
      )}
      {lockedScreen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={(event) => { event.preventDefault(); unlockScreen(); }}
            className="w-full max-w-sm space-y-4 rounded-xl bg-white p-5 shadow-xl"
          >
            <div>
              <h3 className="text-base font-bold text-slate-900">Password required</h3>
              <p className="mt-1 text-xs text-slate-500">Enter the password to open {lockedScreen === 'catalogue' ? 'Material Catalogue' : 'Settings'}.</p>
            </div>
            <input
              type="password"
              autoFocus
              value={screenPassword}
              onChange={(event) => { setScreenPassword(event.target.value); setScreenPasswordError(''); }}
              aria-label="Access password"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-500"
            />
            {screenPasswordError && <p className="text-xs font-semibold text-red-600">{screenPasswordError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setLockedScreen(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
              <button type="submit" className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-700">Continue</button>
            </div>
          </form>
        </div>
      )}
      {/* Sidebar Navigation */}
      <aside className="flex w-72 flex-col border-r border-slate-200 bg-white shadow-xs">
        {/* Brand Header */}
        <div
          className="flex select-none items-center gap-3 border-b border-slate-100 p-5"
          onPointerDown={startLongPress}
          onPointerUp={cancelLongPress}
          onPointerLeave={cancelLongPress}
          onPointerCancel={cancelLongPress}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-600 text-white shadow-sm">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-900">Camp Stock</h1>
            <p className="text-xs font-medium text-slate-500">Inventory Management System</p>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {navItems.map((item) => {
            const IconComponent = item.icon;
            const isActive = activeScreen === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  requestScreen(item.id);
                  setTxSuccessMessage('');
                  setTxFormError('');
                  if (item.id === 'sync') setSyncMessage('');
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors ${isActive
                  ? 'bg-sky-50 text-sky-700 font-semibold'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
              >
                <IconComponent
                  className={`h-4 w-4 ${isActive ? 'text-sky-600' : 'text-slate-400'}`}
                />
                <span className="flex-1 text-left">{item.label}</span>
                {item.id === 'catalogue' && unconfirmedCount > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                    {unconfirmedCount}
                  </span>
                )}
                {item.id === 'sync' && pendingSyncCount > 0 && (
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-800">
                    {pendingSyncCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom Status Box */}
        <div className="border-t border-slate-100 p-4">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Smartphone className="h-4 w-4 text-slate-400" />
            <span>Kobo Central Ledger Mode</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">Offline IndexedDB • Zero Deletion</p>
        </div>
      </aside>

      {/* Main Content Viewport */}
      <main className="flex flex-1 flex-col overflow-y-auto">
        {/* Top Header */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-8">
          <div className="flex items-center gap-3">
            {/* IOM Stock Records has no menu item: open it with the keyboard shortcut Ctrl, then I, S, R. */}
            <h2
              className="select-none text-lg font-bold text-slate-900"
            >
              {activeScreen === 'iom' ? 'IOM Stock Records' : navItems.find((n) => n.id === activeScreen)?.label}
            </h2>
          </div>

          <div className="flex items-center gap-4">
            {pendingSyncCount > 0 && (
              <button
                onClick={() => setActiveScreen('sync')}
                className="flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>{pendingSyncCount} Pending Sync</span>
              </button>
            )}
            <div className="text-right text-xs">
              <p className="font-semibold text-slate-700">IndexedDB Local Cache Active</p>
              <p className="text-slate-400">Direct Kobo Sync</p>
            </div>
          </div>
        </header>

        {/* Content Body */}
        <div className="flex-1 p-8">
          {/* SCREEN 1: DASHBOARD */}
          {activeScreen === 'dashboard' && (
            <div className="space-y-6">
              <div className="grid grid-cols-4 gap-4">
                <button onClick={() => setActiveScreen('drr')} className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-xs hover:border-sky-300">
                  <p className="text-xs font-medium text-slate-500">Daily Dispatch</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{todayStats.dispatch.records}</p>
                  <p className="mt-1 text-xs text-sky-600 font-medium">Today • {todayStats.dispatch.lines} material line(s)</p>
                </button>
                <button onClick={() => setActiveScreen('receive')} className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-xs hover:border-sky-300">
                  <p className="text-xs font-medium text-slate-500">Received Materials</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{todayStats.received.records}</p>
                  <p className="mt-1 text-xs text-emerald-600 font-medium">Today • {todayStats.received.lines} material line(s)</p>
                </button>
                <button onClick={() => setActiveScreen('returns')} className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-xs hover:border-sky-300">
                  <p className="text-xs font-medium text-slate-500">Returns</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{todayStats.returns.records}</p>
                  <p className="mt-1 text-xs text-amber-600 font-medium">Today • {todayStats.returns.lines} material line(s)</p>
                </button>
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                  <p className="text-xs font-medium text-slate-500">Sync Queue Status</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">
                    {dashboardTransactions.filter((t) => t.syncStatus === 'SYNCED').length} Synced
                  </p>
                  <p className="mt-1 text-xs text-slate-400">{dashboardPendingSyncCount} Pending</p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
                  Quick Stock Actions
                </h3>
                <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
                  {['dispatch', 'returns', 'stock', 'drr'].map((id) => {
                    const item = navItems.find((n) => n.id === id)!;
                    const TileIcon = item.icon;
                    return (
                      <button
                        key={id}
                        onClick={() => setActiveScreen(id as typeof activeScreen)}
                        className="flex items-center gap-3 rounded-lg border border-slate-200 p-4 text-left hover:border-sky-500 hover:bg-sky-50/50"
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
                          <TileIcon className="h-5 w-5" />
                        </div>
                        <p className="text-sm font-bold text-slate-800">{item.label}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* SCREEN 2: CURRENT STOCK */}
          {activeScreen === 'stock' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="relative w-80">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search material name..."
                    className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold text-slate-500">
                    <tr>
                      <th className="py-3 px-4">Material Name</th>
                      <th className="py-3 px-4">Unit</th>
                      <th className="py-3 px-4 text-right">Received</th>
                      <th className="py-3 px-4 text-right">Dispatched</th>
                      <th className="py-3 px-4 text-right">Current Stock</th>
                      <th className="py-3 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {catalogue
                      .filter((m) => !DecimalSafe.isZero(currentStockMap.get(m.code)?.currentStock ?? '0'))
                      .filter(
                        (m) =>
                          m.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          m.name.toLowerCase().includes(searchQuery.toLowerCase())
                      )
                      .map((mat) => {
                        const stock = currentStockMap.get(mat.code)!;
                        const isNegative = DecimalSafe.isNegative(stock.currentStock);
                        return (
                          <tr key={mat.code} className="hover:bg-slate-50/80">
                            <td className="py-3 px-4 font-medium text-slate-900">{mat.name}</td>
                            <td className="py-3 px-4">
                              {mat.isUnitConfirmed ? (
                                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                                  {mat.unit}
                                </span>
                              ) : (
                                <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                                  NEEDS CONFIRMATION
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right text-emerald-600 font-medium">
                              {stock.receipts}
                            </td>
                            <td className="py-3 px-4 text-right text-slate-600">{stock.dispatches}</td>
                            <td
                              className={`py-3 px-4 text-right font-bold ${isNegative ? 'text-red-600' : 'text-slate-900'
                                }`}
                            >
                              {stock.currentStock}
                            </td>
                            <td className="py-3 px-4">
                              {isNegative ? (
                                <span className="flex items-center gap-1 text-xs font-bold text-red-600">
                                  <AlertCircle className="h-3.5 w-3.5" /> Deficit
                                </span>
                              ) : !mat.isUnitConfirmed ? (
                                <span className="text-xs font-medium text-amber-600">Locked</span>
                              ) : (
                                <span className="text-xs font-medium text-emerald-600">Available</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SCREEN 3: RECEIVE MATERIALS */}
          {activeScreen === 'receive' && (
            <ReceiveForm
              currentLocation={currentLocation} catalogue={activeCatalogue} suppliers={suppliers} transactions={transactions}
              onSave={handleSaveTx} onAddSupplier={handleAddSupplier} onCreateCustom={handleCreateCustom} onConfirmUnit={handleConfirmUnit}
            />
          )}

          {activeScreen === 'dispatch' && (
            <DispatchForm
              currentLocation={currentLocation} catalogue={activeCatalogue} transactions={transactions}
              availability={(code) => currentStockMap.get(code)?.currentStock ?? '0'}
              onSave={handleSaveTx} onCreateCustom={handleCreateCustom} onConfirmUnit={handleConfirmUnit}
            />
          )}

          {activeScreen === 'iom' && <IomStockRecords />}

          {activeScreen === 'drr' && <MrfRecords currentLocation={currentLocation} catalogue={catalogue} transactions={transactions} />}

          {activeScreen === 'returns' && (
            <ReturnForm
              currentLocation={currentLocation} catalogue={catalogue} transactions={transactions}
              onSave={handleSaveTx} onCreateCustom={handleCreateCustom} onConfirmUnit={handleConfirmUnit}
            />
          )}

          {activeScreen === 'adjustments' && (
            <AdjustmentsForm
              currentLocation={currentLocation} catalogue={activeCatalogue}
              availability={(code) => currentStockMap.get(code)?.currentStock ?? '0'}
              onSave={handleSaveTx} onCreateCustom={handleCreateCustom} onConfirmUnit={handleConfirmUnit}
            />
          )}

          {activeScreen === 'suppliers' && (
            <SuppliersPanel suppliers={suppliers} transactions={transactions} onAdd={handleAddSupplier} onUpdate={handleUpdateSupplier} />
          )}

          {/* SCREEN 6: TRANSFERS (RULE 10) */}
          {activeScreen === 'transfers' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-900">Staff Handover</h3>
                <p className="text-xs text-slate-500">
                  Staff handover when a staff member changes camp.
                </p>
              </div>

              <StaffHandover currentLocation={currentLocation} catalogue={catalogue} transactions={transactions} onSave={handleSaveTx} />
            </div>
          )}

          {/* SCREEN 8: PHYSICAL STOCK COUNTS */}
          {activeScreen === 'counts' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-900">Physical Stock Count Audits</h3>
                <p className="text-xs text-slate-500">
                  Performs physical inventory audits. Physical counts do not silently overwrite system balances.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
                  <h4 className="text-sm font-bold text-slate-800">Record Physical Count</h4>
                  <div>
                    <label className="text-xs font-semibold text-slate-600">Select Material *</label>
                    <select
                      value={countMaterial?.code || ''}
                      onChange={(e) => setCountMaterial(catalogue.find((m) => m.code === e.target.value) || null)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-500"
                    >
                      <option value="">-- Choose Material --</option>
                      {catalogue.map((m) => (
                        <option key={m.code} value={m.code}>
                          {m.code} - {m.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {countMaterial && (
                    <div className="rounded-lg bg-slate-50 p-3 text-xs">
                      <p className="text-slate-500">System Calculated Stock Balance:</p>
                      <p className="text-base font-bold text-slate-800">
                        {currentStockMap.get(countMaterial.code)?.currentStock} {countMaterial.unit}
                      </p>
                    </div>
                  )}

                  <div>
                    <label className="text-xs font-semibold text-slate-600">Physical Counted Quantity *</label>
                    <input
                      type="number"
                      step="any"
                      value={physicalObservedQty}
                      onChange={(e) => setPhysicalObservedQty(e.target.value)}
                      placeholder="Actual counted count"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-500"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-600">Auditor Name / Staff ID *</label>
                    <input
                      type="text"
                      value={countAuditor}
                      onChange={(e) => setCountAuditor(e.target.value)}
                      placeholder="Auditor staff name"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-500"
                    />
                  </div>

                  <button
                    onClick={handleRecordPhysicalCount}
                    className="w-full rounded-lg bg-sky-600 py-2.5 text-sm font-bold text-white shadow-xs hover:bg-sky-700"
                  >
                    Submit Physical Count Audit
                  </button>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
                  <h4 className="text-sm font-bold text-slate-800">Audit Discrepancy Log</h4>
                  {countMessage && <p className="rounded-lg bg-slate-50 p-2 text-xs font-semibold text-slate-700">{countMessage}</p>}
                  <div className="divide-y divide-slate-100 max-h-[400px] overflow-y-auto">
                    {physicalCounts.length === 0 ? (
                      <p className="py-8 text-center text-xs text-slate-400">No physical counts recorded yet.</p>
                    ) : (
                      physicalCounts.map((c) => (
                        <div key={c.countId} className="py-3 text-xs">
                          <div className="flex justify-between items-center">
                            <span className="font-bold text-slate-800">{c.materialCode}</span>
                            <span
                              className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${DecimalSafe.isZero(c.discrepancyQty)
                                ? 'bg-emerald-100 text-emerald-800'
                                : DecimalSafe.isPositive(c.discrepancyQty)
                                  ? 'bg-sky-100 text-sky-800'
                                  : 'bg-red-100 text-red-800'
                                }`}
                            >
                              Variance: {c.discrepancyQty} {c.unit}
                            </span>
                          </div>
                          <p className="mt-1 text-slate-500">
                            System: {c.systemCalculatedQty} | Physical: {c.physicalCountedQty}
                          </p>
                          <p className="mt-1 font-semibold text-slate-600">
                            {c.status === 'PENDING_REVIEW' ? 'Pending review' : c.status === 'ADJUSTMENT_CREATED' ? 'Adjustment created' : 'Dismissed'}
                          </p>
                          {c.status === 'PENDING_REVIEW' && (
                            <div className="mt-2 flex gap-2">
                              <button
                                onClick={() => handleCreateCountAdjustment(c)}
                                className="rounded-lg bg-sky-600 px-3 py-1.5 font-bold text-white hover:bg-sky-700"
                              >
                                Create adjustment
                              </button>
                              <button
                                onClick={() => handleDismissCount(c)}
                                className="rounded-lg border border-slate-200 px-3 py-1.5 font-bold text-slate-700 hover:bg-slate-50"
                              >
                                Dismiss
                              </button>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SCREEN 10: DAILY RECORDS */}
          {activeScreen === 'daily' && <DailyRecords currentLocation={currentLocation} catalogue={catalogue} transactions={transactions} />}

          {/* SCREEN 12: REPORTS */}
          {activeScreen === 'reports' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-900">Warehouse Reports & Slips</h3>
                <p className="text-xs text-slate-500">
                  Generate official dispatch slips, stock movement summaries, and daily position statements.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="flex h-full flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                  <Printer className="h-6 w-6 text-sky-600" />
                  <h4 className="text-sm font-bold text-slate-800">Material Dispatch Slips</h4>
                  <p className="text-xs text-slate-500">
                    Printable dispatch vouchers formatted for field driver verification and destination handovers.
                  </p>
                  <button
                    onClick={printCurrentStockSummary}
                    className="mt-auto w-full rounded-lg border border-slate-200 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                  >
                    Print Current Stock Summary
                  </button>
                </div>

                <div className="flex h-full flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                  <FileText className="h-6 w-6 text-indigo-600" />
                  <h4 className="text-sm font-bold text-slate-800">Audit Discrepancy Statement</h4>
                  <p className="text-xs text-slate-500">
                    Official discrepancy log comparing system calculated quantities against counted physical stock.
                  </p>
                  <button
                    onClick={() => setActiveScreen('counts')}
                    className="mt-auto w-full rounded-lg border border-slate-200 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                  >
                    Review Audits
                  </button>
                </div>
              </div>

              <ExcelExports
                currentLocation={currentLocation} catalogue={catalogue} suppliers={suppliers} transactions={transactions}
                loadAllRecords={async () => {
                  if (!(koboConfig.token && koboConfig.formUid)) return transactions;
                  const res = await koboClient.fetchSubmissions(koboConfig, catalogue);
                  if (!res.success || !res.records) return transactions;
                  const have = new Set(transactions.map((t) => t.clientTxUuid));
                  return [...transactions, ...res.records.filter((r) => !have.has(r.clientTxUuid))];
                }}
              />
            </div>
          )}

          {/* SCREEN 11: MATERIAL CATALOGUE */}
          {activeScreen === 'catalogue' && (
            <CatalogueManager
              currentLocation={currentLocation} catalogue={catalogue} transactions={transactions}
              onEdit={handleEditMaterial} onBulkAdd={handleBulkAdd} onDelete={handleDeleteMaterials}
            />
          )}

          {/* SCREEN 9: TRANSACTION AUDIT LEDGER */}
          {activeScreen === 'history' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Transaction Audit History</h3>
                <p className="text-xs text-slate-500">
                  Records of received and dispatched materials. Manage supplier records in Suppliers.
                </p>
              </div>

              {historyTransactions.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-xs text-slate-400">
                  No received or dispatched material records on this device yet.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                  <table className="w-full min-w-[900px] text-left text-xs">
                    <thead className="bg-slate-50 text-[11px] font-bold uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-3">Date / Time</th><th className="px-3 py-3">Type</th>
                        <th className="px-3 py-3">Reference</th>
                        <th className="px-3 py-3 text-right">Quantity</th><th className="px-3 py-3">Staff</th><th className="px-3 py-3">Sync</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {historyTransactions.map((tx) => (
                        <tr key={tx.clientTxUuid} className="align-top hover:bg-slate-50/70">
                          <td className="whitespace-nowrap px-3 py-3 text-slate-600">{new Date(tx.txDateTime).toLocaleString()}</td>
                          <td className="px-3 py-3 font-semibold text-sky-800">{tx.txType === 'STOCK_BASELINE' ? 'Current Stock Baseline' : tx.txType.replaceAll('_', ' ')}</td>
                          <td className="px-3 py-3 font-medium text-slate-700">{tx.referenceNumber}</td>
                          <td className="px-3 py-3 text-right font-semibold tabular-nums">{tx.lines.map((line) => <div key={line.lineId}>{line.quantity} {line.unit}</div>)}</td>
                          <td className="px-3 py-3">{tx.staffId}</td>
                          <td className="px-3 py-3">{tx.syncStatus}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* SCREEN 13: SYNC CENTRE */}
          {activeScreen === 'sync' && pendingTransactions.length > 0 && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-900">KoboToolbox Synchronization Centre</h3>
                <p className="text-xs text-slate-500">
                  Local-first offline operation with direct synchronization to KoboToolbox.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-slate-800">Pending Outgoing Queue</h4>
                    <p className="text-xs text-slate-500">{pendingSyncCount} transaction(s) ready to sync</p>
                  </div>
                  <span className="rounded-md bg-sky-50 px-3 py-1 text-xs font-bold text-sky-700">
                    {pendingSyncCount} Items
                  </span>
                </div>

                <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                  <p className="font-semibold text-slate-800">Tauri Windows Architecture (Stage 7 Approved):</p>
                  <p className="mt-1">
                    Direct OS-level TCP/TLS network calls via Tauri Rust backend bypass browser CORS restrictions.
                    Zero custom servers required.
                  </p>
                </div>

                {syncMessage && (
                  <p className="whitespace-pre-line rounded-lg bg-slate-50 p-3 text-xs font-semibold text-slate-700">{syncMessage}</p>
                )}

                <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <p className="text-xs font-bold text-slate-800">Drafts - not yet confirmed on Kobo ({pendingTransactions.length})</p>
                  <p className="text-xs text-slate-500">Review, edit, or delete receipt, dispatch, and return drafts before syncing.</p>
                  {pendingTransactions.map((t) => (
                    <div key={t.clientTxUuid} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-slate-700">{t.txType} {t.drrCode || ''} {t.mrfNumber || ''} • {t.lines.length} material(s) • {(t.txDateTime || '').slice(0, 10)}</span>
                      <div className="flex items-center gap-3">
                        {t.koboSubmissionId ? (
                          <span className="font-semibold text-sky-700">Update waiting for existing Kobo record</span>
                        ) : t.syncStatus === 'OUTCOME_UNKNOWN' ? (
                          <span className="font-semibold text-amber-700">Sync result unknown; retry before editing</span>
                        ) : (
                          <>
                            {['RECEIPT', 'DISPATCH', 'RETURN'].includes(t.txType) && (
                              <button onClick={() => setEditingSyncDraft(t)} className="font-bold text-sky-700 hover:underline">Edit</button>
                            )}
                            <button
                              onClick={async () => {
                                if (!window.confirm('Delete this draft? It was never confirmed on Kobo. The stock goes back.')) return;
                                await localDb.deleteTransaction(t.clientTxUuid);
                                setTransactions((prev) => prev.filter((x) => x.clientTxUuid !== t.clientTxUuid));
                              }}
                              className="font-bold text-red-600 hover:underline"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={async () => {
                    setIsSyncing(true);
                    try {
                      setSyncMessage('Pulling records from Kobo...');
                      // 1. learn what other people / devices already recorded (skipped quietly when there is no network)
                      let ledger = transactions;
                      if (koboConfig.token && koboConfig.formUid) {
                        try {
                          const pulled = await koboClient.fetchSubmissions(koboConfig, catalogue);
                          if (pulled.success && pulled.records) {
                            // new records are added, records edited on another device are updated, nothing is ever duplicated
                            ledger = mergeRemote(transactions, pulled.records).records;
                            setTransactions(ledger);
                          }
                        } catch { /* no network: continue and try to send anyway */ }
                      }
                      // 2. warn about drafts that repeat an existing record
                      const queue = ledger.filter((t) => t.syncStatus === 'PENDING' || t.syncStatus === 'FAILED' || t.syncStatus === 'OUTCOME_UNKNOWN');
                      const hits = findDuplicates(ledger, queue.filter((t) => t.syncStatus !== 'OUTCOME_UNKNOWN' && !t.koboSubmissionId));
                      if (hits.length > 0 && !window.confirm(`Possible duplicates:\n\n${hits.map((h) => '• ' + h.message).join('\n')}\n\nOK = send anyway. Cancel = go back and delete the wrong draft.`)) {
                        setSyncMessage('Cancelled. Nothing was sent. Delete the wrong draft, then press Close day and sync again.');
                        return;
                      }
                      // 3. send the drafts
                      setSyncMessage('Sending drafts to Kobo...');
                      let ok = 0;
                      let fail = 0;
                      let created = 0;
                      let updatedN = 0;
                      let lastError = '';
                      const warnings: string[] = [];
                      for (const tx of queue) {
                        // New record -> one new Kobo submission. Record that already has a Kobo _id -> that SAME submission is updated.
                        // A record whose last attempt dropped is looked up on Kobo first, so it is never sent twice.
                        const out = await syncTransaction(tx, koboConfig, koboClient, ledger);
                        setTransactions((prev) => prev.map((t) => (t.clientTxUuid === tx.clientTxUuid ? out.tx : t)));
                        if (out.kind === 'failed' || out.kind === 'unknown') {
                          fail++;
                          lastError = out.error || 'Unknown error';
                          if (/HTTP 40[13]|missing|NOT sent/.test(lastError)) break;
                        } else {
                          ok++;
                          if (out.kind === 'created') created++;
                          if (out.kind === 'updated') updatedN++;
                          if (out.warning) warnings.push(out.warning);
                        }
                      }
                      setSyncMessage(`${ok} synced with Kobo (${created} new, ${updatedN} existing records updated), ${fail} failed.${lastError ? ' Last error: ' + lastError : ''}${warnings.length ? '\nCheck: ' + warnings.join(' ') : ''}${fail > 0 ? '\nThe failed records are kept. Press Close day and sync again when the network is good.' : ''}`);
                    } catch (e: any) {
                      setSyncMessage(`Sync stopped: ${e?.message || 'network problem'}. Your records are safe. Press Close day and sync again.`);
                    } finally {
                      setIsSyncing(false);
                    }
                  }}
                  disabled={isSyncing}
                  className="w-full rounded-lg bg-sky-600 py-2.5 text-sm font-bold text-white shadow-xs hover:bg-sky-700 disabled:opacity-50"
                >
                  Close day and sync
                </button>
              </div>
            </div>
          )}

          {/* SCREEN 14: SETTINGS */}
          {activeScreen === 'settings' && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-900">Application Settings</h3>
                <p className="text-xs text-slate-500">
                  Configure KoboToolbox server, transactions asset UID, and service account API token.
                </p>
              </div>

              {configStatusMessage && (
                <div className="rounded-lg bg-sky-50 p-3 text-xs font-semibold text-sky-800">
                  {configStatusMessage}
                </div>
              )}

              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
                <div>
                  <label className="text-xs font-semibold text-slate-600">Kobo Server URL</label>
                  <input
                    type="text"
                    value={koboConfig.serverUrl}
                    onChange={(e) => setKoboConfig({ ...koboConfig, serverUrl: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-600">Records Form UID (received, dispatched, returned)</label>
                  <input
                    type="text"
                    value={koboConfig.formUid}
                    onChange={(e) => setKoboConfig({ ...koboConfig, formUid: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600">Staff Handover & Supplies Form UID</label>
                  <input
                    type="text"
                    value={koboConfig.uidHandover || ''}
                    onChange={(e) => setKoboConfig({ ...koboConfig, uidHandover: e.target.value.trim() })}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600">Stock Balance Form UID (starting balance and stock adjustments)</label>
                  <input
                    type="text"
                    value={koboConfig.uidStock || ''}
                    onChange={(e) => setKoboConfig({ ...koboConfig, uidStock: e.target.value.trim() })}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600">Material Catalogue Form UID</label>
                  <input
                    type="text"
                    value={koboConfig.uidCatalogue || ''}
                    onChange={(e) => setKoboConfig({ ...koboConfig, uidCatalogue: e.target.value.trim() })}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-600">Form ID (old, not used any more - detected automatically, used for submissions)</label>
                  <input
                    type="text"
                    value={koboConfig.formId}
                    onChange={(e) => setKoboConfig({ ...koboConfig, formId: e.target.value.trim() })}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-600">Service Account API Token</label>
                  <input
                    type="password"
                    value={koboConfig.token}
                    onChange={(e) => setKoboConfig({ ...koboConfig, token: e.target.value })}
                    placeholder="Enter dedicated bot account token"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-500"
                  />
                </div>

                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <button
                      onClick={async () => {
                        setConfigStatusMessage('Testing connection...');
                        const res = await koboClient.testConnection(koboConfig);
                        setConfigStatusMessage(res.message);
                      }}
                      className="flex-1 rounded-lg border border-slate-200 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    >
                      Test Connection
                    </button>
                    <button
                      onClick={() => {
                        try {
                          localStorage.setItem('campStockKoboConfig', JSON.stringify(koboConfig));
                          setConfigStatusMessage('Configuration saved on this computer.');
                        } catch {
                          setConfigStatusMessage('Could not save configuration.');
                        }
                      }}
                      className="flex-1 rounded-lg bg-sky-600 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-sky-700"
                    >
                      Save Settings
                    </button>
                  </div>
                  <div className="space-y-3">
                    <button
                      onClick={async () => {
                        setConfigStatusMessage('Downloading records from Kobo...');
                        const result = await koboClient.fetchSubmissions(koboConfig, catalogue);
                        if (!result.success || !result.records) { setConfigStatusMessage(result.error || 'Kobo restore failed.'); return; }
                        const merged = mergeRemote(transactions, result.records);
                        setTransactions(merged.records);
                        setConfigStatusMessage(`Kobo restore complete: ${merged.added} new record(s) added, ${merged.updated} existing record(s) updated from Kobo, ${merged.linked} linked to their Kobo submission${merged.keptLocal ? `, ${merged.keptLocal} newer local edit(s) kept for the next sync` : ''}. The endpoint returned ${result.records.length} record(s).`);
                      }}
                      className="w-full rounded-lg border border-sky-200 py-2.5 text-xs font-bold text-sky-800 hover:bg-sky-50"
                    >
                      Restore records from Kobo
                    </button>
                    <button
                      onClick={async () => {
                        setConfigStatusMessage('Downloading catalogue from Kobo...');
                        const res = await koboClient.fetchCatalogue(koboConfig);
                        if (!res.success || !res.items) { setConfigStatusMessage(res.error || 'Catalogue download failed.'); return; }
                        if (res.items.length === 0) { setConfigStatusMessage('The Kobo catalogue is empty. Use "Upload catalogue to Kobo" first.'); return; }
                        let added = 0;
                        let updated = 0;
                        const merged = [...catalogue];
                        for (const remote of res.items) {
                          const i = merged.findIndex((m) => m.code === remote.code);
                          if (i < 0) { merged.push(remote); await localDb.updateCatalogueItem(remote); added++; }
                          else {
                            const m = merged[i];
                            if (m.name !== remote.name || m.unit !== remote.unit || m.isUnitConfirmed !== remote.isUnitConfirmed || (m.isActive !== false) !== (remote.isActive !== false)) {
                              const next = { ...m, name: remote.name, unit: remote.unit, isUnitConfirmed: remote.isUnitConfirmed, isActive: remote.isActive };
                              merged[i] = next; await localDb.updateCatalogueItem(next); updated++;
                            }
                          }
                        }
                        setCatalogue(merged);
                        setConfigStatusMessage(`Catalogue downloaded from Kobo: ${added} added, ${updated} updated, ${res.items.length - added - updated} unchanged.`);
                      }}
                      className="w-full rounded-lg border border-slate-200 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    >
                      Download catalogue from Kobo
                    </button>
                    <button
                      onClick={async () => {
                        setConfigStatusMessage('Uploading catalogue to Kobo...');
                        const res = await koboClient.uploadCatalogue(catalogue, koboConfig, currentLocation.id, Object.fromEntries([...currentStockMap.entries()].map(([code, stock]) => [code, stock.currentStock])));
                        setConfigStatusMessage(res.success ? `Catalogue uploaded to Kobo: ${res.sent} sent, ${res.same} already up to date.` : (res.error || 'Catalogue upload failed.'));
                      }}
                      className="w-full rounded-lg border border-slate-200 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    >
                      Upload catalogue to Kobo
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* MODAL: Unit Confirmation */}
      {confirmUnitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h4 className="text-base font-bold text-slate-900">Confirm Unit of Measurement</h4>
            <p className="mt-1 text-xs text-slate-500">
              Set standard unit for <strong>{confirmUnitModal.code}</strong> ({confirmUnitModal.name}).
            </p>

            <div className="mt-4">
              <label className="text-xs font-semibold text-slate-600">Standard Unit</label>
              <input
                type="text"
                value={newUnitInput}
                onChange={(e) => setNewUnitInput(e.target.value)}
                placeholder="e.g. PCS, BAGS, CFT, KG, ROLLS, SHEETS, METERS"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-500"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {['PCS', 'BAGS', 'CFT', 'KG', 'METERS', 'ROLLS', 'SHEETS', 'TINS'].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setNewUnitInput(preset)}
                    className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setConfirmUnitModal(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleConfirmUnit(confirmUnitModal.code, newUnitInput)}
                className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-sky-700"
              >
                Confirm Unit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
