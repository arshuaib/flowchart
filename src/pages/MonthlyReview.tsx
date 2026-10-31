import { useMemo, useState, type FormEvent } from 'react';
import { Check, ClipboardList } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button, Card, Field, PageHeader, TextInput } from '../components/Shared';
import { useApp } from '../context/AppProvider';
import { budgetActual, money, monthKey, profileOf, recordsOf } from '../lib/selectors';
import { CATEGORY_LABELS, CATEGORIES, type ExpenseCategory, type Review } from '../types';

function monthTitle(month: string) { return new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); }

export function MonthlyReview() {
  const { records, upsert } = useApp();
  const profile = profileOf(records), currentMonth = monthKey();
  const reviews = recordsOf<Review>(records, 'monthlyReviews').sort((a, b) => b.month.localeCompare(a.month));
  const currentReview = reviews.find((review) => review.month === currentMonth);
  const [income, setIncome] = useState(String(currentReview?.actualIncome ?? profile.salary));
  const [spending, setSpending] = useState<Record<ExpenseCategory, string>>(Object.fromEntries(CATEGORIES.map((category) => [category, String(currentReview?.spending[category] ?? '')])) as Record<ExpenseCategory, string>);
  const [savings, setSavings] = useState(String(currentReview?.savingsTransferred ?? ''));
  const [debtPaid, setDebtPaid] = useState(String(currentReview?.debtPaid ?? ''));
  const [whatLeaked, setWhatLeaked] = useState(currentReview?.whatLeaked ?? '');
  const [whatWorked, setWhatWorked] = useState(currentReview?.whatWorked ?? '');
  const [nextChange, setNextChange] = useState(currentReview?.nextChange ?? '');
  const [saved, setSaved] = useState(false);
  const comparison = budgetActual(records, currentMonth);
  const actualTotal = CATEGORIES.reduce((sum, category) => sum + (Number(spending[category]) || 0), 0);
  const trendData = useMemo(() => reviews.slice(0, 6).reverse().map((review) => ({ month: new Date(`${review.month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short' }), spending: Object.values(review.spending).reduce((sum, amount) => sum + Number(amount || 0), 0), saved: review.savingsTransferred })), [reviews]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    await upsert('monthlyReviews', {
      ...(currentReview ?? {}), month: currentMonth, actualIncome: Number(income) || 0,
      spending: Object.fromEntries(CATEGORIES.map((category) => [category, Number(spending[category]) || 0])),
      savingsTransferred: Number(savings) || 0, debtPaid: Number(debtPaid) || 0, whatLeaked, whatWorked, nextChange,
    } as unknown as Record<string, unknown>, currentReview?.id);
    setSaved(true); window.setTimeout(() => setSaved(false), 2500);
  };

  return <>
    <PageHeader eyebrow="NOTICE WHAT YOUR MONEY DID" title="Monthly review" />
    <div className="review-callout"><ClipboardList size={18} /><div><strong>{monthTitle(currentMonth)}</strong><p>Take a few minutes to record what happened. This is information, not a score.</p></div></div>
    <form onSubmit={save}>
      <div className="dashboard-grid review-grid mt-5">
        <Card title="Income and outflow" eyebrow="THIS MONTH">
          <Field label="Actual take-home income"><TextInput type="number" min="0" step="0.01" value={income} onChange={(event) => setIncome(event.target.value)} /></Field>
          <div className="review-spending-grid">{CATEGORIES.map((category) => <Field key={category} label={CATEGORY_LABELS[category]}><TextInput type="number" min="0" step="0.01" value={spending[category]} onChange={(event) => setSpending((old) => ({ ...old, [category]: event.target.value }))} placeholder="0" /></Field>)}</div>
          <div className="field-grid"><Field label="Savings transferred"><TextInput type="number" min="0" step="0.01" value={savings} onChange={(event) => setSavings(event.target.value)} /></Field><Field label="Debt paid"><TextInput type="number" min="0" step="0.01" value={debtPaid} onChange={(event) => setDebtPaid(event.target.value)} /></Field></div>
          <div className="review-total"><span>Spending entered</span><strong>{money(actualTotal, profile.currency)}</strong></div>
        </Card>
        <Card title="Compare with your budget" eyebrow="A SIMPLE CHECK">
          {CATEGORIES.map((category) => {
            const entered = Number(spending[category]) || comparison.actual[category];
            const planned = comparison.planned[category];
            const pct = planned > 0 ? Math.min(100, entered / planned * 100) : entered > 0 ? 100 : 0;
            return <div className="review-compare-row" key={category}><div><span>{CATEGORY_LABELS[category]}</span><strong>{money(entered, profile.currency)} <small>of {money(planned, profile.currency)}</small></strong></div><div className="compare-track"><span style={{ width: `${pct}%`, background: entered > planned ? '#cd8066' : '#669174' }} /></div></div>;
          })}
          <p className="field-hint">If an amount is blank, we use the audit entries or your original estimate for the comparison.</p>
        </Card>
      </div>
      <Card title="What did you notice?" eyebrow="YOUR NOTES" className="mt-5">
        <div className="reflection-grid"><Field label="What leaked?"><textarea className="input textarea" rows={3} value={whatLeaked} onChange={(event) => setWhatLeaked(event.target.value)} placeholder="A category, a surprise bill, or nothing in particular…" /></Field><Field label="What worked?"><textarea className="input textarea" rows={3} value={whatWorked} onChange={(event) => setWhatWorked(event.target.value)} placeholder="Anything that made the month easier…" /></Field><Field label="What will you change next month?"><textarea className="input textarea" rows={3} value={nextChange} onChange={(event) => setNextChange(event.target.value)} placeholder="One adjustment is enough…" /></Field></div>
        <div className="form-footer"><span>{saved ? <><Check size={14} /> Review saved on this device.</> : 'Your review history stays with your plan.'}</span><Button type="submit" variant="primary">Save monthly review</Button></div>
      </Card>
    </form>
    <div className="dashboard-grid review-history-grid mt-5">
      <Card title="Recent trends" eyebrow="SAVING AND SPENDING">
        {trendData.length ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><LineChart data={trendData} margin={{ top: 8, right: 10, left: -12, bottom: 0 }}><CartesianGrid vertical={false} stroke="#e9ede6" /><XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: '#68776e', fontSize: 11 }} /><YAxis tickLine={false} axisLine={false} tick={{ fill: '#8a968d', fontSize: 10 }} /><Tooltip formatter={(value) => money(Number(value), profile.currency)} /><Line dataKey="spending" name="Spending" stroke="#d89a7a" strokeWidth={2.5} dot={{ r: 3 }} /><Line dataKey="saved" name="Saved" stroke="#5b8b6d" strokeWidth={2.5} dot={{ r: 3 }} /></LineChart></ResponsiveContainer></div> : <p className="muted-copy">After a few reviews, your trends will show here.</p>}
      </Card>
      <Card title="Review history" eyebrow={`${reviews.length} SAVED`}>
        {reviews.length ? <div className="review-history-list">{reviews.map((review) => <div className="review-history-row" key={review.id}><div><strong>{monthTitle(review.month)}</strong><small>Income {money(review.actualIncome, profile.currency)} · Savings {money(review.savingsTransferred, profile.currency)}</small></div><div><small>Spent</small><strong>{money(Object.values(review.spending).reduce((sum, amount) => sum + Number(amount || 0), 0), profile.currency)}</strong></div></div>)}</div> : <p className="muted-copy">Your saved reviews will appear here.</p>}
      </Card>
    </div>
  </>;
}
