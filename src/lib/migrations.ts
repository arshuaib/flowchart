import type { Envelope, RecordState, Syncable } from '../types';

export class FutureSchemaError extends Error {
  constructor() { super('This backup was created by a newer version. Please update.'); this.name = 'FutureSchemaError'; }
}

export type Migration = { from: number; to: number; run: (records: RecordState) => RecordState };
export const migrations: Migration[] = [
  { from: 1, to: 2, run: (records) => ({ ...records, settings: records.settings ?? [] }) },
  { from: 2, to: 3, run: (records) => ({ ...records, conflictLog: records.conflictLog ?? [], savingsChecklist: records.savingsChecklist ?? [] }) },
];

export function migrateRecords(records: RecordState, from: number, target: number): RecordState {
  if (from > target) throw new FutureSchemaError();
  let version = from, current = structuredClone(records);
  while (version < target) {
    const step = migrations.find((migration) => migration.from === version);
    if (!step) throw new Error(`No migration registered from schema ${version}.`);
    current = step.run(current); version = step.to;
  }
  return current;
}

export function migrateEnvelope(envelope: Envelope, target: number): Envelope {
  if (envelope.schemaVersion > target) throw new FutureSchemaError();
  return { ...envelope, records: migrateRecords(envelope.records, envelope.schemaVersion, target), schemaVersion: target };
}

export function normalizeLegacyRows<T extends Record<string, unknown>>(collection: string, rows: T[], nowHlc: string, deviceId: string): Syncable[] {
  return rows.map((row, index) => ({ ...row, id: String(row.id ?? `${collection}-${index + 1}`), updatedAt: nowHlc, deviceId, deleted: false }));
}
