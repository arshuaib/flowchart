import type { Goal } from '../types';

const tasks: Array<{ title: string; detail: string }> = [
  { title: 'Face the numbers, gently.', detail: 'Confirm take-home pay, payday, fixed bills, balances, and what is currently saved.' },
  { title: 'Find one leak and shape a budget.', detail: 'Review recent spending and choose one change that feels manageable.' },
  { title: 'Make saving easier to repeat.', detail: 'Choose a separate place for savings and set a payday transfer you can keep.' },
  { title: 'Do your first monthly review.', detail: 'Notice what worked, what leaked, and one small adjustment for next month.' },
  { title: 'Choose a debt payoff order.', detail: 'Compare snowball and avalanche, then set a steady extra payment if possible.' },
  { title: 'Check your progress without judgement.', detail: 'Compare balances with last month and keep the parts of your routine that helped.' },
  { title: 'Look for one income opportunity.', detail: 'Consider a skill, extra shift, rate conversation, or small service that fits your life.' },
  { title: 'Give your plan a mid-point tune-up.', detail: 'Update estimates that changed and adjust envelope limits for real life.' },
  { title: 'Strengthen your emergency buffer.', detail: 'Keep building toward one month of essentials at a pace that feels sustainable.' },
  { title: 'Review debt costs and options.', detail: 'Check rates and terms. Ask the lender about a lower-cost plan if that feels useful.' },
  { title: 'Keep a simple weekly check-in.', detail: 'Spend a few minutes noticing category balances and any upcoming bills.' },
  { title: 'Make room for a future goal.', detail: 'Choose a small savings target after essentials and your current priorities.' },
  { title: 'Close the 90-day reset.', detail: 'Review what changed, celebrate consistency, and choose the next 90-day focus.' },
];

export function buildResetTasks(_goal: Goal) {
  return tasks.map((task, index) => ({ week: index + 1, ...task, status: 'not-started' as const }));
}

export const savingsChecklist = [
  { key: 'separate-account', label: 'Choose a separate savings place', done: false },
  { key: 'standing-order', label: 'Set up a standing order for payday', done: false },
  { key: 'remove-card', label: 'Remove easy card access from savings', done: false },
  { key: 'weekly-track', label: 'Schedule a weekly money check-in', done: false },
];
