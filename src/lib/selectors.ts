import { EMPTY_FIXED, type Asset, type Budget, type Debt, type DebtPayment, type ExpenseCategory, type ExpenseEntry, type Profile, type RecordState, type Review, type Settings, type Syncable, visible } from '../types';

export function recordsOf<T extends Syncable>(state: RecordState, collection: string): T[] { return visible((state[collection] ?? []) as T[]); }
export function profileOf(state: RecordState): Profile {
  const profile = recordsOf<Profile>(state, 'profile')[0];
  return profile ?? ({ id: 'profile', ...EMPTY_FIXED, fixedExpenses: { ...EMPTY_FIXED }, name: 'Your reset', salary: 0, paydayDay: 1, currency: 'USD', variableEstimate: 0, currentSavings: 0, primaryGoal: 'emergency-fund', onboarded: false } as unknown as Profile);
}
export function budgetOf(state: RecordState): Budget { return recordsOf<Budget>(state, 'budget')[0] ?? ({ id: 'budget', mode: '50-30-20', needsPct: 50, wantsPct: 30, savingsPct: 20, envelopes: {} } as Budget); }
export function settingsOf(state: RecordState): Settings { return recordsOf<Settings>(state, 'settings')[0] ?? ({ id: 'settings', transferPct: 5, debtStrategy: 'avalanche', currency: profileOf(state).currency } as Settings); }

export function money(value: number, currency: string): string {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number.isFinite(value) ? value : 0); }
  catch { return `${currency} ${Math.round(value || 0).toLocaleString()}`; }
}
export function totalFixed(profile: Profile): number { return Object.values(profile.fixedExpenses ?? EMPTY_FIXED).reduce((sum, value) => sum + Number(value || 0), 0); }
export function activeDebts(state: RecordState): Debt[] { return recordsOf<Debt>(state, 'debts'); }
export function activeAssets(state: RecordState): Asset[] { return recordsOf<Asset>(state, 'assets'); }
export function totalDebt(state: RecordState): number { return activeDebts(state).reduce((sum, debt) => sum + Math.max(0, debt.balance), 0); }
export function totalAssets(state: RecordState, profile = profileOf(state)): number { return profile.currentSavings + activeAssets(state).reduce((sum, asset) => sum + Math.max(0, asset.value), 0); }
export function monthlyExpenses(profile: Profile): number { return totalFixed(profile) + Math.max(0, profile.variableEstimate); }
export function savingsRate(profile: Profile, settings: { transferPct?: number } = { transferPct: 5 }): number {
  if (profile.salary <= 0) return 0;
  const planned = profile.salary * (settings.transferPct ?? 5) / 100;
  return Math.max(0, Math.min(100, (planned / profile.salary) * 100));
}
export function monthKey(date = new Date()): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
export function entriesForMonth(entries: ExpenseEntry[], month: string): ExpenseEntry[] { return entries.filter((entry) => entry.date.slice(0, 7) === month); }
export function categorySpend(entries: ExpenseEntry[]): Record<ExpenseCategory, number> {
  const result = { ...EMPTY_FIXED };
  for (const entry of entries) result[entry.category] += Number(entry.amount || 0);
  return result;
}

export function budgetActual(state: RecordState, month = monthKey()): { actual: Record<ExpenseCategory, number>; planned: Record<ExpenseCategory, number>; actualTotal: number; plannedTotal: number } {
  const profile = profileOf(state), budget = budgetOf(state);
  const entries = entriesForMonth(recordsOf<ExpenseEntry>(state, 'expenseEntries'), month);
  const actual = entries.length ? categorySpend(entries) : { ...profile.fixedExpenses, other: profile.fixedExpenses.other + profile.variableEstimate };
  const planned = { ...profile.fixedExpenses };
  for (const category of ['transport', 'food', 'data', 'other'] as const) planned[category] += Number(budget.envelopes[category] ?? 0);
  if (!Object.values(budget.envelopes).some((value) => Number(value) > 0)) planned.other += profile.variableEstimate;
  return { actual, planned, actualTotal: Object.values(actual).reduce((sum, amount) => sum + amount, 0), plannedTotal: Object.values(planned).reduce((sum, amount) => sum + amount, 0) };
}

