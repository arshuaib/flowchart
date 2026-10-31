import { ensureDeviceId, getRecords, nextHlc, observeRemoteClocks, saveLocalSafetySnapshot, setMeta, mergeIntoLocal } from './db';
import { mergeRecords } from './merge';
import { convertFlowTrackState } from './legacyMigration';
import { migrateEnvelope } from './migrations';
import { APP_VERSION, SCHEMA_VERSION, type Envelope, type RecordState, type Syncable } from '../types';

export function encodeBackup(records: RecordState, deviceId: string): Envelope {
  const stamps = Object.values(records).flat().map((record) => record.updatedAt).sort();
  return { schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION, lastMergedAt: stamps.at(-1) ?? new Date(0).toISOString(), generatedByDevice: deviceId, revision: 0, records };
}

export function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function parseBackup(raw: string): { records: RecordState; source: 'salary-reset' | 'legacy-flowtrack' } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('This file is not valid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('This JSON file does not contain a backup object.');
  const value = parsed as Record<string, unknown>;
  if ('schemaVersion' in value) {
    const envelope = value as unknown as Envelope;
    if (!Number.isInteger(envelope.schemaVersion) || !envelope.records || typeof envelope.records !== 'object') throw new Error('This Salary Reset backup is missing schemaVersion or records.');
    const migrated = migrateEnvelope(envelope, SCHEMA_VERSION);
    return { records: migrated.records, source: 'salary-reset' };
  }
  if (Array.isArray(value.transactions) || Array.isArray(value.wallets)) {
    return { records: convertFlowTrackState(value, new Date().toISOString(), 'legacy-import'), source: 'legacy-flowtrack' };
  }
  const candidate = value as RecordState;
  if (!Object.values(candidate).every(Array.isArray)) throw new Error('This JSON file does not contain record collections.');
  for (const [collection, rows] of Object.entries(candidate)) {
    for (const record of rows as Syncable[]) if (!record?.id) throw new Error(`A record in ${collection} is missing its id.`);
  }
  return { records: candidate, source: 'salary-reset' };
}

export async function restoreRecords(records: RecordState): Promise<{ added: number; replaced: number }> {
  const current = await getRecords();
  await saveLocalSafetySnapshot(current);
  const deviceId = await ensureDeviceId();
  await observeRemoteClocks(records);
  const fresh: RecordState = {};
  for (const [collection, rows] of Object.entries(records)) {
    fresh[collection] = [];
    for (const record of rows as Syncable[]) {
      const stamp = await nextHlc();
      fresh[collection]!.push({ ...record, updatedAt: stamp, deviceId, ...(record.deleted ? { deletedAt: stamp } : {}) });
    }
  }
  const merged = mergeRecords(current, fresh).records;
  const oldById = new Map(Object.entries(current).flatMap(([collection, rows]) => rows.map((record) => [`${collection}:${record.id}`, record])));
  let added = 0, replaced = 0;
  for (const [collection, rows] of Object.entries(fresh)) for (const record of rows) {
    if (oldById.has(`${collection}:${record.id}`)) replaced++; else added++;
  }
  await mergeIntoLocal(merged);
  await setMeta('pendingPush', true);
  await setMeta('forceSnapshot', true);
  return { added, replaced };
}

