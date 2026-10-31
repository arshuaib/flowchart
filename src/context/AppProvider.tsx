import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { googleAuth, type AuthSnapshot } from '../lib/googleAuth';
import { driveAdapter } from '../lib/driveAdapter';
import { syncNow as executeSync } from '../lib/syncEngine';
import { countPending, deleteRecord, ensureDeviceId, getMeta, getRecords, indexedDbSyncStore, saveRecord } from '../lib/db';
import { recordsOf, settingsOf } from '../lib/selectors';
import { INITIAL_BUDGET, INITIAL_SETTINGS, type RecordState, type Settings, type Syncable } from '../types';

export type SyncView = 'signed-out' | 'signing-in' | 'synced' | 'syncing' | 'offline' | 'error';
type AppContextValue = {
  records: RecordState; loading: boolean; auth: AuthSnapshot; syncStatus: SyncView; pendingCount: number;
  lastSyncAt?: string; lastError?: string; deviceId?: string; online: boolean;
  refresh: () => Promise<void>; upsert: (collection: string, value: Record<string, unknown>, fixedId?: string) => Promise<Syncable>;
  remove: (collection: string, id: string) => Promise<void>; connect: () => Promise<void>; disconnect: () => void;
  revoke: () => Promise<void>; syncNow: () => Promise<void>; settings: Settings;
};
const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState<RecordState>({});
  const [loading, setLoading] = useState(true);
  const [auth, setAuth] = useState<AuthSnapshot>(googleAuth.getSnapshot());
  const [syncStatus, setSyncStatus] = useState<SyncView>('signed-out');
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string>();
  const [lastError, setLastError] = useState<string>();
  const [deviceId, setDeviceId] = useState<string>();
  const [online, setOnline] = useState(navigator.onLine);
  const [localRevision, setLocalRevision] = useState(0);
  const syncing = useRef(false);
  const refreshTimer = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    const [state, id, pushedAt, syncAt, error] = await Promise.all([
      getRecords(), ensureDeviceId(), getMeta<string>('lastPushedAt', ''), getMeta<string>('lastSyncAt'), getMeta<string>('lastError'),
    ]);
    setRecords(state); setDeviceId(id); setPendingCount(await countPending(pushedAt));
    const snapshotError = await getMeta<string>('lastSnapshotError', '');
    setLastSyncAt(syncAt); setLastError(error || (snapshotError ? `Snapshot could not be saved: ${snapshotError}` : undefined));
    if (googleAuth.getSnapshot().status === 'signed-out') setSyncStatus(navigator.onLine ? 'signed-out' : 'offline');
  }, []);

  const syncNow = useCallback(async () => {
    if (!googleAuth.isSignedIn()) { setSyncStatus(navigator.onLine ? 'signed-out' : 'offline'); return; }
    if (!navigator.onLine || syncing.current) { setSyncStatus('offline'); return; }
    syncing.current = true; setSyncStatus('syncing'); setLastError(undefined);
    try {
      const result = await executeSync(indexedDbSyncStore, driveAdapter, googleAuth);
      setLastSyncAt(result.lastSyncAt); setLastError(undefined); setSyncStatus('synced');
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed. Local changes are saved and will retry.';
      setLastError(message); setSyncStatus(navigator.onLine ? 'error' : 'offline'); await refresh();
    } finally { syncing.current = false; }
  }, [refresh]);

  const upsert = useCallback(async (collection: string, value: Record<string, unknown>, fixedId?: string) => {
    const saved = await saveRecord(collection, value, fixedId);
    await refresh(); setLocalRevision((revision) => revision + 1); return saved;
  }, [refresh]);
  const remove = useCallback(async (collection: string, id: string) => { await deleteRecord(collection, id); await refresh(); setLocalRevision((revision) => revision + 1); }, [refresh]);
  const connect = useCallback(async () => { await googleAuth.signIn(); }, []);
  const disconnect = useCallback(() => { googleAuth.signOut(); setSyncStatus(navigator.onLine ? 'signed-out' : 'offline'); }, []);
  const revoke = useCallback(async () => { await googleAuth.revoke(); setSyncStatus(navigator.onLine ? 'signed-out' : 'offline'); }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const existing = await getRecords();
      if (!recordsOf(existing, 'budget').length) await saveRecord('budget', INITIAL_BUDGET as unknown as Record<string, unknown>, 'budget');
      if (!recordsOf(existing, 'settings').length) await saveRecord('settings', INITIAL_SETTINGS as unknown as Record<string, unknown>, 'settings');
      await refresh(); if (mounted) setLoading(false);
    })();
    const unsubscribe = googleAuth.onAuthChange((state) => {
      setAuth(state);
      if (state.status === 'signed-in') { void syncNow(); }
      else if (state.status === 'signed-out') setSyncStatus(navigator.onLine ? 'signed-out' : 'offline');
      else if (state.status === 'signing-in') setSyncStatus('signing-in');
      else if (state.status === 'error') { setSyncStatus('error'); setLastError(state.error); }
    });
    const onOnline = () => { setOnline(true); if (googleAuth.isSignedIn()) void syncNow(); else setSyncStatus('signed-out'); };
    const onOffline = () => { setOnline(false); setSyncStatus('offline'); };
    const onFocus = () => { if (googleAuth.isSignedIn()) void syncNow(); };
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline); window.addEventListener('focus', onFocus);
    const interval = window.setInterval(() => { if (googleAuth.isSignedIn()) void syncNow(); }, 60_000);
    return () => { mounted = false; unsubscribe(); window.clearInterval(interval); window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); window.removeEventListener('focus', onFocus); };
  }, [refresh, syncNow]);

  useEffect(() => {
    if (localRevision === 0 || !googleAuth.isSignedIn()) return;
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => void syncNow(), 3000);
    return () => { if (refreshTimer.current) window.clearTimeout(refreshTimer.current); };
  }, [localRevision, syncNow]);

  const value = useMemo<AppContextValue>(() => ({ records, loading, auth, syncStatus, pendingCount, lastSyncAt, lastError, deviceId, online, refresh, upsert, remove, connect, disconnect, revoke, syncNow, settings: settingsOf(records) }), [records, loading, auth, syncStatus, pendingCount, lastSyncAt, lastError, deviceId, online, refresh, upsert, remove, connect, disconnect, revoke, syncNow]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider.');
  return context;
}