export type Leak = { category: ExpenseCategory; total: number; monthlyAverage: number; suggestion: string; monthlySavings: number; status?: 'fixed' | 'ignore' };
export function findLeaks(entries: ExpenseEntry[], ignored: Array<{ category: ExpenseCategory; status: 'fixed' | 'ignore' }> = []): Leak[] {
  const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 3);
  const recent = entries.filter((entry) => new Date(`${entry.date}T00:00:00`) >= cutoff);
  const totals = categorySpend(recent);
  const message: Record<ExpenseCategory, string> = {
    rent: 'Ask about a renewal discount or compare one lower-cost option.', transport: 'Batch errands or replace one trip each week with a lower-cost route.',
    food: 'Plan two simple meals before payday and trim convenience orders by half.', utilities: 'Check one recurring bill for a cheaper plan or unused add-on.',
    data: 'Compare bundles and switch off auto-renew for a package you do not finish.', debt: 'Ask your lender whether a lower-rate repayment option is available.', other: 'Pause one optional purchase category for a week and review how it feels.',
  };
  return (Object.entries(totals) as Array<[ExpenseCategory, number]>).map(([category, total]) => ({ category, total, monthlyAverage: total / 3, suggestion: message[category], monthlySavings: Math.round(total / 3 * (category === 'rent' || category === 'debt' ? .1 : .5)), status: ignored.find((entry) => entry.category === category)?.status }))
    .filter((leak) => leak.total > 0 && !leak.status).sort((a, b) => b.monthlyAverage - a.monthlyAverage).slice(0, 3);
}

export type PayoffResult = { order: Debt[]; months: number; interest: number; schedule: Array<{ month: number; balance: number }> };
export function calculatePayoff(debts: Debt[], monthlyPayment: number, strategy: 'snowball' | 'avalanche'): PayoffResult {
  const state = debts.map((debt) => ({ ...debt, remaining: Math.max(0, debt.balance), rate: Math.max(0, debt.interestRate) / 1200 }));
  const order = [...state].sort((a, b) => strategy === 'snowball' ? a.remaining - b.remaining : b.rate - a.rate).map(({ remaining: _remaining, rate: _rate, ...debt }) => debt);
  if (!state.length || monthlyPayment <= 0) return { order, months: 0, interest: 0, schedule: [] };
  const minimums = state.reduce((sum, debt) => sum + Math.max(0, debt.minimumPayment), 0);
  const payment = Math.max(monthlyPayment, minimums);
  let interest = 0, month = 0;
  const schedule: Array<{ month: number; balance: number }> = [];
  while (state.some((debt) => debt.remaining > .01) && month < 600) {
    month++;
    for (const debt of state) { const added = debt.remaining * debt.rate; interest += added; debt.remaining += added; }
    let available = payment;
    for (const debt of state) {
      if (debt.remaining <= 0) continue;
      const minimum = Math.min(debt.remaining, Math.max(0, debt.minimumPayment));
      debt.remaining -= minimum; available -= minimum;
    }
    const priority = [...state].sort((a, b) => strategy === 'snowball' ? a.remaining - b.remaining : b.rate - a.rate);
    for (const debt of priority) {
      if (available <= 0) break;
      const extra = Math.min(available, debt.remaining); debt.remaining -= extra; available -= extra;
    }
    schedule.push({ month, balance: state.reduce((sum, debt) => sum + debt.remaining, 0) });
  }
  return { order, months: month, interest: Math.round(interest), schedule };
}

export function latestReview(state: RecordState): Review | undefined { return recordsOf<Review>(state, 'monthlyReviews').sort((a, b) => b.month.localeCompare(a.month))[0]; }
export function debtPaymentsFor(state: RecordState, debtId: string): DebtPayment[] { return recordsOf<DebtPayment>(state, 'debtPayments').filter((payment) => payment.debtId === debtId); }
