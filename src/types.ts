export const SCHEMA_VERSION = 3;
export const APP_VERSION = '1.0.0';

export const CATEGORIES = ['rent', 'transport', 'food', 'utilities', 'data', 'debt', 'other'] as const;
export type ExpenseCategory = (typeof CATEGORIES)[number];
export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  rent: 'Rent', transport: 'Transport', food: 'Food', utilities: 'Utilities', data: 'Data & phone', debt: 'Debt payments', other: 'Other',
};
export type Goal = 'emergency-fund' | 'pay-debt' | 'start-saving' | 'increase-income';
export type Syncable = { id: string; updatedAt: string; deviceId: string; deleted?: boolean; deletedAt?: string; [key: string]: unknown };
export type RecordState = Record<string, Syncable[]>;

export type Profile = Syncable & {
  id: 'profile'; name: string; salary: number; paydayDay: number; currency: string;
  fixedExpenses: Record<ExpenseCategory, number>; variableEstimate: number; currentSavings: number; primaryGoal: Goal; onboarded: boolean;
};
export type Debt = Syncable & { name: string; balance: number; interestRate: number; minimumPayment: number };
export type Asset = Syncable & { name: string; value: number };
export type ExpenseEntry = Syncable & { amount: number; category: ExpenseCategory; kind: 'fixed' | 'variable'; date: string; note: string };
export type Budget = Syncable & { id: 'budget'; mode: '50-30-20' | 'custom'; needsPct: number; wantsPct: number; savingsPct: number; envelopes: Partial<Record<ExpenseCategory, number>> };
export type Settings = Syncable & { id: 'settings'; transferPct: number; debtStrategy: 'snowball' | 'avalanche'; currency: string };
export type Review = Syncable & { month: string; actualIncome: number; spending: Partial<Record<ExpenseCategory, number>>; savingsTransferred: number; debtPaid: number; whatLeaked: string; whatWorked: string; nextChange: string };
export type PlanTask = Syncable & { week: number; title: string; detail: string; status: 'not-started' | 'done' | 'skipped' };
export type LeakStatus = Syncable & { category: ExpenseCategory; status: 'fixed' | 'ignore' };
export type DebtPayment = Syncable & { debtId: string; amount: number; date: string };
export type SavingsCheck = Syncable & { key: string; label: string; done: boolean };
export type ConflictLogEntry = Syncable & {
  collection: string; recordId: string; losingUpdatedAt: string; winningUpdatedAt: string;
  losingDeviceId: string; winningDeviceId: string; detectedAt: string; summary: string; losingRecord: Record<string, unknown>;
};
export type Envelope = { schemaVersion: number; appVersion: string; lastMergedAt: string; generatedByDevice: string; revision: number; records: RecordState };
export type DriveFileMeta = { id: string; name: string; size?: number; modifiedTime?: string; etag?: string; revision?: number };
export type SyncMeta = {
  deviceId: string; lastRemoteEtag?: string; lastRemoteRevision?: number; lastPushedAt?: string;
  lastSyncAt?: string; pendingPush: boolean; lastError?: string; lastSnapshotAt?: string;
};

export const EMPTY_FIXED: Record<ExpenseCategory, number> = { rent: 0, transport: 0, food: 0, utilities: 0, data: 0, debt: 0, other: 0 };
export const INITIAL_PROFILE: Omit<Profile, keyof Syncable> = {
  id: 'profile', name: 'My reset', salary: 0, paydayDay: 1, currency: 'USD', fixedExpenses: { ...EMPTY_FIXED },
  variableEstimate: 0, currentSavings: 0, primaryGoal: 'emergency-fund', onboarded: false,
};
export const INITIAL_BUDGET: Omit<Budget, keyof Syncable> = { id: 'budget', mode: '50-30-20', needsPct: 50, wantsPct: 30, savingsPct: 20, envelopes: {} };
export const INITIAL_SETTINGS: Omit<Settings, keyof Syncable> = { id: 'settings', transferPct: 5, debtStrategy: 'avalanche', currency: 'USD' };

export function visible<T extends Syncable>(records: T[]): T[] { return records.filter((record) => !record.deleted); }
