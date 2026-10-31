import { useMemo, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button, Card, EmptyState, Field, PageHeader, Select, TextInput } from '../components/Shared';
import { useApp } from '../context/AppProvider';
import { calculatePayoff, activeDebts, monthlyExpenses, money, profileOf, recordsOf, settingsOf } from '../lib/selectors';
import type { DebtPayment } from '../types';

export function DebtPlanner() {
  const { records, upsert } = useApp();
  const profile = profileOf(records), settings = settingsOf(records);
  const debts = activeDebts(records);
  const totalMinimum = debts.reduce((sum, debt) => sum + debt.minimumPayment, 0);
  const roomAfterEssentials = Math.max(0, profile.salary - monthlyExpenses(profile));
  const paymentBudget = totalMinimum + Math.max(0, roomAfterEssentials - profile.salary * settings.transferPct / 100);
  const avalanche = useMemo(() => calculatePayoff(debts, paymentBudget, 'avalanche'), [debts, paymentBudget]);
  const snowball = useMemo(() => calculatePayoff(debts, paymentBudget, 'snowball'), [debts, paymentBudget]);
  const selected = settings.debtStrategy === 'avalanche' ? avalanche : snowball;
  const [debtId, setDebtId] = useState(debts[0]?.id ?? ''), [payment, setPayment] = useState(''), [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const payments = recordsOf<DebtPayment>(records, 'debtPayments').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  const logPayment = async (event: FormEvent) => {
    event.preventDefault();
    const debt = debts.find((item) => item.id === debtId);
    const amount = Number(payment);
    if (!debt || amount <= 0) return;
    await upsert('debtPayments', { debtId, amount, date });
    await upsert('debts', { ...debt, balance: Math.max(0, debt.balance - amount) }, debt.id);
    setPayment('');
  };
  const setStrategy = async (strategy: 'avalanche' | 'snowball') => { await upsert('settings', { ...settings, debtStrategy: strategy }, 'settings'); };

  return <>
    <PageHeader eyebrow="A CLEAR ORDER, ONE PAYMENT AT A TIME" title="Debt payoff planner" />
    {debts.length ? <>
      <div className="strategy-grid">
        {[['avalanche', 'Avalanche', 'Highest interest first', avalanche], ['snowball', 'Snowball', 'Smallest balance first', snowball]].map(([id, label, description, result]) => {
          const payoff = result as ReturnType<typeof calculatePayoff>; const chosen = settings.debtStrategy === id;
          return <button key={id as string} className={`strategy-card ${chosen ? 'selected' : ''}`} onClick={() => void setStrategy(id as 'avalanche' | 'snowball')}><span className="strategy-mark">{id === 'avalanche' ? <ArrowDown size={16} /> : <ArrowUp size={16} />}</span><div><p className="eyebrow">{description as string}</p><h3>{label as string}</h3><div className="strategy-stats"><span><strong>{payoff.months}</strong> months</span><span><strong>{money(payoff.interest, profile.currency)}</strong> interest est.</span></div></div><span className="strategy-select">{chosen ? 'Selected' : 'Choose'}</span></button>;
        })}
      </div>
      <div className="dashboard-grid debt-grid mt-5">
        <Card title="Your payoff order" eyebrow={`${settings.debtStrategy.toUpperCase()} STRATEGY`}>
          <div className="payoff-order">{selected.order.map((debt, index) => <div className="payoff-row" key={debt.id}><span className="order-number">{index + 1}</span><div><strong>{debt.name}</strong><small>{debt.interestRate}% rate · min {money(debt.minimumPayment, profile.currency)}</small></div><b>{money(debt.balance, profile.currency)}</b></div>)}</div>
          <div className="payoff-summary"><div><span>Estimated payoff time</span><strong>{selected.months} months</strong></div><div><span>Estimated total interest</span><strong>{money(selected.interest, profile.currency)}</strong></div><div><span>Monthly payoff budget</span><strong>{money(paymentBudget, profile.currency)}</strong></div></div>
        </Card>
        <Card title="Balance if payments stay steady" eyebrow="ESTIMATE">
          <p className="muted-copy">A planning estimate using listed rates and minimums. Lender terms and fees can change the result.</p>
          <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><LineChart data={selected.schedule} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}><CartesianGrid vertical={false} stroke="#e9ede6" /><XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: '#68776e', fontSize: 10 }} label={{ value: 'Months', position: 'insideBottomRight', offset: -4 }} /><YAxis tickLine={false} axisLine={false} tick={{ fill: '#8a968d', fontSize: 10 }} /><Tooltip formatter={(value) => money(Number(value), profile.currency)} labelFormatter={(label) => `Month ${label}`} /><Line dataKey="balance" name="Balance" type="monotone" stroke="#5b8b6d" strokeWidth={3} dot={false} /></LineChart></ResponsiveContainer></div>
        </Card>
      </div>
      <div className="dashboard-grid debt-grid mt-5">
        <Card title="Log a payment" eyebrow="KEEP THE RECORD CURRENT">
          <form onSubmit={logPayment} className="payment-form"><Field label="Debt"><Select value={debtId} onChange={(event) => setDebtId(event.target.value)}>{debts.map((debt) => <option key={debt.id} value={debt.id}>{debt.name}</option>)}</Select></Field><div className="field-grid"><Field label="Amount paid"><TextInput type="number" min="0.01" step="0.01" required value={payment} onChange={(event) => setPayment(event.target.value)} /></Field><Field label="Date"><TextInput type="date" required value={date} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setDate(event.target.value)} /></Field></div><Button type="submit" variant="primary"><Plus size={14} /> Log payment</Button></form>
        </Card>
        <Card title="Recent payments" eyebrow="PAYMENT LOG">
          {payments.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Date</th><th>Debt</th><th className="align-right">Amount</th></tr></thead><tbody>{payments.map((item) => <tr key={item.id}><td>{new Date(`${item.date}T00:00:00`).toLocaleDateString()}</td><td>{debts.find((debt) => debt.id === item.debtId)?.name ?? 'Removed debt'}</td><td className="align-right">{money(item.amount, profile.currency)}</td></tr>)}</tbody></table></div> : <p className="muted-copy">Payments you log will appear here.</p>}
        </Card>
      </div>
    </> : <Card title="Add a debt to start planning" eyebrow="NO BALANCES LISTED"><EmptyState title="There is no debt in your plan right now">If you add a balance later, you can compare payoff strategies here.</EmptyState></Card>}
  </>;
}
