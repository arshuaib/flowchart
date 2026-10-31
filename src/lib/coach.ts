import { activeDebts, findLeaks, monthlyExpenses, money, profileOf, recordsOf, settingsOf } from './selectors';
import type { ExpenseEntry, RecordState, Review } from '../types';

export type CoachNote = { title: string; body: string; tone: 'calm' | 'focus' | 'celebrate' };
export function coachNotes(state: RecordState): CoachNote[] {
  const profile = profileOf(state), settings = settingsOf(state), notes: CoachNote[] = [];
  if (profile.onboarded && profile.currentSavings <= 0) notes.push({ title: 'Start small, then build.', body: 'You do not have an emergency fund yet. A first step can be one week of expenses.', tone: 'calm' });
  const entries = recordsOf<ExpenseEntry>(state, 'expenseEntries');
  const leak = findLeaks(entries)[0];
  if (leak) notes.push({ title: `${leak.category[0]!.toUpperCase()}${leak.category.slice(1)} is your biggest recent leak.`, body: `Cutting it by half could free about ${money(leak.monthlySavings, profile.currency)} each month. ${leak.suggestion}`, tone: 'focus' });
  const debts = activeDebts(state).sort((a, b) => b.interestRate - a.interestRate);
  if (debts[0]) notes.push({ title: `Your highest-rate debt is ${debts[0].name}.`, body: `Its listed rate is ${debts[0].interestRate}%. ${settings.debtStrategy === 'avalanche' ? 'Your avalanche plan prioritizes it.' : 'You can compare it with the snowball plan.'}`, tone: 'focus' });
  const reviews = recordsOf<Review>(state, 'monthlyReviews');
  const last = reviews.sort((a, b) => b.month.localeCompare(a.month))[0];
  if (last && last.savingsTransferred <= 0) notes.push({ title: 'A skipped transfer is just a pause.', body: 'Reset a comfortable amount for payday. One missed month does not erase the progress you have made.', tone: 'calm' });
  if (profile.salary > 0 && profile.currentSavings >= monthlyExpenses(profile)) notes.push({ title: 'You have reached a month of expenses.', body: 'That gives you more breathing room. Keep building at a pace that fits your life.', tone: 'celebrate' });
  return notes.slice(0, 4);
}
