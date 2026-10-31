import { beforeEach, describe, expect, it } from 'vitest';
import { CorruptRemoteError, DriveHttpError, type DriveAdapter, type RemoteState, type WriteCondition } from '../lib/driveAdapter';
import { AuthError } from '../lib/googleAuth';
import { mergeRecords } from '../lib/merge';
import { syncNow, type SyncStore } from '../lib/syncEngine';
import type { DriveFileMeta, Envelope, RecordState, Syncable } from '../types';

function clone<T>(value: T): T { return structuredClone(value); }
class MemoryStore implements SyncStore {
  records: RecordState = {};
  meta = new Map<string, unknown>();
  recovery: Array<{ raw: string; name?: string }> = [];
  constructor(public deviceId: string, records: RecordState = {}) { this.records = clone(records); }
  async getRecords() { return clone(this.records); }
  async replaceRecords(records: RecordState) { this.records = clone(records); }
  async mergeIntoLocal(records: RecordState) { this.records = mergeRecords(this.records, records).records; return clone(this.records); }
  async getMeta<T>(key: string, fallback?: T) { return (this.meta.has(key) ? this.meta.get(key) : fallback) as T | undefined; }
  async setMeta(key: string, value: unknown) { this.meta.set(key, value); }
  async getDeviceId() { return this.deviceId; }
  async observeRemote(_records: RecordState) { /* The fake clock is already deterministic. */ }
  async saveRecovery(raw: string, name?: string) { this.recovery.push({ raw, name }); }
  add(collection: string, record: Syncable) { this.records[collection] = [...(this.records[collection] ?? []).filter((item) => item.id !== record.id), clone(record)]; }
}

class FakeDrive implements DriveAdapter {
  envelope: Envelope | null = null;
  etag = 'etag-0';
  fileId = 'sync-file';
  snapshots: DriveFileMeta[] = [];
  snapshotData = new Map<string, string>();
  corruptRaw?: string;
  beforeNextWrite?: () => void;
  writeCount = 0;
  async getState(_token: string): Promise<RemoteState | null> {
    if (this.corruptRaw !== undefined) throw new CorruptRemoteError(this.corruptRaw);
    if (!this.envelope) return null;
    return { file: { id: this.fileId, name: 'sync-state.json', etag: this.etag, revision: this.envelope.revision }, envelope: clone(this.envelope), raw: JSON.stringify(this.envelope) };
  }
  async writeState(_token: string, envelope: Envelope, condition: WriteCondition) {
    this.writeCount++;
    if (this.beforeNextWrite) { const hook = this.beforeNextWrite; this.beforeNextWrite = undefined; hook(); }
    if (this.envelope) {
      if (!condition.fileId || condition.fileId !== this.fileId || condition.etag !== this.etag || condition.expectedRevision !== this.envelope.revision) throw new DriveHttpError(412, 'Stale ETag.');
    } else if (condition.fileId || condition.expectedRevision !== 0) throw new DriveHttpError(412, 'A remote file was created concurrently.');
    this.envelope = clone(envelope); this.etag = `etag-${envelope.revision}`;
    return { fileId: this.fileId, etag: this.etag, revision: envelope.revision };
  }
  async listSnapshots() { return clone(this.snapshots); }
  async downloadFile(_token: string, fileId: string) { return this.snapshotData.get(fileId) ?? ''; }
  async createSnapshot(_token: string, name: string, records: RecordState) {
    const file = { id: `snapshot-${this.snapshots.length + 1}`, name, size: JSON.stringify(records).length, modifiedTime: new Date().toISOString() };
    this.snapshots.unshift(file); this.snapshotData.set(file.id, JSON.stringify({ schemaVersion: 3, appVersion: '1.0.0', lastMergedAt: '', generatedByDevice: 'fake', revision: 0, records })); return file;
  }
  async deleteFile(_token: string, fileId: string) { this.snapshots = this.snapshots.filter((file) => file.id !== fileId); this.snapshotData.delete(fileId); }
  async deleteAllAppData() { this.envelope = null; this.snapshots = []; this.snapshotData.clear(); }
  injectRemote(collection: string, record: Syncable) {
    const records = this.envelope?.records ?? {};
    this.envelope = { schemaVersion: 3, appVersion: '1.0.0', lastMergedAt: record.updatedAt, generatedByDevice: 'other', revision: (this.envelope?.revision ?? 0) + 1, records: mergeRecords(records, { [collection]: [record] }).records };
    this.etag = `etag-race-${this.envelope.revision}`;
  }
}

const stamp = (millis: number, count: number, device = deviceOne) => `${String(millis).padStart(16, '0')}-${String(count).padStart(6, '0')}-${device}`;
const deviceOne = '11111111-1111-4111-8111-111111111111';
const deviceTwo = '22222222-2222-4222-8222-222222222222';
const item = (id: string, updatedAt: string, deviceId: string, data: Record<string, unknown> = {}): Syncable => ({ id, updatedAt, deviceId, ...data });
const immediate = { maxAttempts: 5, jitter: () => 0, wait: async (_ms: number) => {} };
const auth = { async getAccessToken() { return 'memory-token'; } };
async function sync(store: MemoryStore, drive: DriveAdapter) { return syncNow(store, drive, auth, immediate); }
function allIds(store: MemoryStore) { return Object.values(store.records).flat().filter((record) => !record.deleted && record.collection !== 'conflictLog').map((record) => record.id).sort(); }

