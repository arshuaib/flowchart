import { useMemo, useState, type FormEvent } from 'react';
import { Check, CircleOff, Plus, Trash2 } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button, Card, EmptyState, Field, Notice, PageHeader, Select, TextInput } from '../components/Shared';
import { useApp } from '../context/AppProvider';
import { findLeaks, money, profileOf, recordsOf } from '../lib/selectors';
import { CATEGORY_LABELS, CATEGORIES, type ExpenseCategory, type ExpenseEntry, type LeakStatus } from '../types';

function threeMonthStart() { const date = new Date(); date.setMonth(date.getMonth() - 3); date.setDate(1); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }

export function MoneyAudit() {
  const { records, upsert, remove } = useApp();
  const profile = profileOf(records);
  const entries = recordsOf<ExpenseEntry>(records, 'expenseEntries');
  const statuses = recordsOf<LeakStatus>(records, 'leakStatuses');
  const [amount, setAmount] = useState(''), [category, setCategory] = useState<ExpenseCategory>('food'), [kind, setKind] = useState<'fixed' | 'variable'>('variable'), [date, setDate] = useState(new Date().toISOString().slice(0, 10)), [note, setNote] = useState('');
  const recent = entries.filter((entry) => entry.date.slice(0, 7) >= threeMonthStart()).sort((a, b) => b.date.localeCompare(a.date));
  const leaks = findLeaks(entries, statuses);
  const handled = statuses;
  const chartData = useMemo(() => CATEGORIES.map((item) => ({ category: CATEGORY_LABELS[item], fixed: recent.filter((entry) => entry.category === item && entry.kind === 'fixed').reduce((sum, entry) => sum + entry.amount, 0), variable: recent.filter((entry) => entry.category === item && entry.kind === 'variable').reduce((sum, entry) => sum + entry.amount, 0) })), [recent]);
  const totals = { fixed: recent.filter((entry) => entry.kind === 'fixed').reduce((sum, entry) => sum + entry.amount, 0), variable: recent.filter((entry) => entry.kind === 'variable').reduce((sum, entry) => sum + entry.amount, 0) };
  const logExpense = async (event: FormEvent) => {
    event.preventDefault(); if (Number(amount) <= 0) return;
    await upsert('expenseEntries', { amount: Number(amount), category, kind, date, note: note.trim() });
    setAmount(''); setNote('');
  };
  const setLeakStatus = async (leakCategory: ExpenseCategory, status: 'fixed' | 'ignore') => {
    const prior = statuses.find((item) => item.category === leakCategory);
    if (prior) await remove('leakStatuses', prior.id);
    await upsert('leakStatuses', { category: leakCategory, status });
  };

  return <>
    <PageHeader eyebrow="NOTICE, DON'T JUDGE" title="Money audit & leak finder" />
    <Notice>These entries are private to this device until you choose to sync. A rough picture is enough to spot a helpful next step.</Notice>
    <div className="audit-grid mt-5">
      <Card title="Add an expense" eyebrow="LAST THREE MONTHS">
        <form onSubmit={logExpense} className="audit-form">
          <div className="field-grid"><Field label="Amount"><TextInput required type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field><Field label="Date"><TextInput required type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setDate(event.target.value)} /></Field></div>
          <div className="field-grid"><Field label="Category"><Select value={category} onChange={(event) => setCategory(event.target.value as ExpenseCategory)}>{CATEGORIES.map((item) => <option key={item} value={item}>{CATEGORY_LABELS[item]}</option>)}</Select></Field><Field label="Spending type"><Select value={kind} onChange={(event) => setKind(event.target.value as 'fixed' | 'variable')}><option value="fixed">Fixed</option><option value="variable">Variable</option></Select></Field></div>
          <Field label="Note (optional)"><TextInput value={note} onChange={(event) => setNote(event.target.value)} placeholder="A short reminder for yourself" /></Field>
          <Button type="submit" variant="primary"><Plus size={15} /> Add expense</Button>
        </form>
      </Card>
      <Card title="Fixed and variable" eyebrow="RECENT TOTALS">
        <div className="audit-total-row"><div><span className="legend-swatch fixed-swatch" />Fixed</div><strong>{money(totals.fixed, profile.currency)}</strong><span><span className="legend-swatch variable-swatch" />Variable</span><strong>{money(totals.variable, profile.currency)}</strong></div>
        <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}><CartesianGrid vertical={false} stroke="#e9ede6" /><XAxis dataKey="category" tickLine={false} axisLine={false} tick={{ fill: '#68776e', fontSize: 10 }} /><YAxis tickLine={false} axisLine={false} tick={{ fill: '#8a968d', fontSize: 10 }} /><Tooltip formatter={(value) => money(Number(value), profile.currency)} /><Bar dataKey="fixed" name="Fixed" fill="#bdcdb9" radius={[5, 5, 0, 0]} /><Bar dataKey="variable" name="Variable" fill="#dd9d7d" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div>
      </Card>
    </div>
    <Card title="Three possible leaks to look at" eyebrow="A PLACE TO START" className="mt-5">
      {leaks.length ? <div className="leak-list">{leaks.map((leak) => <article className="leak-card" key={leak.category}><div className="leak-rank">{CATEGORY_LABELS[leak.category][0]}</div><div className="leak-copy"><div className="leak-title"><strong>{CATEGORY_LABELS[leak.category]}</strong><span>{money(leak.monthlyAverage, profile.currency)} / month average</span></div><p>{leak.suggestion}</p><small>Possible monthly room: <strong>{money(leak.monthlySavings, profile.currency)}</strong></small></div><div className="leak-actions"><Button onClick={() => void setLeakStatus(leak.category, 'fixed')}><Check size={14} /> Fixed</Button><Button variant="quiet" onClick={() => void setLeakStatus(leak.category, 'ignore')}><CircleOff size={14} /> Ignore</Button></div></article>)}</div> : <EmptyState title="No clear leak yet">Add a few recent expenses. The audit needs a little data before it can suggest a category.</EmptyState>}
      {handled.length > 0 && <div className="handled-list"><p className="eyebrow">YOUR DECISIONS</p>{handled.map((item) => <div key={item.id} className="handled-row"><span><Check size={13} /> {CATEGORY_LABELS[item.category]}</span><small>{item.status === 'fixed' ? 'Marked fixed' : 'Set aside for now'}</small><button className="icon-button" aria-label={`Undo ${item.status} for ${CATEGORY_LABELS[item.category]}`} onClick={() => void remove('leakStatuses', item.id)}><Trash2 size={14} /></button></div>)}</div>}
    </Card>
    <Card title="Your entries" eyebrow={`${recent.length} RECENT`} className="mt-5">
      {recent.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Date</th><th>Category</th><th>Type</th><th>Note</th><th className="align-right">Amount</th><th /></tr></thead><tbody>{recent.map((entry) => <tr key={entry.id}><td>{new Date(`${entry.date}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</td><td>{CATEGORY_LABELS[entry.category]}</td><td><span className={`tag tag-${entry.kind}`}>{entry.kind}</span></td><td>{entry.note || '—'}</td><td className="align-right">{money(entry.amount, profile.currency)}</td><td><button className="icon-button" aria-label={`Delete ${CATEGORY_LABELS[entry.category]} expense`} onClick={() => void remove('expenseEntries', entry.id)}><Trash2 size={14} /></button></td></tr>)}</tbody></table></div> : <p className="muted-copy">Your spending entries will show here.</p>}
    </Card>
  </>;
}
