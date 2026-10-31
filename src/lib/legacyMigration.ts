import { mergeRecords } from './merge';
import type { RecordState, Syncable } from '../types';
import type { SyncStore } from './syncEngine';
import { nextHlc, saveRecovery } from './db';

const LEGACY_KEYS = ['flowtrack_pro_v1', 'flowtrack_google_user'];
const categoryFromName = (value: unknown): 'rent' | 'transport' | 'food' | 'utilities' | 'data' | 'debt' | 'other' => {
  const name = String(value ?? '').toLowerCase();
  if (name.includes('rent') || name.includes('housing')) return 'rent';
  if (name.includes('transport') || name.includes('fuel') || name.includes('travel')) return 'transport';
  if (name.includes('food') || name.includes('grocer') || name.includes('restaurant')) return 'food';
  if (name.includes('utility') || name.includes('bill') || name.includes('electric') || name.includes('water')) return 'utilities';
  if (name.includes('data') || name.includes('phone') || name.includes('internet')) return 'data';
  if (name.includes('debt') || name.includes('loan')) return 'debt';
  return 'other';
};

export function legacyKeysPresent(storage: Storage = localStorage): string[] { return LEGACY_KEYS.filter((key) => storage.getItem(key) !== null); }

export function convertFlowTrackState(raw: Record<string, unknown>, stamp: string, deviceId: string): RecordState {
  const existing = (raw.transactions as Array<Record<string, unknown>> | undefined) ?? [];
  const entries: Syncable[] = existing.flatMap((transaction, index) => {
    const type = String(transaction.type ?? '').toLowerCase();
    const amount = Math.abs(Number(transaction.amount ?? transaction.value ?? 0));
    if (!amount || !(type.includes('expense') || type === 'out' || type === 'spend')) return [];
    const date = String(transaction.date ?? transaction.createdAt ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
    return [{ id: String(transaction.id ?? `legacy-expense-${index + 1}`), amount, category: categoryFromName(transaction.categoryName ?? transaction.category ?? transaction.name), kind: 'variable', date, note: String(transaction.note ?? transaction.description ?? 'Imported from FlowTrack'), updatedAt: stamp, deviceId, deleted: false }];
  });
  const wallets = (raw.wallets as Array<Record<string, unknown>> | undefined) ?? [];
  const savings = wallets.filter((wallet) => wallet.savings).reduce((sum, wallet) => sum + Number(wallet.balance ?? 0), 0);
  const oldProfile = (raw.profile as Record<string, unknown> | undefined) ?? {};
  const currency = String(oldProfile.currency ?? 'USD');
  const profile: Syncable = { id: 'profile', name: 'Imported reset', salary: 0, paydayDay: 1, currency: /^[A-Z]{3}$/.test(currency) ? currency : 'USD', fixedExpenses: { rent: 0, transport: 0, food: 0, utilities: 0, data: 0, debt: 0, other: 0 }, variableEstimate: 0, currentSavings: savings, primaryGoal: 'emergency-fund', onboarded: false, updatedAt: stamp, deviceId, deleted: false };
  const assets: Syncable[] = wallets.filter((wallet) => !wallet.savings && Number(wallet.balance) > 0).map((wallet, index) => ({ id: String(wallet.id ?? `legacy-wallet-${index + 1}`), name: String(wallet.name ?? 'Imported wallet'), value: Number(wallet.balance ?? 0), updatedAt: stamp, deviceId, deleted: false }));
  return { profile: [profile], expenseEntries: entries, assets };
}

export async function migrateFlowTrackOptIn(store: SyncStore, storage: Storage = localStorage): Promise<number> {
  const alreadyDone = await store.getMeta<boolean>('migration-completed', false);
  if (alreadyDone) return 0;
  const source = storage.getItem('flowtrack_pro_v1');
  if (!source) return 0;
  let oldState: Record<string, unknown>;
  try { oldState = JSON.parse(source) as Record<string, unknown>; }
  catch { throw new Error('The legacy FlowTrack data could not be read. It remains in your browser storage.'); }
  const deviceId = await store.getDeviceId();
  const converted = convertFlowTrackState(oldState, await nextHlc(), deviceId);
  const merged = mergeRecords(await store.getRecords(), converted);
  await saveRecovery(source, 'legacy-flowtrack-safety-copy.json', converted);
  await store.mergeIntoLocal(merged.records);
  await store.setMeta('pendingPush', true);
  await store.setMeta('migration-completed', true);
  // Delete source keys only after the IndexedDB write and completion marker have committed.
  LEGACY_KEYS.forEach((key) => storage.removeItem(key));
  return Object.values(converted).flat().length;
}
