import type { ConflictLogEntry, RecordState, Syncable } from '../types';

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function businessFields(record: Syncable): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !['id', 'updatedAt', 'deviceId', 'deleted', 'deletedAt'].includes(key)));
}

function winner(a: Syncable, b: Syncable): Syncable {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  if (a.deviceId !== b.deviceId) return a.deviceId > b.deviceId ? a : b;
  // A stable payload comparison makes malformed duplicate imports converge.
  return stable(a) >= stable(b) ? a : b;
}

function deterministicUuid(seed: string): string {
  // Stable UUID-shaped IDs prevent the same merge decision from creating duplicate entries.
  // The bits are formatted as v4/variant, but are not intended as security tokens.
  let h1 = 0x811c9dc5, h2 = 0x9e3779b9, h3 = 0x85ebca6b, h4 = 0xc2b2ae35;
  for (let i = 0; i < seed.length; i++) {
    const code = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193); h2 = Math.imul(h2 ^ code, 0x27d4eb2d);
    h3 = Math.imul(h3 ^ code, 0x165667b1); h4 = Math.imul(h4 ^ code, 0x9e3779b1);
  }
  const hex = [h1, h2, h3, h4].map((part) => (part >>> 0).toString(16).padStart(8, '0')).join('').split('');
  hex[12] = '4'; hex[16] = ((parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  const raw = hex.join('');
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

function conflictEntry(collection: string, losing: Syncable, winningRecord: Syncable): ConflictLogEntry {
  const seed = `${collection}|${losing.id}|${losing.updatedAt}|${winningRecord.updatedAt}|${losing.deviceId}|${winningRecord.deviceId}`;
  return {
    id: deterministicUuid(seed), collection, recordId: losing.id, losingUpdatedAt: losing.updatedAt,
    winningUpdatedAt: winningRecord.updatedAt, losingDeviceId: losing.deviceId, winningDeviceId: winningRecord.deviceId,
    detectedAt: winningRecord.updatedAt, summary: `A different edit to ${collection} was kept on another device.`,
    losingRecord: structuredClone(losing), updatedAt: winningRecord.updatedAt, deviceId: 'merge-log',
  };
}

export type MergeResult = { records: RecordState; conflicts: ConflictLogEntry[] };

/** Per-record LWW join. Conflict history is canonicalized so the full result is commutative, associative, and idempotent. */
export function mergeRecords(local: RecordState, remote: RecordState): MergeResult {
  const merged: RecordState = {};
  const versions = new Map<string, Syncable[]>();
  const collectVersion = (collection: string, record: Syncable) => {
    const key = `${collection}:${record.id}`;
    const rows = versions.get(key) ?? [];
    if (!rows.some((row) => row.updatedAt === record.updatedAt && row.deviceId === record.deviceId && stable(row) === stable(record))) rows.push(record);
    versions.set(key, rows);
  };

  const collections = new Set([...Object.keys(local), ...Object.keys(remote)].filter((collection) => collection !== 'conflictLog'));
  for (const collection of [...collections].sort()) {
    const left = new Map((local[collection] ?? []).map((record) => [record.id, record]));
    const right = new Map((remote[collection] ?? []).map((record) => [record.id, record]));
    const result = new Map<string, Syncable>();
    for (const id of new Set([...left.keys(), ...right.keys()])) {
      const a = left.get(id), b = right.get(id);
      if (!a) { result.set(id, b!); continue; }
      if (!b) { result.set(id, a); continue; }
      result.set(id, winner(a, b));
    }
    merged[collection] = [...result.values()].sort((a, b) => a.id.localeCompare(b.id));
    for (const record of [...left.values(), ...right.values()]) collectVersion(collection, record);
  }

  // Losing full records are version history. Rebuild a canonical log against each final winner,
  // so grouping the same offline edits into different merge orders yields the same log.
  for (const entry of [...(local.conflictLog ?? []), ...(remote.conflictLog ?? [])] as ConflictLogEntry[]) {
    collectVersion(entry.collection, { ...entry.losingRecord, id: entry.recordId, updatedAt: entry.losingUpdatedAt, deviceId: entry.losingDeviceId } as Syncable);
  }
  const conflicts: ConflictLogEntry[] = [];
  for (const [key, candidates] of versions) {
    const split = key.indexOf(':');
    const collection = key.slice(0, split), id = key.slice(split + 1);
    const finalWinner = merged[collection]?.find((record) => record.id === id);
    if (!finalWinner) continue;
    const uniqueEdits = new Map<string, Syncable>();
    for (const candidate of candidates) {
      const editKey = stable(businessFields(candidate));
      const previous = uniqueEdits.get(editKey);
      uniqueEdits.set(editKey, previous ? winner(previous, candidate) : candidate);
    }
    for (const candidate of uniqueEdits.values()) {
      if (candidate.updatedAt === finalWinner.updatedAt && candidate.deviceId === finalWinner.deviceId && stable(candidate) === stable(finalWinner)) continue;
      if (stable(businessFields(candidate)) !== stable(businessFields(finalWinner))) conflicts.push(conflictEntry(collection, candidate, finalWinner));
    }
  }
  const conflictLog = [...new Map(conflicts.map((entry) => [entry.id, entry])).values()].sort((a, b) => a.id.localeCompare(b.id));
  if (conflictLog.length) merged.conflictLog = conflictLog;
  return { records: merged, conflicts: conflictLog };
}

export function sameRecords(a: RecordState, b: RecordState): boolean { return stable(a) === stable(b); }
