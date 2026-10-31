import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Plus, Sparkles } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, Line, LineChart } from 'recharts';
import { useApp } from '../context/AppProvider';
import { Button, Card, Field, PageHeader, ProgressBar, StatCard, TextInput } from '../components/Shared';
import { coachNotes } from '../lib/coach';
import { activeAssets, activeDebts, budgetActual, monthlyExpenses, money, profileOf, recordsOf, savingsRate, settingsOf, totalAssets, totalDebt } from '../lib/selectors';
import type { Asset, ExpenseEntry, PlanTask, Review } from '../types';
import { CATEGORY_LABELS, CATEGORIES } from '../types';

const palette = ['#5b8b6d', '#e4a989', '#e3c779', '#7c9d9a', '#b2bd97', '#ba806d', '#8aa5bb'];
function monthLabel(value: string) { return new Date(`${value}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short' }); }

export function Dashboard() {
  const { records, upsert } = useApp();
  const profile = profileOf(records);
  const debts = activeDebts(records), assets = activeAssets(records);
  const budget = budgetActual(records);
  const tasks = recordsOf<PlanTask>(records, 'planTasks').sort((a, b) => a.week - b.week);
  const reviews = recordsOf<Review>(records, 'monthlyReviews').sort((a, b) => a.month.localeCompare(b.month)).slice(-6);
  const notes = coachNotes(records);
  const [showAsset, setShowAsset] = useState(false), [assetName, setAssetName] = useState(''), [assetValue, setAssetValue] = useState('');
  const doneTasks = tasks.filter((task) => task.status === 'done').length;
  const nextTasks = tasks.filter((task) => task.status === 'not-started').slice(0, 3);
  const savingsGoal = monthlyExpenses(profile), netWorth = totalAssets(records, profile) - totalDebt(records);
  const spendingData = useMemo(() => CATEGORIES.map((category) => ({ category: CATEGORY_LABELS[category], actual: budget.actual[category], planned: budget.planned[category] })), [budget]);
  const debtData = debts.map((debt) => ({ name: debt.name, balance: debt.balance }));
  const savingsData = reviews.map((review) => ({ month: monthLabel(review.month), saved: review.savingsTransferred }));
  const actualSpend = (Object.values(budget.actual) as number[]).reduce((sum, value) => sum + value, 0);
  const totalPlanWeeks = tasks.length || 13;

  const addAsset = async (event: FormEvent) => {
    event.preventDefault(); if (!assetName.trim() || Number(assetValue) <= 0) return;
    await upsert('assets', { name: assetName.trim(), value: Number(assetValue) }); setAssetName(''); setAssetValue(''); setShowAsset(false);
  };

  return <>
    <PageHeader eyebrow="THE MONTH, IN VIEW" title={`A steady reset, ${new Date().toLocaleDateString(undefined, { month: 'long' })}`}>
      <Button onClick={() => setShowAsset((value) => !value)}><Plus size={15} /> Add an asset</Button>
      <Link to="/review" className="button button-primary">Monthly review <ArrowRight size={15} /></Link>
    </PageHeader>
    {showAsset && <form className="inline-form mb-5" onSubmit={addAsset}><Field label="Asset name"><TextInput autoFocus value={assetName} onChange={(event) => setAssetName(event.target.value)} placeholder="For example, vehicle" /></Field><Field label="Estimated value"><TextInput type="number" min="0" value={assetValue} onChange={(event) => setAssetValue(event.target.value)} /></Field><Button variant="primary" type="submit">Save asset</Button></form>}
    <div className="stat-grid stat-grid-four">
      <StatCard label="Net worth" value={money(netWorth, profile.currency)} hint="Savings + assets − debt" />
      <StatCard label="Planned savings rate" value={`${savingsRate(profile, settingsOf(records))}%`} hint="Based on your payday plan" accent="sand" />
      <StatCard label="Emergency fund" value={`${savingsGoal ? (profile.currentSavings / savingsGoal).toFixed(1) : '0.0'} mo`} hint={`of ${money(savingsGoal, profile.currency)} monthly expenses`} accent="green" />
      <StatCard label="Debt to work through" value={money(totalDebt(records), profile.currency)} hint={`${debts.length} balance${debts.length === 1 ? '' : 's'} listed`} accent="coral" />
    </div>
    <div className="dashboard-grid dashboard-top-grid">
      <Card title="This month at a glance" eyebrow="BUDGET VS ACTUAL" action={<Link to="/budget" className="text-link">Open budget <ArrowRight size={13} /></Link>}>
        <div className="chart-wrap chart-tall"><ResponsiveContainer width="100%" height="100%"><BarChart data={spendingData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}><CartesianGrid vertical={false} stroke="#e9ede6" /><XAxis dataKey="category" tickLine={false} axisLine={false} tick={{ fill: '#68776e', fontSize: 11 }} /><YAxis tickLine={false} axisLine={false} tick={{ fill: '#8a968d', fontSize: 10 }} /><Tooltip formatter={(value) => money(Number(value), profile.currency)} /><Bar dataKey="planned" name="Budget" fill="#dfe8dc" radius={[6, 6, 0, 0]} /><Bar dataKey="actual" name="Actual" fill="#5b8b6d" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>
        <div className="chart-footnote"><span>{budget.actualTotal > 0 ? `Actual so far: ${money(actualSpend, profile.currency)}` : 'No expenses logged for this month yet'}</span><span>Plan: {money(budget.plannedTotal, profile.currency)}</span></div>
      </Card>
      <Card title="Your next small steps" eyebrow="90-DAY RESET" action={<Link to="/reset" className="text-link">See plan <ArrowRight size={13} /></Link>}>
        <div className="plan-progress-label"><span>{doneTasks} of {totalPlanWeeks} weeks complete</span><strong>{Math.round(doneTasks / totalPlanWeeks * 100)}%</strong></div><ProgressBar value={doneTasks / totalPlanWeeks * 100} label="90-day reset progress" />
        <div className="action-list">{nextTasks.length ? nextTasks.map((task) => <Link key={task.id} to="/reset" className="action-row"><span className="action-week">W{task.week}</span><span><strong>{task.title}</strong><small>{task.detail}</small></span><ArrowRight size={15} /></Link>) : <p className="muted-copy">Your next action will show here when your reset plan is ready.</p>}</div>
      </Card>
    </div>
    <div className="dashboard-grid dashboard-bottom-grid">
      <Card title="Debt balances" eyebrow="PAYOFF VIEW" action={<Link to="/debt" className="text-link">Compare payoff plans <ArrowRight size={13} /></Link>}>
        {debtData.length ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={debtData} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 2 }}><CartesianGrid horizontal={false} stroke="#e9ede6" /><XAxis type="number" hide /><YAxis type="category" dataKey="name" width={100} tickLine={false} axisLine={false} tick={{ fill: '#68776e', fontSize: 11 }} /><Tooltip formatter={(value) => money(Number(value), profile.currency)} /><Bar dataKey="balance" name="Balance" fill="#d49b79" radius={[0, 6, 6, 0]} barSize={18}>{debtData.map((_, index) => <Cell key={index} fill={palette[(index + 1) % palette.length]} />)}</Bar></BarChart></ResponsiveContainer></div> : <p className="muted-copy">No debt is listed right now. You can add one if that changes.</p>}
      </Card>
      <Card title="Savings momentum" eyebrow="RECENT PAYMENTS">
        {savingsData.length ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><LineChart data={savingsData} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}><CartesianGrid vertical={false} stroke="#e9ede6" /><XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: '#68776e', fontSize: 11 }} /><YAxis tickLine={false} axisLine={false} tick={{ fill: '#8a968d', fontSize: 10 }} /><Tooltip formatter={(value) => money(Number(value), profile.currency)} /><Line type="monotone" dataKey="saved" name="Saved" stroke="#5b8b6d" strokeWidth={3} dot={{ fill: '#5b8b6d', r: 4 }} /></LineChart></ResponsiveContainer></div> : <div className="empty-mini"><span>01</span><p>Your savings transfers will appear here after a monthly review.</p></div>}
        <div className="savings-target-row"><span>Starter target · 1 month of expenses</span><strong>{money(savingsGoal, profile.currency)}</strong></div>
      </Card>
    </div>
    <div className="dashboard-grid coach-grid">
      {notes.map((note) => <div key={note.title} className={`coach-card coach-${note.tone}`}><Sparkles size={17} /><div><strong>{note.title}</strong><p>{note.body}</p></div></div>)}
    </div>
    <div className="asset-list">{assets.map((asset: Asset) => <span key={asset.id} className="asset-chip">{asset.name}: {money(asset.value, profile.currency)}</span>)}
      {(recordsOf<ExpenseEntry>(records, 'expenseEntries').length > 0) && <span className="asset-chip">Tracked expenses: {recordsOf<ExpenseEntry>(records, 'expenseEntries').length}</span>}
    </div>
  </>;
}
