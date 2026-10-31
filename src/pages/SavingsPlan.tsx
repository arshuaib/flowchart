import { useState } from 'react';
import { Check, Circle, Landmark, Sparkles } from 'lucide-react';
import { Button, Card, Field, PageHeader, ProgressBar, TextInput } from '../components/Shared';
import { useApp } from '../context/AppProvider';
import { money, monthlyExpenses, profileOf, recordsOf, settingsOf } from '../lib/selectors';
import type { SavingsCheck } from '../types';

export function SavingsPlan() {
  const { records, upsert } = useApp();
  const profile = profileOf(records), settings = settingsOf(records);
  const [transferPct, setTransferPct] = useState(String(settings.transferPct));
  const expenses = monthlyExpenses(profile);
  const targetTransfer = profile.salary * Number(transferPct || 0) / 100;
  const available = Math.max(0, profile.salary - expenses);
  const recommended = Math.min(targetTransfer, available);
  const checklist = recordsOf<SavingsCheck>(records, 'savingsChecklist').sort((a, b) => a.key.localeCompare(b.key));
  const checklistItems = [
    { key: 'separate-account', label: 'Choose a separate savings place', description: 'A clear boundary can make savings easier to leave alone.' },
    { key: 'standing-order', label: 'Set up a standing order for payday', description: 'Start with an amount that will not put essentials at risk.' },
    { key: 'remove-card', label: 'Remove easy card access from savings', description: 'Add a little pause between you and an unplanned withdrawal.' },
    { key: 'weekly-track', label: 'Schedule a weekly money check-in', description: 'A short check-in is enough to notice your progress.' },
  ];
  const saveRate = async () => { await upsert('settings', { ...settings, transferPct: Number(transferPct) || 0 }, 'settings'); };
  const toggle = async (key: string, label: string) => {
    const current = checklist.find((item) => item.key === key);
    if (current) await upsert('savingsChecklist', { ...current, done: !current.done }, current.id);
    else await upsert('savingsChecklist', { key, label, done: true });
  };

  return <>
    <PageHeader eyebrow="AUTOMATION BEATS WILLPOWER" title="Savings automation plan" />
    <div className="savings-hero"><div className="savings-hero-mark"><Landmark size={21} /></div><div><p className="eyebrow">A PAYDAY RHYTHM TO TRY</p><h2>Move {money(recommended, profile.currency)} after payday</h2><p>That is {transferPct}% of take-home pay, within the room left after your expense estimate.</p></div><Sparkles size={18} className="hero-sparkle" /></div>
    <div className="savings-layout mt-5">
      <Card title="Build in stages" eyebrow="STARTER EMERGENCY FUND">
        <p className="muted-copy">There is no need to jump straight to a large target. Each stage gives you a little more breathing room.</p>
        <div className="target-ladder">{[1, 3, 6].map((months) => {
          const target = expenses * months, pct = target ? Math.min(100, profile.currentSavings / target * 100) : 0;
          const remaining = Math.max(0, target - profile.currentSavings);
          const timeline = recommended > 0 ? Math.ceil(remaining / recommended) : undefined;
          return <article key={months} className={`target-stage ${profile.currentSavings >= target && target > 0 ? 'stage-done' : ''}`}><div className="target-stage-top"><span className="stage-number">{months}</span><div><strong>{months} month{months === 1 ? '' : 's'} of expenses</strong><small>{money(target, profile.currency)} target</small></div><span className="target-stage-status">{profile.currentSavings >= target && target > 0 ? 'Reached' : timeline ? `~${timeline} mo` : 'Set a transfer'}</span></div><ProgressBar value={pct} label={`${months} month emergency fund progress`} /></article>;
        })}</div>
        <div className="saved-balance"><span>Saved today</span><strong>{money(profile.currentSavings, profile.currency)}</strong></div>
      </Card>
      <Card title="Choose a comfortable amount" eyebrow="ADJUST ANYTIME">
        <p className="muted-copy">Many people start around 5–10%. If that is too much today, a smaller amount still builds the habit.</p>
        <div className="transfer-presets">{[5, 7, 10].map((pct) => <button key={pct} className={`transfer-preset ${Number(transferPct) === pct ? 'selected' : ''}`} onClick={() => setTransferPct(String(pct))}>{pct}%</button>)}</div>
        <Field label="Custom transfer (%)"><TextInput type="number" min="0" max="50" step="1" value={transferPct} onChange={(event) => setTransferPct(event.target.value)} /></Field>
        <div className="transfer-calculation"><span>At this rate</span><strong>{money(targetTransfer, profile.currency)} / month</strong></div>
        <div className="transfer-calculation"><span>Available after estimates</span><strong>{money(available, profile.currency)} / month</strong></div>
        <div className="transfer-calculation transfer-recommended"><span>Suggested for now</span><strong>{money(recommended, profile.currency)} / month</strong></div>
        <Button variant="primary" onClick={() => void saveRate()}>Save transfer amount</Button>
      </Card>
    </div>
    <Card title="Make it easier to keep" eyebrow="A FEW SMALL SETUPS" className="mt-5">
      <div className="checklist-grid">{checklistItems.map((item) => { const saved = checklist.find((entry) => entry.key === item.key); const done = Boolean(saved?.done); return <button key={item.key} className={`checklist-item ${done ? 'done' : ''}`} onClick={() => void toggle(item.key, item.label)} aria-pressed={done}><span className="check-circle">{done ? <Check size={16} /> : <Circle size={16} />}</span><span><strong>{item.label}</strong><small>{item.description}</small></span></button>; })}</div>
      <p className="muted-copy checklist-note">You are choosing the steps that suit you. No checklist needs to be perfect.</p>
    </Card>
  </>;
}
