import { maxHlc } from './hlc';
import { AuthError } from './googleAuth';
import { mergeRecords, sameRecords } from './merge';
import { FutureSchemaError, migrateEnvelope, migrateRecords } from './migrations';
import { buildEnvelope, CorruptRemoteError, DriveHttpError, pruneSnapshots, snapshotName, type DriveAdapter, type RemoteState } from './driveAdapter';
import { APP_VERSION, SCHEMA_VERSION, type Envelope, type RecordState, type Syncable } from '../types';

export interface SyncStore {
  getRecords(): Promise<RecordState>;
  replaceRecords(records: RecordState): Promise<void>;
  mergeIntoLocal(records: RecordState): Promise<RecordState>;
  getMeta<T>(key: string, fallback?: T): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  getDeviceId(): Promise<string>;
  observeRemote(records: RecordState): Promise<void>;
  saveRecovery(raw: string, name?: string, records?: RecordState): Promise<void>;
}
export interface SyncAuth { getAccessToken(forceRefresh?: boolean): Promise<string>; }
export type SyncResult = { status: 'synced' | 'no-change'; pushed: boolean; conflicts: number; pending: number; lastSyncAt: string };
class InvalidRemoteError extends Error { constructor(message: string) { super(message); this.name = 'InvalidRemoteError'; } }

function validateEnvelope(value: unknown): asserts value is Envelope {
  if (!value || typeof value !== 'object') throw new Error('Drive backup is not a JSON object.');
  const envelope = value as Partial<Envelope>;
  if (!Number.isInteger(envelope.schemaVersion) || !envelope.records || typeof envelope.records !== 'object') throw new Error('Drive backup is missing schemaVersion or records.');
  for (const [collection, records] of Object.entries(envelope.records)) {
    if (!Array.isArray(records)) throw new Error(`Drive backup collection "${collection}" is not a list.`);
    for (const record of records as Syncable[]) if (!record.id || !record.updatedAt || !record.deviceId) throw new Error(`Drive backup contains an invalid record in "${collection}".`);
  }
}

