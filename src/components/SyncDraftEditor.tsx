import React, { useState } from 'react';
import {
    CAMP_LOCATIONS,
    CampLocation,
    DecimalSafe,
    InventoryTransaction,
    MaterialCatalogueItem,
    Supplier,
} from '../types/inventory.ts';
import { dateToIso, isValidQty, newId } from '../utils/form.ts';

interface Props {
    transaction: InventoryTransaction;
    catalogue: MaterialCatalogueItem[];
    suppliers: Supplier[];
    onSave: (transaction: InventoryTransaction) => void;
    onClose: () => void;
}

const locations = CAMP_LOCATIONS as readonly CampLocation[];

export function SyncDraftEditor({ transaction, catalogue, suppliers, onSave, onClose }: Props) {
    const [staff, setStaff] = useState(transaction.staffId);
    const [date, setDate] = useState(transaction.txDateTime.slice(0, 10));
    const [reference, setReference] = useState(transaction.referenceNumber);
    const [notes, setNotes] = useState(transaction.notes || '');
    const [supplierId, setSupplierId] = useState(transaction.supplierId || '');
    const [poNumber, setPoNumber] = useState(transaction.poNumber || '');
    const [vehicleNumber, setVehicleNumber] = useState(transaction.vehicleNumber || '');
    const [receivedBy, setReceivedBy] = useState(transaction.receivedBy || '');
    const [destinationLocationId, setDestinationLocationId] = useState(transaction.destinationLocationId);
    const [acknowledgementBy, setAcknowledgementBy] = useState(transaction.acknowledgementBy || '');
    const [block, setBlock] = useState(transaction.block || '');
    const [drrCode, setDrrCode] = useState(transaction.drrCode || '');
    const [subBlock, setSubBlock] = useState(transaction.subBlock || '');
    const [mrfNumber, setMrfNumber] = useState(transaction.mrfNumber || '');
    const [lines, setLines] = useState(() => transaction.lines.map((line) => ({ ...line })));
    const [addCode, setAddCode] = useState('');
    const [error, setError] = useState('');

    const isReceipt = transaction.txType === 'RECEIPT';
    const isDispatch = transaction.txType === 'DISPATCH';
    const isReturn = transaction.txType === 'RETURN';
    const supplier = suppliers.find((item) => item.supplierId === supplierId);
    const availableMaterials = catalogue.filter((material) => !lines.some((line) => line.materialCode === material.code));

    const addLine = () => {
        const material = catalogue.find((item) => item.code === addCode);
        if (!material) return;
        setLines((current) => [...current, {
            lineId: newId(),
            materialCode: material.code,
            materialName: material.name,
            quantity: '',
            unit: material.unit,
            ...(isReturn ? { damagedQuantity: '0' } : {}),
        }]);
        setAddCode('');
    };

    const save = () => {
        if (!staff.trim()) return setError('Enter the staff name.');
        const txDateTime = dateToIso(date);
        if (!txDateTime) return setError('Enter a valid date that is not in the future.');
        if (!reference.trim()) return setError('Enter a reference number.');
        if (isReceipt && !supplier) return setError('Choose a supplier.');
        if (isDispatch && !locations.some((location) => location.id === destinationLocationId && location.id !== transaction.sourceLocationId)) {
            return setError('Choose a valid dispatch destination.');
        }
        if (isReturn && !locations.some((location) => location.code === block && location.type === 'BLOCK')) {
            return setError('Choose a valid return block.');
        }
        if (lines.length === 0) return setError('Keep at least one material line.');
        const invalidLine = lines.find((line) => !isValidQty(line.quantity));
        if (invalidLine) return setError(`Enter a valid positive quantity for ${invalidLine.materialName}.`);
        if (isReturn) {
            const invalidDamage = lines.find((line) => {
                const damaged = line.damagedQuantity || '0';
                return !/^(?:\d{1,9})(?:\.\d{1,4})?$/.test(damaged) || DecimalSafe.compare(damaged, '0') < 0 || DecimalSafe.compare(damaged, line.quantity) > 0;
            });
            if (invalidDamage) return setError(`Damaged quantity for ${invalidDamage.materialName} must not exceed the returned quantity.`);
        }

        const selectedBlock = locations.find((location) => location.code === block && location.type === 'BLOCK');
        const now = new Date().toISOString();
        onSave({
            ...transaction,
            txDateTime,
            staffId: staff.trim(),
            referenceNumber: reference.trim(),
            notes: notes.trim() || undefined,
            lines: lines.map((line) => ({
                ...line,
                quantity: DecimalSafe.fromScaledInt(DecimalSafe.toScaledInt(line.quantity)),
                ...(isReturn ? { damagedQuantity: DecimalSafe.fromScaledInt(DecimalSafe.toScaledInt(line.damagedQuantity || '0')) } : {}),
            })),
            ...(isReceipt ? {
                supplierId: supplier!.supplierId,
                supplierName: supplier!.name,
                poNumber: poNumber.trim() || undefined,
                vehicleNumber: vehicleNumber.trim() || undefined,
                receivedBy: receivedBy.trim() || undefined,
            } : {}),
            ...(isDispatch ? {
                destinationLocationId,
                issuedBy: staff.trim(),
                acknowledgementBy: acknowledgementBy.trim() || undefined,
                block: locations.find((location) => location.id === destinationLocationId)?.code,
                drrCode: drrCode.trim().toUpperCase() || undefined,
                subBlock: subBlock.trim() || undefined,
                mrfNumber: mrfNumber.trim().toUpperCase() || undefined,
            } : {}),
            ...(isReturn ? {
                sourceLocationId: selectedBlock!.id,
                block: selectedBlock!.code,
                drrCode: drrCode.trim().toUpperCase() || undefined,
                subBlock: subBlock.trim() || undefined,
                mrfNumber: mrfNumber.trim().toUpperCase() || undefined,
            } : {}),
            syncStatus: transaction.syncStatus === 'FAILED' ? 'PENDING' : transaction.syncStatus,
            syncErrorMessage: undefined,
            modifiedAt: now,
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
                <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-base font-bold text-slate-900">Edit {transaction.txType.toLowerCase()} draft</h3>
                    <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Close</button>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="text-xs font-semibold text-slate-600">Date
                        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" />
                    </label>
                    <label className="text-xs font-semibold text-slate-600">Staff name
                        <input value={staff} onChange={(event) => setStaff(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" />
                    </label>
                    <label className="text-xs font-semibold text-slate-600">Reference number
                        <input value={reference} onChange={(event) => setReference(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" />
                    </label>
                    {isReceipt && <>
                        <label className="text-xs font-semibold text-slate-600">Supplier
                            <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal">
                                <option value="">Choose supplier</option>
                                {suppliers.map((item) => <option key={item.supplierId} value={item.supplierId}>{item.name}</option>)}
                            </select>
                        </label>
                        <label className="text-xs font-semibold text-slate-600">PO number
                            <input value={poNumber} onChange={(event) => setPoNumber(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" />
                        </label>
                        <label className="text-xs font-semibold text-slate-600">Vehicle number
                            <input value={vehicleNumber} onChange={(event) => setVehicleNumber(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" />
                        </label>
                        <label className="text-xs font-semibold text-slate-600">Received by
                            <input value={receivedBy} onChange={(event) => setReceivedBy(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" />
                        </label>
                    </>}
                    {isDispatch && <>
                        <label className="text-xs font-semibold text-slate-600">Destination
                            <select value={destinationLocationId} onChange={(event) => setDestinationLocationId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal">
                                {locations.filter((location) => location.id !== transaction.sourceLocationId).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                            </select>
                        </label>
                        <label className="text-xs font-semibold text-slate-600">Acknowledged by
                            <input value={acknowledgementBy} onChange={(event) => setAcknowledgementBy(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" />
                        </label>
                    </>}
                    {(isDispatch || isReturn) && <>
                        {isReturn && <label className="text-xs font-semibold text-slate-600">Returned from block
                            <select value={block} onChange={(event) => setBlock(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal">
                                <option value="">Choose block</option>
                                {locations.filter((location) => location.type === 'BLOCK').map((location) => <option key={location.id} value={location.code}>{location.name}</option>)}
                            </select>
                        </label>}
                        <label className="text-xs font-semibold text-slate-600">DRR code
                            <input value={drrCode} onChange={(event) => setDrrCode(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" />
                        </label>
                        <label className="text-xs font-semibold text-slate-600">Sub-block
                            <input value={subBlock} onChange={(event) => setSubBlock(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" />
                        </label>
                        <label className="text-xs font-semibold text-slate-600">MRF number
                            <input value={mrfNumber} onChange={(event) => setMrfNumber(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" />
                        </label>
                    </>}
                    <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Notes
                        <input value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" />
                    </label>
                </div>

                <div className="mt-5 space-y-2">
                    <h4 className="text-sm font-bold text-slate-800">Materials</h4>
                    {lines.map((line) => (
                        <div key={line.lineId} className="grid grid-cols-[minmax(0,1fr)_110px_auto] items-center gap-2">
                            <span className="truncate text-xs font-medium text-slate-700">{line.materialName} ({line.unit})</span>
                            <input aria-label={`${line.materialName} quantity`} type="number" min="0" step="0.0001" value={line.quantity} onChange={(event) => setLines((current) => current.map((item) => item.lineId === line.lineId ? { ...item, quantity: event.target.value } : item))} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
                            {isReturn && <input aria-label={`${line.materialName} damaged quantity`} type="number" min="0" step="0.0001" value={line.damagedQuantity || '0'} onChange={(event) => setLines((current) => current.map((item) => item.lineId === line.lineId ? { ...item, damagedQuantity: event.target.value } : item))} className="w-full rounded-lg border border-amber-200 px-2 py-1.5 text-sm" />}
                            <button onClick={() => setLines((current) => current.filter((item) => item.lineId !== line.lineId))} className="rounded px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">Remove</button>
                        </div>
                    ))}
                    <div className="flex gap-2">
                        <select value={addCode} onChange={(event) => setAddCode(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                            <option value="">Add material</option>
                            {availableMaterials.map((material) => <option key={material.code} value={material.code}>{material.name}</option>)}
                        </select>
                        <button onClick={addLine} disabled={!addCode} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Add</button>
                    </div>
                </div>

                {error && <p className="mt-3 text-xs font-semibold text-red-600">{error}</p>}
                <div className="mt-5 flex justify-end gap-2">
                    <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
                    <button onClick={save} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-700">Save draft</button>
                </div>
            </div>
        </div>
    );
}