describe('fake Drive sync scenarios', () => {
  beforeEach(() => { /* Each test constructs fresh stores and a fresh remote. */ });

  it('A: merges two devices that create separate records while offline and converges', async () => {
    const drive = new FakeDrive(), one = new MemoryStore(deviceOne), two = new MemoryStore(deviceTwo);
    one.add('debts', item('D1', stamp(10, 0), deviceOne)); one.add('reviews', item('R1', stamp(11, 0), deviceOne));
    two.add('debts', item('D2', stamp(12, 0), deviceTwo)); two.add('reviews', item('R2', stamp(13, 0), deviceTwo));
    await sync(one, drive); await sync(two, drive); await sync(one, drive);
    expect(allIds(one)).toEqual(['D1', 'D2', 'R1', 'R2']);
    expect(allIds(two)).toEqual(['D1', 'D2', 'R1', 'R2']);
  });

  it('B: picks the later same-record edit and preserves the losing version in Conflict Log', async () => {
    const drive = new FakeDrive(), one = new MemoryStore(deviceOne), two = new MemoryStore(deviceTwo);
    one.add('debts', item('loan', stamp(20, 0), deviceOne, { balance: 800 }));
    two.add('debts', item('loan', stamp(21, 0), deviceTwo, { balance: 650 }));
    await sync(one, drive); await sync(two, drive); await sync(one, drive);
    for (const store of [one, two]) {
      expect(store.records.debts?.find((record) => record.id === 'loan')?.balance).toBe(650);
      expect(store.records.conflictLog).toHaveLength(1);
      expect((store.records.conflictLog?.[0]?.losingRecord as Record<string, unknown>).balance).toBe(800);
    }
  });

  it('C: re-reads after a concurrent push returns 412 and converges without overwriting the racing edit', async () => {
    const drive = new FakeDrive(), one = new MemoryStore(deviceOne), two = new MemoryStore(deviceTwo);
    one.add('expenses', item('A', stamp(30, 0), deviceOne)); await sync(one, drive);
    two.add('expenses', item('B', stamp(31, 0), deviceTwo));
    drive.beforeNextWrite = () => drive.injectRemote('expenses', item('RACE', stamp(32, 0), deviceOne));
    await sync(two, drive); await sync(one, drive);
    expect(allIds(one)).toEqual(['A', 'B', 'RACE']); expect(allIds(two)).toEqual(['A', 'B', 'RACE']);
    expect(drive.writeCount).toBeGreaterThanOrEqual(3);
  });

  it('D: an offline deletion later than an offline edit remains a tombstone', async () => {
    const base = item('debt', stamp(40, 0), deviceOne, { balance: 100 });
    const drive = new FakeDrive(), one = new MemoryStore(deviceOne, { debts: [base] }), two = new MemoryStore(deviceTwo, { debts: [clone(base)] });
    one.add('debts', item('debt', stamp(42, 0), deviceOne, { balance: 100, deleted: true, deletedAt: stamp(42, 0) }));
    two.add('debts', item('debt', stamp(41, 0), deviceTwo, { balance: 10 }));
    await sync(one, drive); await sync(two, drive); await sync(one, drive);
    expect(one.records.debts?.find((record) => record.id === 'debt')?.deleted).toBe(true);
    expect(two.records.debts?.find((record) => record.id === 'debt')?.deleted).toBe(true);
  });

  it('E: a long-offline device sends all queued records in one successful sign-in sync', async () => {
    const store = new MemoryStore(deviceOne), drive = new FakeDrive();
    for (let index = 0; index < 40; index++) store.add('expenseEntries', item(`e-${index}`, stamp(100 + index, 0), deviceOne));
    const result = await sync(store, drive);
    expect(result.pushed).toBe(true); expect(result.pending).toBe(0); expect(allIds(store)).toHaveLength(40);
    expect(drive.envelope?.records.expenseEntries).toHaveLength(40);
  });

  it('F: saves corrupt remote bytes locally and leaves local records intact', async () => {
    const store = new MemoryStore(deviceOne, { debts: [item('safe', stamp(200, 0), deviceOne, { balance: 12 })] });
    const drive = new FakeDrive(); drive.corruptRaw = '{"schemaVersion":broken';
    await expect(sync(store, drive)).rejects.toThrow('Raw recovery copy saved in Settings');
    expect(store.records.debts?.[0]?.balance).toBe(12); expect(store.recovery[0]?.raw).toContain('broken');
  });

  it('G: unauthorized OAuth origin shows the exact setup action and does not retry-loop', async () => {
    const store = new MemoryStore(deviceOne, { debts: [item('queued', stamp(300, 0), deviceOne)] }), drive = new FakeDrive();
    let calls = 0;
    const badAuth = { async getAccessToken() { calls++; throw new AuthError('Google rejected this app origin. Add this origin to the existing OAuth client in Google Cloud Console: http://localhost:5173'); } };
    await expect(syncNow(store, drive, badAuth, immediate)).rejects.toThrow('http://localhost:5173');
    expect(calls).toBe(1); expect(drive.writeCount).toBe(0); expect(store.meta.get('pendingPush')).toBe(true);
  });
});
