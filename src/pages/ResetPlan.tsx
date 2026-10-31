import { Check, Circle, Forward, RotateCcw } from 'lucide-react';
import { Button, Card, PageHeader, ProgressBar } from '../components/Shared';
import { useApp } from '../context/AppProvider';
import { buildResetTasks } from '../lib/plan';
import { profileOf, recordsOf } from '../lib/selectors';
import type { PlanTask } from '../types';

const phaseName = (week: number) => week <= 4 ? 'Set your footing' : week <= 8 ? 'Build the rhythm' : 'Keep it moving';

export function ResetPlan() {
  const { records, upsert } = useApp();
  const profile = profileOf(records);
  const current = recordsOf<PlanTask>(records, 'planTasks').sort((a, b) => a.week - b.week);
  const tasks = current.length ? current : buildResetTasks(profile.primaryGoal).map((task) => ({ ...task, id: `week-${task.week}`, updatedAt: '', deviceId: '' } as PlanTask));
  const done = tasks.filter((task) => task.status === 'done').length;
  const skipped = tasks.filter((task) => task.status === 'skipped').length;
  const setStatus = async (task: PlanTask, status: PlanTask['status']) => {
    if (!task.updatedAt) await upsert('planTasks', { week: task.week, title: task.title, detail: task.detail, status });
    else await upsert('planTasks', { ...task, status }, task.id);
  };
  const seedTasks = async () => { for (const task of buildResetTasks(profile.primaryGoal)) await upsert('planTasks', task); };

  return <>
    <PageHeader eyebrow="THIRTEEN WEEKS, ONE STEP AT A TIME" title="Your 90-day reset plan" />
    <div className="reset-overview"><div><p className="eyebrow">PROGRESS AT YOUR PACE</p><h2>{done} of {tasks.length} weeks completed</h2><p>{skipped ? `${skipped} week${skipped === 1 ? '' : 's'} set aside. You can return to them whenever it suits you.` : 'A skipped step can wait. You can pick this back up whenever you are ready.'}</p></div><div className="reset-progress-number">{Math.round(done / (tasks.length || 13) * 100)}<small>%</small></div><ProgressBar value={done / (tasks.length || 13) * 100} label="90-day reset completion" /></div>
    {!current.length && <div className="seed-plan-notice"><span>Your 90-day plan is ready to personalize and save.</span><Button onClick={() => void seedTasks()} variant="primary">Save the plan</Button></div>}
    <div className="week-list">{tasks.map((task) => <article className={`week-card week-${task.status}`} key={task.id}><div className="week-marker"><span>W{String(task.week).padStart(2, '0')}</span><i /></div><div className="week-content"><div className="week-topline"><span className="eyebrow">{phaseName(task.week)}</span><span className={`task-status status-${task.status}`}>{task.status === 'done' ? 'Done' : task.status === 'skipped' ? 'Skipped' : 'Not started'}</span></div><h3>{task.title}</h3><p>{task.detail}</p><div className="week-actions">{task.status !== 'done' && <Button variant="primary" onClick={() => void setStatus(task, 'done')}><Check size={14} /> Mark done</Button>}{task.status !== 'skipped' && task.status !== 'done' && <Button variant="quiet" onClick={() => void setStatus(task, 'skipped')}><Forward size={14} /> Skip for now</Button>}{task.status !== 'not-started' && <Button variant="quiet" onClick={() => void setStatus(task, 'not-started')}><RotateCcw size={14} /> Reset status</Button>}</div></div></article>)}</div>
    <Card title="A note to keep" eyebrow="YOUR PLAN CAN CHANGE">
      <div className="coach-card coach-calm reset-note"><Circle size={16} /><p>If your pay, expenses, or energy changes, update your plan to match. Small steps count, and skipped weeks do not erase the work you have already done.</p></div>
    </Card>
  </>;
}
