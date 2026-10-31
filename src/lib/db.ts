import { openDB, type IDBPDatabase } from 'idb';
import { maxHlc, nextHlc as tickHlc, observeHlc } from './hlc';
import { mergeRecords } from './merge';
import type { RecordState, Syncable } from '../types';

type MetaRow = { key: string; value: unknown };
type StoredRecord = Syncable & { collection: string };
type RecoveryRow = { id: string; name: string; createdAt: string; raw: string; records?: RecordState };
type SalaryDB = IDBPDatabase<{
  records: { key: [string, string]; value: StoredRecord; indexes: { collection: string } };
  meta: { key: string; value: MetaRow };
  recovery: { key: string; value: RecoveryRow };
}>;

let openPromise: Promise<SalaryDB> | undefined;
const DB_NAME = 'salary-reset-v1';

function newId(): string { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`; }

export function openSalaryDb(): Promise<SalaryDB> {
  openPromise ??= openDB(DB_NAME, 1, {
    upgrade(database) {
      const records = database.createObjectStore('records', { keyPath: ['collection', 'id'] });
      records.createIndex('collection', 'collection');
      database.createObjectStore('meta', { keyPath: 'key' });
      database.createObjectStore('recovery', { keyPath: 'id' });
    },
  });
  return openPromise;
}

export async function getMeta<T>(key: string, fallback?: T): Promise<T | undefined> {
  const database = await openSalaryDb();
  const row = await database.get('meta', key);
  return row ? row.value as T : fallback;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const database = await openSalaryDb();
  await database.put('meta', { key, value });
}

export async function ensureDeviceId(): Promise<string> {
  const database = await openSalaryDb();
  const tx = database.transaction('meta', 'readwrite');
  const existing = await tx.store.get('deviceId');
  const deviceId = existing?.value as string | undefined ?? newId();
  if (!existing) await tx.store.put({ key: 'deviceId', value: deviceId });
  await tx.done;
  return deviceId;
}

export async function nextHlc(): Promise<string> {
  const database = await openSalaryDb();
  const deviceId = await ensureDeviceId();
  const tx = database.transaction('meta', 'readwrite');
  const physical = Number((await tx.store.get('lastPhysicalMs'))?.value ?? 0);
  const counter = Number((await tx.store.get('lastCounter'))?.value ?? 0);
  const tick = tickHlc({ lastPhysicalMs: physical, lastCounter: counter }, Date.now(), deviceId);
  await tx.store.put({ key: 'lastPhysicalMs', value: tick.state.lastPhysicalMs });
  await tx.store.put({ key: 'lastCounter', value: tick.state.lastCounter });
  await tx.done;
  return tick.value;
}

export async function observeRemoteClocks(records: RecordState): Promise<void> {
  const database = await openSalaryDb();
  const tx = database.transaction('meta', 'readwrite');
  let physical = Number((await tx.store.get('lastPhysicalMs'))?.value ?? 0);
  let counter = Number((await tx.store.get('lastCounter'))?.value ?? 0);
  for (const collection of Object.values(records)) {
    for (const record of collection) {
      const state = observeHlc({ lastPhysicalMs: physical, lastCounter: counter }, record.updatedAt);
      physical = state.lastPhysicalMs; counter = state.lastCounter;
    }
  }
  await tx.store.put({ key: 'lastPhysicalMs', value: physical });
  await tx.store.put({ key: 'lastCounter', value: counter });
  await tx.done;
}

export async function getRecords(): Promise<RecordState> {
  const database = await openSalaryDb();
  const rows = await database.getAll('records');
  const state: RecordState = {};
  for (const row of rows) {
    const { collection, ...record } = row;
    (state[collection] ??= []).push(record);
  }
  for (const records of Object.values(state)) records.sort((a, b) => a.id.localeCompare(b.id));
  return state;
}

export async function getCollection<T extends Syncable = Syncable>(collection: string, includeDeleted = false): Promise<T[]> {
  const database = await openSalaryDb();
  const rows = await database.getAllFromIndex('records', 'collection', collection);
  return rows.filter((row) => includeDeleted || !row.deleted).map(({ collection: _collection, ...record }) => record as T);
}

export async function getRecord<T extends Syncable = Syncable>(collection: string, id: string): Promise<T | undefined> {
  const database = await openSalaryDb();
  const row = await database.get('records', [collection, id]);
  if (!row || row.deleted) return undefined;
  const { collection: _collection, ...record } = row;
  return record as T;
}

export async function putRawRecords(records: RecordState): Promise<void> {
  const database = await openSalaryDb();
  const tx = database.transaction('records', 'readwrite');
  for (const [collection, rows] of Object.entries(records)) {
    for (const record of rows) await tx.store.put({ ...record, collection });
  }
  await tx.done;
}

export async function replaceRecords(records: RecordState): Promise<void> {
  const database = await openSalaryDb();
  const tx = database.transaction('records', 'readwrite');
  await tx.store.clear();
  for (const [collection, rows] of Object.entries(records)) {
    for (const record of rows) await tx.store.put({ ...record, collection });
  }
  await tx.done;
}

/** Merge inside one IndexedDB write transaction so a tab cannot clear a newer edit mid-sync. */
export async function mergeIntoLocal(records: RecordState): Promise<RecordState> {
  const database = await openSalaryDb();
  const tx = database.transaction('records', 'readwrite');
  const rows = await tx.store.getAll();
  const current: RecordState = {};
  for (const row of rows) {
    const { collection, ...record } = row;
    (current[collection] ??= []).push(record);
  }
  const merged = mergeRecords(current, records).records;
  for (const [collection, list] of Object.entries(merged)) for (const record of list) await tx.store.put({ ...record, collection });
  await tx.done;
  return merged;
}

export async function saveRecord<T extends Record<string, unknown>>(
  collection: string, value: T, fixedId?: string,
): Promise<T & Syncable> {
  const database = await openSalaryDb();
  const deviceId = await ensureDeviceId();
  const stamp = await nextHlc();
  const record = { ...value, id: fixedId ?? String(value.id ?? newId()), updatedAt: stamp, deviceId, deleted: false } as T & Syncable;
  await database.put('records', { ...record, collection });
  await setMeta('pendingPush', true);
  return record;
}

export async function deleteRecord(collection: string, id: string): Promise<void> {
  const record = await getRecord(collection, id);
  if (!record) return;
  const deviceId = await ensureDeviceId();
  const stamp = await nextHlc();
  const database = await openSalaryDb();
  await database.put('records', { ...record, collection, id, deleted: true, deletedAt: stamp, updatedAt: stamp, deviceId });
  await setMeta('pendingPush', true);
}

export async function countPending(lastPushedAt?: string): Promise<number> {
  const rows = Object.values(await getRecords()).flat();
  return rows.filter((record) => !lastPushedAt || record.updatedAt > lastPushedAt).length;
}

export async function saveRecovery(raw: string, name = `recovery-${new Date().toISOString()}.json`, records?: RecordState): Promise<void> {
  const database = await openSalaryDb();
  await database.put('recovery', { id: newId(), name, createdAt: new Date().toISOString(), raw, records });
}

export async function getRecoveries(): Promise<RecoveryRow[]> { return (await openSalaryDb()).getAll('recovery'); }

export async function saveLocalSafetySnapshot(records: RecordState): Promise<void> {
  await saveRecovery(JSON.stringify(records), `local-safety-${new Date().toISOString()}.json`, records);
}

export async function clearLocalData(): Promise<void> {
  const database = await openSalaryDb();
  const tx = database.transaction(['records', 'meta'], 'readwrite');
  await Promise.all([tx.objectStore('records').clear(), tx.objectStore('meta').clear()]);
  await tx.done;
  openPromise = undefined;
}

export async function markPushed(records: RecordState, etag: string | undefined, revision: number): Promise<void> {
  const stamp = maxHlc(Object.values(records).flat().map((record) => record.updatedAt));
  const currentDevice = await ensureDeviceId();
  const previousClock: string = await getMeta('lastPushedAt', '') ?? '';
  await setMeta('lastPushedAt', stamp > previousClock ? stamp : previousClock);
  await setMeta('lastRemoteEtag', etag);
  await setMeta('lastRemoteRevision', revision);
  await setMeta('lastSyncAt', new Date().toISOString());
  await setMeta('pendingPush', (await countPending(stamp)) > 0);
  await setMeta('lastError', '');
  await setMeta('deviceId', currentDevice);
}

export const indexedDbSyncStore = {
  getRecords,
  replaceRecords,
  mergeIntoLocal,
  getMeta,
  setMeta,
  getDeviceId: ensureDeviceId,
  observeRemote: observeRemoteClocks,
  saveRecovery,
};
