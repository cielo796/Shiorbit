/**
 * IndexedDB の共通土台。
 *
 * Vault ハンドルの保存 (fsa.ts) とインデックスキャッシュ (idbKv.ts) が
 * 同じデータベースを使うため、ストア定義をここに集約する。
 * 別々に open するとバージョン競合でどちらかが壊れる。
 */
const DB_NAME = 'shiorbit';
const LEGACY_DB_NAME = 'obidisan';
const DB_VERSION = 2;

export const STORE_HANDLES = 'handles';
export const STORE_KV = 'kv';

let cached: Promise<IDBDatabase> | null = null;

function openNamedDb(name: string): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_HANDLES)) db.createObjectStore(STORE_HANDLES);
      if (!db.objectStoreNames.contains(STORE_KV)) db.createObjectStore(STORE_KV);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function countStore(db: IDBDatabase, store: string): Promise<number> {
  if (!db.objectStoreNames.contains(store)) return Promise.resolve(0);
  return new Promise<number>((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function readStore(db: IDBDatabase, store: string): Promise<Array<[IDBValidKey, unknown]>> {
  if (!db.objectStoreNames.contains(store)) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const entries: Array<[IDBValidKey, unknown]> = [];
    const req = db.transaction(store, 'readonly').objectStore(store).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(entries);
        return;
      }
      entries.push([cursor.key, cursor.value]);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

function writeStore(db: IDBDatabase, store: string, entries: Array<[IDBValidKey, unknown]>): Promise<void> {
  if (entries.length === 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const target = tx.objectStore(store);
    for (const [key, value] of entries) target.put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** 旧データベースの Vault ハンドルとキャッシュを、空の新DBへ一度だけコピーする。 */
async function migrateLegacyDb(target: IDBDatabase): Promise<void> {
  if (typeof indexedDB.databases !== 'function') return;
  const databases = await indexedDB.databases();
  if (!databases.some((info) => info.name === LEGACY_DB_NAME)) return;

  const legacy = await openNamedDb(LEGACY_DB_NAME);
  try {
    for (const store of [STORE_HANDLES, STORE_KV]) {
      if ((await countStore(target, store)) !== 0) continue;
      await writeStore(target, store, await readStore(legacy, store));
    }
  } finally {
    legacy.close();
  }
}

export function openDb(): Promise<IDBDatabase> {
  cached ??= openNamedDb(DB_NAME).then(async (db) => {
    try {
      await migrateLegacyDb(db);
    } catch (e) {
      console.warn('[IndexedDB] 旧 Obidisan データの移行に失敗しました', e);
    }
    return db;
  });
  return cached;
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  return run<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
}

export async function idbPut(store: string, key: string, value: unknown): Promise<void> {
  await run(store, 'readwrite', (s) => s.put(value, key));
}

export async function idbDelete(store: string, key: string): Promise<void> {
  await run(store, 'readwrite', (s) => s.delete(key));
}
