import { calculateStockAsOf, } from './historicalBalance.ts';
import { InventoryTransaction } from '../types/inventory.ts';
const base = (id: string, type: InventoryTransaction['txType'], date: string, qty: string, src='LOC-CENTRAL', dst='LOC-CENTRAL'): InventoryTransaction => ({
  clientTxUuid:id, txType:type, txDateTime:date, sourceLocationId:src, destinationLocationId:dst, staffId:'tester', referenceNumber:id,
  lines:[{lineId:id+'-l',materialCode:'MAT-0005',materialName:'Cement',quantity:qty,unit:'BAGS'}], syncStatus:'SYNCED', createdAt:date, modifiedAt:date
});
const rows=[base('o','OPENING_STOCK','2026-10-18T00:00:00Z','100'),base('r','RECEIPT','2026-10-19T00:00:00Z','20'),base('d','DISPATCH','2026-10-20T00:00:00Z','15','LOC-CENTRAL','LOC-BLOCK-A')];
const before=calculateStockAsOf('MAT-0005','LOC-CENTRAL',rows,'2026-10-18');
const after=calculateStockAsOf('MAT-0005','LOC-CENTRAL',rows,'2026-10-20');
if(before.currentStock!=='100') throw new Error('Opening-date balance should be 100');
if(after.currentStock!=='105') throw new Error('End-date balance should be 105');
console.log('historicalBalance.test passed');

const returnRows: InventoryTransaction[] = [
  base('opening-return','OPENING_STOCK','2026-10-18T00:00:00Z','10'),
  { ...base('damaged-return','RETURN','2026-10-19T00:00:00Z','5','LOC-BLOCK-A','LOC-CENTRAL'), lines:[{lineId:'damaged-line',materialCode:'MAT-0005',materialName:'Cement',quantity:'5',damagedQuantity:'2',unit:'BAGS'}] }
];
const usable = calculateStockAsOf('MAT-0005','LOC-CENTRAL',returnRows,'2026-10-19');
if(usable.currentStock!=='13') throw new Error('Damaged returned quantity must not increase usable stock');
