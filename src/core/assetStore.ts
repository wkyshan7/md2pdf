/**
 * 资源持久化：IndexedDB（容量远大于 localStorage，适合 data URL / Blob）。
 * 若环境不支持（隐私模式等），自动退回内存存储，当次会话仍可正常使用。
 */

import type { Asset } from "./assets";

const DB_NAME = "md-studio";
const DB_VERSION = 1;
const STORE = "assets";

const memory = new Map<string, Asset>();
let persistent = true;

export function assetsArePersistent(): boolean {
  return persistent;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB 不可用"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("打开 IndexedDB 失败"));
  });
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

/** 读取全部资源（按创建时间升序） */
export async function loadAssets(): Promise<Asset[]> {
  try {
    const list = await run<Asset[]>("readonly", (store) => store.getAll() as IDBRequest<Asset[]>);
    return (list ?? []).slice().sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    persistent = false;
    return [...memory.values()].sort((a, b) => a.createdAt - b.createdAt);
  }
}

export async function saveAsset(asset: Asset): Promise<void> {
  memory.set(asset.id, asset);
  try {
    await run("readwrite", (store) => store.put(asset));
  } catch {
    persistent = false;
  }
}

export async function deleteAsset(id: string): Promise<void> {
  memory.delete(id);
  try {
    await run("readwrite", (store) => store.delete(id));
  } catch {
    persistent = false;
  }
}

export async function clearAssets(): Promise<void> {
  memory.clear();
  try {
    await run("readwrite", (store) => store.clear());
  } catch {
    persistent = false;
  }
}
