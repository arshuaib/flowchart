import { cloneElement, isValidElement, useId, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { Info } from 'lucide-react';

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1 className="page-title">{title}</h1></div>{children && <div className="flex flex-wrap gap-2">{children}</div>}</header>;
}

export function Card({ title, eyebrow, action, children, className = '', id }: { title?: string; eyebrow?: string; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return <section id={id} className={`card ${className}`}><div className="mb-4 flex items-start justify-between gap-3">{(title || eyebrow) && <div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}{title && <h2 className="card-title">{title}</h2>}</div>}{action}</div>{children}</section>;
}

export function StatCard({ label, value, hint, accent = 'green' }: { label: string; value: string; hint?: string; accent?: 'green' | 'sand' | 'coral' }) {
  return <div className={`stat-card accent-${accent}`}><p className="stat-label">{label}</p><p className="stat-value">{value}</p>{hint && <p className="stat-hint">{hint}</p>}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const id = useId();
  const control = isValidElement(children) ? cloneElement(children, { id: children.props.id ?? id, 'aria-label': children.props['aria-label'] ?? label } as object) : children;
  return <div className="field"><label className="field-label" htmlFor={id}>{label}</label>{control}{hint && <p className="field-hint">{hint}</p>}</div>;
}
export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={`input ${props.className ?? ''}`} />; }
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className={`input ${props.className ?? ''}`} />; }
export function Button({ children, variant = 'secondary', className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' | 'danger' }) {
  return <button {...props} className={`button button-${variant} ${className}`}>{children}</button>;
}
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) { return <div className="empty-state"><div className="empty-icon"><Info size={18} /></div><h3>{title}</h3>{children && <p>{children}</p>}</div>; }
export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' | 'success' }) { return <div className={`notice notice-${tone}`} role={tone === 'warning' ? 'alert' : 'status'}>{children}</div>; }
export function ProgressBar({ value, label }: { value: number; label?: string }) { const pct = Math.max(0, Math.min(100, value)); return <div className="progress-wrap"><div className="progress-track" role="progressbar" aria-label={label ?? 'Progress'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}><span style={{ width: `${pct}%` }} /></div><span className="progress-value">{Math.round(pct)}%</span></div>; }
