import { applyOpeningBalance } from './openingBalance.ts';
import { INITIAL_MATERIAL_CATALOGUE, calculateCurrentStock } from '../types/inventory.ts';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error('FAILED: ' + msg);
}

const first = applyOpeningBalance([...INITIAL_MATERIAL_CATALOGUE], [])!;
assert(first !== null, 'import runs on a seeded catalogue');
assert(first.catalogue.length === INITIAL_MATERIAL_CATALOGUE.length + 2, 'Nut and Steel Brackets are added');
assert(first.tx!.lines.length === 40, '41 listed items minus Paint (no quantity) = 40 lines');
assert(calculateCurrentStock('MAT-0005', 'LOC-CENTRAL', [first.tx!]).currentStock === '860.16', 'cement opening 860.16');
assert(calculateCurrentStock('MAT-0004', 'LOC-CENTRAL', [first.tx!]).currentStock === '151280', 'brick opening 151280');
assert(first.catalogue.find((m) => m.code === 'MAT-0039')!.isUnitConfirmed, 'paint unit confirmed without stock');

const second = applyOpeningBalance(first.catalogue, [first.tx!])!;
assert(second.tx === null, 'second run adds nothing (no double counting)');
console.log('✓ Opening balance import verified (40 lines, idempotent).');
