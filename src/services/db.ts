/**
 * Camp Stock Inventory Management System
 * Local IndexedDB Persistence for Windows Application
 */

import {
  CAMP_LOCATIONS,
  INITIAL_MATERIAL_CATALOGUE,
  InventoryTransaction,
  MaterialCatalogueItem,
  PhysicalStockCount,
  Supplier,
  DEFAULT_SUPPLIERS,
} from '../types/inventory.ts';
import { ADDITIONAL_MATERIALS } from '../types/additionalMaterials.ts';

/** 45 starter items + the full item list. */
const FULL_CATALOGUE: ReadonlyArray<MaterialCatalogueItem> = [...INITIAL_MATERIAL_CATALOGUE, ...ADDITIONAL_MATERIALS];
const DELETED_CATALOGUE_CODES_KEY = 'deletedCatalogueCodes';

const DB_NAME = 'CampStockDb';
const DB_VERSION = 2;

export class LocalDb {
  private dbPromise: Promise<IDBDatabase>;

  constructor() {
    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (!db.objectStoreNames.contains('transactions')) {
          db.createObjectStore('transactions', { keyPath: 'clientTxUuid' });
        }
        if (!db.objectStoreNames.contains('catalogue')) {
          db.createObjectStore('catalogue', { keyPath: 'code' });
        }
        if (!db.objectStoreNames.contains('physical_counts')) {
          db.createObjectStore('physical_counts', { keyPath: 'countId' });
        }
        if (!db.objectStoreNames.contains('suppliers')) {
          db.createObjectStore('suppliers', { keyPath: 'supplierId' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllTransactions(): Promise<InventoryTransaction[]> {
    try {
      const db = await this.dbPromise;
      return new Promise((resolve) => {
        const tx = db.transaction('transactions', 'readonly');
        const store = tx.objectStore('transactions');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  }

  async saveTransaction(item: InventoryTransaction): Promise<void> {
    try {
      const db = await this.dbPromise;
      return new Promise((resolve, reject) => {
        const tx = db.transaction('transactions', 'readwrite');
        const store = tx.objectStore('transactions');
        store.put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Fallback in memory
    }
  }

  /** Deletes every transaction and physical count on this computer. Catalogue, suppliers and settings stay. */
  async clearAllRecords(): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['transactions', 'physical_counts'], 'readwrite');
      tx.objectStore('transactions').clear();
      tx.objectStore('physical_counts').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Removes a draft (a record that was never confirmed in Kobo). */
  async deleteTransaction(clientTxUuid: string): Promise<void> {
    try {
      const db = await this.dbPromise;
      return new Promise((resolve, reject) => {
        const tx = db.transaction('transactions', 'readwrite');
        tx.objectStore('transactions').delete(clientTxUuid);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Fallback in memory
    }
  }

  async getAllCatalogue(): Promise<MaterialCatalogueItem[]> {
    try {
      const db = await this.dbPromise;
      return new Promise((resolve) => {
        const tx = db.transaction(['catalogue', 'settings'], 'readonly');
        const catalogueRequest = tx.objectStore('catalogue').getAll();
        const deletedRequest = tx.objectStore('settings').get(DELETED_CATALOGUE_CODES_KEY);
        tx.oncomplete = () => {
          const deletedCodes = new Set<string>(deletedRequest.result?.codes || []);
          const list = (catalogueRequest.result as MaterialCatalogueItem[] || []).filter((item) => !deletedCodes.has(item.code));
          const have = new Set(list.map((m) => m.code));
          const missing = FULL_CATALOGUE.filter((m) => !have.has(m.code) && !deletedCodes.has(m.code));
          if (missing.length === 0) {
            resolve(list);
          } else {
            this.addCatalogueItems(missing).then(() => resolve([...list, ...missing]));
          }
        };
        tx.onerror = () => resolve([...FULL_CATALOGUE]);
      });
    } catch {
      return [...FULL_CATALOGUE];
    }
  }

  async addCatalogueItems(items: ReadonlyArray<MaterialCatalogueItem>): Promise<void> {
    try {
      const db = await this.dbPromise;
      return new Promise((resolve) => {
        const tx = db.transaction('catalogue', 'readwrite');
        const store = tx.objectStore('catalogue');
        for (const item of items) store.put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      // in-memory fallback
    }
  }

  async getAllSuppliers(): Promise<Supplier[]> {
    try {
      const db = await this.dbPromise;
      return new Promise((resolve) => {
        const tx = db.transaction('suppliers', 'readonly');
        const req = tx.objectStore('suppliers').getAll();
        req.onsuccess = () => {
          const list: Supplier[] = req.result || [];
          if (list.length > 0) return resolve(list);
          this.saveSuppliers(DEFAULT_SUPPLIERS).then(() => resolve([...DEFAULT_SUPPLIERS]));
        };
        req.onerror = () => resolve([...DEFAULT_SUPPLIERS]);
      });
    } catch {
      return [...DEFAULT_SUPPLIERS];
    }
  }

  async saveSuppliers(items: ReadonlyArray<Supplier>): Promise<void> {
    try {
      const db = await this.dbPromise;
      return new Promise((resolve) => {
        const tx = db.transaction('suppliers', 'readwrite');
        const store = tx.objectStore('suppliers');
        for (const item of items) store.put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      // in-memory fallback
    }
  }

  async seedCatalogue(): Promise<MaterialCatalogueItem[]> {
    try {
      const db = await this.dbPromise;
      const tx = db.transaction('catalogue', 'readwrite');
      const store = tx.objectStore('catalogue');
      for (const item of FULL_CATALOGUE) {
        store.put(item);
      }
      return [...FULL_CATALOGUE];
    } catch {
      return [...FULL_CATALOGUE];
    }
  }

  async getAllPhysicalCounts(): Promise<PhysicalStockCount[]> {
    try {
      const db = await this.dbPromise;
      return new Promise((resolve) => {
        const req = db.transaction('physical_counts', 'readonly').objectStore('physical_counts').getAll();
        req.onsuccess = () => resolve((req.result as PhysicalStockCount[]).sort((a, b) => b.countDate.localeCompare(a.countDate)));
        req.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  }

  async savePhysicalCount(item: PhysicalStockCount): Promise<void> {
    try {
      const db = await this.dbPromise;
      return new Promise((resolve) => {
        const tx = db.transaction('physical_counts', 'readwrite');
        tx.objectStore('physical_counts').put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      // ignored
    }
  }

  async updateCatalogueItem(item: MaterialCatalogueItem): Promise<void> {
    try {
      const db = await this.dbPromise;
      return new Promise((resolve) => {
        const tx = db.transaction('catalogue', 'readwrite');
        const store = tx.objectStore('catalogue');
        store.put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      // Ignored
    }
  }

  async deleteCatalogueItems(codes: ReadonlyArray<string>): Promise<void> {
    if (codes.length === 0) return;
    try {
      const db = await this.dbPromise;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(['catalogue', 'settings'], 'readwrite');
        const catalogueStore = tx.objectStore('catalogue');
        const settingsStore = tx.objectStore('settings');
        const deletedRequest = settingsStore.get(DELETED_CATALOGUE_CODES_KEY);
        deletedRequest.onsuccess = () => {
          const deletedCodes = new Set<string>(deletedRequest.result?.codes || []);
          for (const code of codes) {
            catalogueStore.delete(code);
            deletedCodes.add(code);
          }
          settingsStore.put({ key: DELETED_CATALOGUE_CODES_KEY, codes: [...deletedCodes] });
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (error) {
      throw error;
    }
  }
}

export const localDb = new LocalDb();
