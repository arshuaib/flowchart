import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useApp } from '../context/AppProvider';
import { Button, Field, Notice, Select, TextInput } from '../components/Shared';
import { CATEGORIES, CATEGORY_LABELS, type Debt, type ExpenseCategory, type Goal, type Profile } from '../types';
import { buildResetTasks, savingsChecklist } from '../lib/plan';
import { recordsOf, profileOf } from '../lib/selectors';

const currencyOptions = ['USD', 'GHS', 'NGN', 'KES', 'ZAR', 'GBP', 'EUR', 'CAD', 'AUD', 'INR'];
function localeCurrency() {
  const region = new Intl.Locale(navigator.language || 'en-US').maximize().region;
  return ({ GH: 'GHS', NG: 'NGN', KE: 'KES', ZA: 'ZAR', GB: 'GBP', DE: 'EUR', FR: 'EUR', IN: 'INR', CA: 'CAD', AU: 'AUD' } as Record<string, string>)[region ?? ''] ?? 'USD';
}
type DebtDraft = { name: string; balance: string; interestRate: string; minimumPayment: string };
const emptyDebt = (): DebtDraft => ({ name: '', balance: '', interestRate: '', minimumPayment: '' });

export function Onboarding() {
  const { records, upsert, remove } = useApp();
  const navigate = useNavigate();
  const existing = profileOf(records);
  const [step, setStep] = useState(1);
  const [salary, setSalary] = useState(String(existing.salary || ''));
  const [paydayDay, setPaydayDay] = useState(String(existing.paydayDay || 1));
  const [currency, setCurrency] = useState(existing.currency || localeCurrency());
  const [fixed, setFixed] = useState<Record<ExpenseCategory, string>>(Object.fromEntries(CATEGORIES.map((category) => [category, String(existing.fixedExpenses[category] ?? 0)])) as Record<ExpenseCategory, string>);
  const [variableEstimate, setVariableEstimate] = useState(String(existing.variableEstimate || ''));
  const [currentSavings, setCurrentSavings] = useState(String(existing.currentSavings || ''));
  const [goal, setGoal] = useState<Goal>(existing.primaryGoal || 'emergency-fund');
  const [debts, setDebts] = useState<DebtDraft[]>([{ name: '', balance: '', interestRate: '', minimumPayment: '' }]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const updateDebt = (index: number, key: keyof DebtDraft, value: string) => setDebts((old) => old.map((debt, i) => i === index ? { ...debt, [key]: value } : debt));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    if (step < 3) { setStep(step + 1); return; }
    if (Number(salary) <= 0) { setError('Add a monthly take-home amount so we can make a useful plan.'); setStep(1); return; }
    setSaving(true);
    try {
      const profile: Omit<Profile, 'id' | 'updatedAt' | 'deviceId' | 'deleted'> = {
        name: existing.name || 'My reset', salary: Number(salary), paydayDay: Number(paydayDay), currency,
        fixedExpenses: Object.fromEntries(CATEGORIES.map((category) => [category, Number(fixed[category]) || 0])) as Record<ExpenseCategory, number>,
        variableEstimate: Number(variableEstimate) || 0, currentSavings: Number(currentSavings) || 0, primaryGoal: goal, onboarded: true,
      };
      await upsert('profile', profile as unknown as Record<string, unknown>, 'profile');
      const settings = recordsOf(records, 'settings')[0];
      await upsert('settings', { ...(settings ?? { id: 'settings', transferPct: 5, debtStrategy: 'avalanche' }), currency }, 'settings');
      await upsert('budget', { id: 'budget', mode: '50-30-20', needsPct: 50, wantsPct: 30, savingsPct: 20, envelopes: {} }, 'budget');
      const oldDebts = recordsOf<Debt>(records, 'debts');
      for (const debt of oldDebts) await remove('debts', debt.id);
      for (const debt of debts.filter((item) => item.name.trim() && Number(item.balance) > 0)) {
        await upsert('debts', { name: debt.name.trim(), balance: Number(debt.balance), interestRate: Number(debt.interestRate) || 0, minimumPayment: Number(debt.minimumPayment) || 0 });
      }
      if (!recordsOf(records, 'planTasks').length) for (const task of buildResetTasks(goal)) await upsert('planTasks', task);
      if (!recordsOf(records, 'savingsChecklist').length) for (const item of savingsChecklist) await upsert('savingsChecklist', item);
      navigate('/');
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Your details could not be saved. Please try again.'); }
    finally { setSaving(false); }
  };

  return <div className="onboarding-wrap">
    <div className="onboarding-aside"><div className="onboarding-art"><div className="art-sun"/><div className="art-hill art-hill-one"/><div className="art-hill art-hill-two"/><div className="art-stem"/><div className="art-leaf art-leaf-left"/><div className="art-leaf art-leaf-right"/></div><p className="eyebrow">A QUIETER WAY FORWARD</p><h2>Start with what is true today.</h2><p>Years of effort count. We will turn the numbers you have into one practical next step at a time.</p><div className="disclaimer-inline">This app is for personal planning, not regulated financial advice.</div></div>
    <section className="onboarding-card">
      <div className="wizard-heading"><div><p className="eyebrow">YOUR STARTING POINT · STEP {step} OF 3</p><h1>{['Your pay rhythm', 'Your monthly picture', 'Anything to repay'][step - 1]}</h1></div><span className="wizard-step">0{step}<small> / 03</small></span></div>
      <div className="wizard-progress"><span style={{ width: `${step / 3 * 100}%` }} /></div>
      <form onSubmit={submit}>
        {step === 1 && <div className="wizard-fields">
          <Field label="Monthly take-home salary"><TextInput autoFocus required type="number" min="0" step="0.01" value={salary} onChange={(event) => setSalary(event.target.value)} placeholder="After tax and deductions" /></Field>
          <div className="field-grid"><Field label="Payday"><TextInput type="number" min="1" max="31" value={paydayDay} onChange={(event) => setPaydayDay(event.target.value)} /></Field><Field label="Currency"><Select value={currency} onChange={(event) => setCurrency(event.target.value)}>{[...new Set([localeCurrency(), ...currencyOptions])].map((value) => <option key={value}>{value}</option>)}</Select></Field></div>
          <Field label="What would feel most useful right now?"><div className="goal-grid">{[['emergency-fund', 'Build a safety cushion'], ['pay-debt', 'Pay down debt'], ['start-saving', 'Start saving regularly'], ['increase-income', 'Increase my income']].map(([value, label]) => <button type="button" key={value} className={`goal-option ${goal === value ? 'selected' : ''}`} onClick={() => setGoal(value as Goal)}><span>{goal === value ? '●' : '○'}</span>{label}</button>)}</div></Field>
        </div>}
        {step === 2 && <div className="wizard-fields">
          <p className="muted-copy">Rough estimates are fine. Nothing here needs to be perfect to get started.</p>
          <div className="expense-grid">{CATEGORIES.map((category) => <Field key={category} label={CATEGORY_LABELS[category]}><TextInput type="number" min="0" step="0.01" value={fixed[category]} onChange={(event) => setFixed((old) => ({ ...old, [category]: event.target.value }))} /></Field>)}</div>
          <div className="field-grid"><Field label="Other variable spending estimate"><TextInput type="number" min="0" step="0.01" value={variableEstimate} onChange={(event) => setVariableEstimate(event.target.value)} placeholder="Flexible month-to-month spending" /></Field><Field label="Savings you have today"><TextInput type="number" min="0" step="0.01" value={currentSavings} onChange={(event) => setCurrentSavings(event.target.value)} /></Field></div>
        </div>}
        {step === 3 && <div className="wizard-fields">
          <p className="muted-copy">If you have debt, add the balances you know. You can fill in missing rates later.</p>
          {debts.map((debt, index) => <div className="debt-draft" key={index}><div className="debt-draft-heading"><strong>Debt {index + 1}</strong>{debts.length > 1 && <button className="icon-button danger-text" type="button" aria-label={`Remove debt ${index + 1}`} onClick={() => setDebts((old) => old.filter((_, i) => i !== index))}><Trash2 size={15} /></button>}</div><Field label="Name"><TextInput value={debt.name} onChange={(event) => updateDebt(index, 'name', event.target.value)} placeholder="For example, personal loan" /></Field><div className="field-grid"><Field label="Balance"><TextInput type="number" min="0" step="0.01" value={debt.balance} onChange={(event) => updateDebt(index, 'balance', event.target.value)} /></Field><Field label="Interest rate (%)"><TextInput type="number" min="0" step="0.01" value={debt.interestRate} onChange={(event) => updateDebt(index, 'interestRate', event.target.value)} /></Field><Field label="Minimum payment"><TextInput type="number" min="0" step="0.01" value={debt.minimumPayment} onChange={(event) => updateDebt(index, 'minimumPayment', event.target.value)} /></Field></div></div>)}
          <Button type="button" variant="quiet" onClick={() => setDebts((old) => [...old, emptyDebt()])}><Plus size={15} /> Add another debt</Button>
          <Notice><Sparkles size={16} /> Your starting point is enough. You can change any number later.</Notice>
        </div>}
        {error && <p role="alert" className="form-error">{error}</p>}
        <div className="wizard-actions">{step > 1 ? <Button type="button" onClick={() => setStep(step - 1)}><ArrowLeft size={15} /> Back</Button> : <span />}{step < 3 ? <Button type="submit" variant="primary">Continue <ArrowRight size={15} /></Button> : <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Saving your plan…' : 'Build my reset plan'} <ArrowRight size={15} /></Button>}</div>
      </form>
    </section>
  </div>;
}