const RETRY_BASE_MS = [1000, 2000, 4000, 8000, 16000];
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function syncNow(store: SyncStore, drive: DriveAdapter, auth: SyncAuth, options: { maxAttempts?: number; jitter?: () => number; wait?: (ms: number) => Promise<void> } = {}): Promise<SyncResult> {
  const maxAttempts = options.maxAttempts ?? 6;
  const jitter = options.jitter ?? Math.random;
  const pause = options.wait ?? wait;
  let lastError: unknown;
  let refreshedAfter401 = false;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const token = await auth.getAccessToken(false);
      const remote: RemoteState | null = await drive.getState(token);
      let remoteRecords: RecordState = {};
      let revision = 0;
      if (remote) {
        try {
          validateEnvelope(remote.envelope);
          const migrated = migrateEnvelope(remote.envelope, SCHEMA_VERSION);
          remoteRecords = migrated.records; revision = Number(migrated.revision ?? 0);
        } catch (error) {
          if (error instanceof FutureSchemaError) throw error;
          await store.saveRecovery(remote.raw, `recovery-${new Date().toISOString()}.json`);
          throw new InvalidRemoteError(`Drive sync-state.json is corrupt or incomplete. A raw recovery copy was saved locally. Restore a recent snapshot in Settings. ${error instanceof Error ? error.message : ''}`);
        }
      }
      let local = await store.getRecords();
      const localSchema = Number(await store.getMeta('schemaVersion', SCHEMA_VERSION));
      if (localSchema < SCHEMA_VERSION) {
        local = migrateRecords(local, localSchema, SCHEMA_VERSION);
        local = await store.mergeIntoLocal(local); await store.setMeta('schemaVersion', SCHEMA_VERSION);
      }
      const remoteVersion = Number(remote?.envelope.schemaVersion ?? SCHEMA_VERSION);
      if (remoteVersion > SCHEMA_VERSION) throw new Error('This backup was created by a newer version. Please update.');
      const merged = mergeRecords(local, remoteRecords);
      // Re-read and union within IndexedDB before any Drive write; an edit made during the network read survives.
      const converged = await store.mergeIntoLocal(merged.records);
      const conflicts = mergeRecords(merged.records, converged).conflicts;
      await store.observeRemote(converged);
      const shouldPush = !remote || !sameRecords(remoteRecords, converged);
      if (!shouldPush) {
        const lastSyncAt = new Date().toISOString();
        await store.setMeta('lastSyncAt', lastSyncAt); await store.setMeta('lastRemoteEtag', remote?.file.etag); await store.setMeta('lastRemoteRevision', revision);
        await store.setMeta('lastPushedAt', maxHlc(Object.values(converged).flat().map((record) => record.updatedAt)));
        await store.setMeta('lastError', '');
        const freshLocal = await store.getRecords();
        const pushedThrough = String(await store.getMeta('lastPushedAt', '') ?? '');
        const pending = Object.values(freshLocal).flat().filter((record) => record.updatedAt > pushedThrough).length;
        await store.setMeta('pendingPush', pending > 0);
        try { await maybeSnapshot(store, drive, token, converged, options.wait); await store.setMeta('lastSnapshotError', ''); }
        catch (snapshotError) { await store.setMeta('lastSnapshotError', snapshotError instanceof Error ? snapshotError.message : String(snapshotError)); }
        return { status: 'no-change', pushed: false, conflicts: Math.max(merged.conflicts.length, conflicts.length), pending, lastSyncAt };
      }
      const deviceId = await store.getDeviceId();
      const envelope: Envelope = { ...buildEnvelope(converged, revision + 1, deviceId), appVersion: APP_VERSION, schemaVersion: SCHEMA_VERSION, lastMergedAt: maxHlc(Object.values(converged).flat().map((record) => record.updatedAt)) };
      const written = await drive.writeState(token, envelope, { fileId: remote?.file.id, etag: remote?.file.etag, expectedRevision: revision });
      const lastSyncAt = new Date().toISOString();
      await store.setMeta('lastRemoteEtag', written.etag); await store.setMeta('lastRemoteRevision', written.revision);
      await store.setMeta('lastSyncAt', lastSyncAt); await store.setMeta('lastError', '');
      await store.setMeta('lastPushedAt', maxHlc(Object.values(converged).flat().map((record) => record.updatedAt)));
      await store.setMeta('schemaVersion', SCHEMA_VERSION);
      const current = await store.getRecords();
      const pushedThrough = String(await store.getMeta('lastPushedAt', '') ?? '');
      const pending = Object.values(current).flat().filter((record) => record.updatedAt > pushedThrough).length;
      await store.setMeta('pendingPush', pending > 0);
      try { await maybeSnapshot(store, drive, token, converged, options.wait); await store.setMeta('lastSnapshotError', ''); }
      catch (snapshotError) { await store.setMeta('lastSnapshotError', snapshotError instanceof Error ? snapshotError.message : String(snapshotError)); }
      return { status: 'synced', pushed: true, conflicts: Math.max(merged.conflicts.length, conflicts.length), pending, lastSyncAt };
    } catch (error) {
      lastError = error;
      if (error instanceof CorruptRemoteError) {
        const message = `${error.message} Raw recovery copy saved in Settings.`;
        await store.saveRecovery(error.raw, `recovery-${new Date().toISOString()}.json`);
        await store.setMeta('lastError', message); await store.setMeta('pendingPush', true);
        throw new Error(message);
      }
      if (error instanceof AuthError || error instanceof InvalidRemoteError || error instanceof FutureSchemaError) break;
      if (error instanceof DriveHttpError && error.status === 401 && !refreshedAfter401) {
        refreshedAfter401 = true;
        try { await auth.getAccessToken(true); } catch (refreshError) { lastError = refreshError; break; }
        attempt--; continue;
      }
      if (error instanceof DriveHttpError && error.status === 412 && attempt < maxAttempts - 1) {
        await pause((RETRY_BASE_MS[attempt] ?? 16000) + Math.floor(jitter() * 250)); continue;
      }
      if (attempt < maxAttempts - 1 && (!(error instanceof DriveHttpError) || error.status >= 500 || (error.status === 403 && /rate|quota/i.test(error.responseText)))) {
        await store.setMeta('pendingPush', true);
        const base = RETRY_BASE_MS[Math.min(attempt, RETRY_BASE_MS.length - 1)] ?? 16000;
        await pause(base + Math.floor(jitter() * 250)); continue;
      }
      break;
    }
  }
  const message = lastError instanceof Error ? lastError.message : 'Sync failed. Your local changes are saved and will retry.';
  await store.setMeta('lastError', message); await store.setMeta('pendingPush', true);
  throw lastError instanceof Error ? lastError : new Error(message);
}

async function maybeSnapshot(store: SyncStore, drive: DriveAdapter, token: string, records: RecordState, waitFn?: (ms: number) => Promise<void>): Promise<void> {
  const previous = await store.getMeta<string>('lastSnapshotAt', '');
  const forceSnapshot = await store.getMeta<boolean>('forceSnapshot', false);
  if (previous && !forceSnapshot && Date.now() - Date.parse(previous) < 30 * 60 * 1000) return;
  const pause = waitFn ?? wait;
  const snapshots = await drive.listSnapshots(token);
  const name = snapshotName(new Date(), snapshots.map((file) => file.name));
  await drive.createSnapshot(token, name, records);
  await pruneSnapshots(drive, token, 10);
  await store.setMeta('lastSnapshotAt', new Date().toISOString());
  await store.setMeta('forceSnapshot', false);
  await pause(0);
}
