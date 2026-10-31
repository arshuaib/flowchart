import { useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, Coins } from 'lucide-react';
import { Button, Card, Field, Notice, PageHeader, TextInput } from '../components/Shared';
import { useApp } from '../context/AppProvider';
import { budgetActual, budgetOf, money, monthlyExpenses, profileOf, settingsOf, totalFixed } from '../lib/selectors';
import { CATEGORY_LABELS, type Budget, type ExpenseCategory } from '../types';

const envelopeCategories: ExpenseCategory[] = ['transport', 'food', 'data', 'other'];

export function BudgetBuilder() {
  const { records, upsert } = useApp();
  const profile = profileOf(records), existing = budgetOf(records), settings = settingsOf(records);
  const [mode, setMode] = useState<Budget['mode']>(existing.mode);
  const [needsPct, setNeedsPct] = useState(String(existing.needsPct)), [wantsPct, setWantsPct] = useState(String(existing.wantsPct)), [savingsPct, setSavingsPct] = useState(String(existing.savingsPct));
  const [envelopes, setEnvelopes] = useState<Record<ExpenseCategory, string>>({ rent: '', transport: String(existing.envelopes.transport ?? ''), food: String(existing.envelopes.food ?? ''), utilities: '', data: String(existing.envelopes.data ?? ''), debt: '', other: String(existing.envelopes.other ?? '') });
  const [transferPct, setTransferPct] = useState(String(settings.transferPct));
  const [saved, setSaved] = useState(false);
  const percentageTotal = Number(needsPct || 0) + Number(wantsPct || 0) + Number(savingsPct || 0);
  const budgetValue: Budget = { ...existing, mode, needsPct: Number(needsPct) || 0, wantsPct: Number(wantsPct) || 0, savingsPct: Number(savingsPct) || 0, envelopes: Object.fromEntries(envelopeCategories.map((category) => [category, Number(envelopes[category]) || 0])) };
  const fixedTotal = totalFixed(profile), envelopeTotal = envelopeCategories.reduce((sum, category) => sum + Number(envelopes[category] || 0), 0);
  const plannedTotal = fixedTotal + envelopeTotal;
  const targetTransfer = Math.round(profile.salary * Number(transferPct) / 100);
  const availableTransfer = Math.max(0, profile.salary - monthlyExpenses(profile));
  const recommendedTransfer = Math.min(targetTransfer, availableTransfer);
  const overIncome = plannedTotal + recommendedTransfer > profile.salary;
  const { actualTotal, actual } = budgetActual({ ...records, budget: [budgetValue as unknown as Budget] });

  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaved(false);
    await upsert('budget', budgetValue as unknown as Record<string, unknown>, 'budget');
    await upsert('settings', { ...settings, transferPct: Number(transferPct) || 0 }, 'settings');
    setSaved(true); window.setTimeout(() => setSaved(false), 2800);
  };
  const usePreset = () => { setMode('50-30-20'); setNeedsPct('50'); setWantsPct('30'); setSavingsPct('20'); };

  return <>
    <PageHeader eyebrow="A PLAN THAT FITS REAL LIFE" title="Budget builder" />
    <div className="budget-summary-grid">
      <div className="budget-hero"><div className="budget-hero-top"><span className="budget-icon"><Coins size={17} /></span><span className="eyebrow">PAYDAY TRANSFER</span></div><p className="budget-amount">{money(recommendedTransfer, profile.currency)}</p><p>Suggested for payday at {transferPct}% of take-home pay.</p><small>{availableTransfer < targetTransfer ? 'This is capped by the room left after your current expense estimate.' : 'A starting amount can be adjusted whenever life changes.'}</small></div>
      <div className="budget-summary-card"><span className="eyebrow">ESTIMATED EXPENSE PLAN</span><strong>{money(plannedTotal, profile.currency)}</strong><small>Fixed costs and variable envelopes</small></div>
      <div className="budget-summary-card"><span className="eyebrow">MONTHLY INCOME</span><strong>{money(profile.salary, profile.currency)}</strong><small>Take-home amount you entered</small></div>
    </div>
    {overIncome && <Notice tone="warning"><AlertTriangle size={16} /> Your planned envelopes and transfer exceed monthly income. Reduce a limit or lower the transfer until the plan fits.</Notice>}
    {!overIncome && percentageTotal <= 100 && <Notice tone="success"><CheckCircle2 size={16} /> Your current spending plan fits within the income amount you entered.</Notice>}
    <form onSubmit={save}>
      <div className="dashboard-grid budget-grid mt-5">
        <Card title="Choose your split" eyebrow="INCOME GUIDE" action={<Button type="button" onClick={usePreset}>Use 50 / 30 / 20</Button>}>
          <p className="muted-copy">A guide for needs, wants, and savings. Your real costs may not fit the guide yet; adjust it to match your month.</p>
          <div className="split-fields"><Field label="Needs (%)"><TextInput type="number" min="0" max="100" value={needsPct} onChange={(event) => { setNeedsPct(event.target.value); setMode('custom'); }} /></Field><Field label="Wants (%)"><TextInput type="number" min="0" max="100" value={wantsPct} onChange={(event) => { setWantsPct(event.target.value); setMode('custom'); }} /></Field><Field label="Savings & goals (%)"><TextInput type="number" min="0" max="100" value={savingsPct} onChange={(event) => { setSavingsPct(event.target.value); setMode('custom'); }} /></Field></div>
          <div className="percentage-total"><span>Guide total</span><strong className={percentageTotal > 100 ? 'danger-text' : ''}>{percentageTotal}%</strong></div>
          {percentageTotal > 100 && <p className="form-error">Your percentage guide adds up to more than 100%.</p>}
          <div className="split-bars"><div><span>Needs</span><b style={{ width: `${Math.min(100, Number(needsPct))}%` }} /></div><div><span>Wants</span><b style={{ width: `${Math.min(100, Number(wantsPct))}%` }} /></div><div><span>Savings</span><b style={{ width: `${Math.min(100, Number(savingsPct))}%` }} /></div></div>
        </Card>
        <Card title="Variable envelopes" eyebrow="MONTHLY LIMITS">
          <p className="muted-copy">Set a gentle ceiling for categories that can shift. Leave a category blank if you are not ready to limit it.</p>
          <div className="envelope-list">{envelopeCategories.map((category) => <Field key={category} label={CATEGORY_LABELS[category]}><TextInput type="number" min="0" step="0.01" value={envelopes[category]} onChange={(event) => setEnvelopes((old) => ({ ...old, [category]: event.target.value }))} placeholder="No limit yet" /></Field>)}</div>
          <Field label="Payday savings transfer (%)"><input className="range-input" type="range" min="1" max="50" value={transferPct} onChange={(event) => setTransferPct(event.target.value)} aria-label="Payday savings transfer percentage" /><span className="range-value">{transferPct}% · {money(targetTransfer, profile.currency)} / month</span></Field>
        </Card>
      </div>
      <Card title="Plan check" eyebrow="THIS MONTH" className="mt-5">
        <div className="plan-check-row"><span>Estimated fixed costs</span><strong>{money(fixedTotal, profile.currency)}</strong></div><div className="plan-check-row"><span>Variable envelope limits</span><strong>{money(envelopeTotal, profile.currency)}</strong></div><div className="plan-check-row"><span>Recommended payday transfer</span><strong>{money(recommendedTransfer, profile.currency)}</strong></div><div className="plan-check-row plan-check-total"><span>Actual spending entered</span><strong>{money(actualTotal, profile.currency)}</strong></div>
        <div className="plan-check-categories">{envelopeCategories.map((category) => <span key={category}>{CATEGORY_LABELS[category]} actual: {money(actual[category], profile.currency)}</span>)}</div>
      </Card>
      <div className="form-footer"><span>{saved ? 'Your budget is saved on this device.' : 'You can come back and change any limit at any time.'}</span><Button type="submit" variant="primary">Save budget</Button></div>
    </form>
  </>;
}
