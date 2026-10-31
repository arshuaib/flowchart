import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { AlertTriangle, Cloud, Download, FileJson, KeyRound, RefreshCw, Shield, Trash2, Upload } from 'lucide-react';
import { Button, Card, Field, Notice, PageHeader, Select, TextInput } from '../components/Shared';
import { useApp } from '../context/AppProvider';
import { downloadJson, encodeBackup, parseBackup, restoreRecords } from '../lib/backup';
import { driveAdapter } from '../lib/driveAdapter';
import { ensureDeviceId, getRecords, getRecoveries, saveRecovery } from '../lib/db';
import { googleAuth } from '../lib/googleAuth';
import { legacyKeysPresent, migrateFlowTrackOptIn } from '../lib/legacyMigration';
import { profileOf, recordsOf } from '../lib/selectors';
import { CATEGORIES, CATEGORY_LABELS, type Debt, type DriveFileMeta, type ExpenseCategory, type Goal, type ConflictLogEntry, type RecordState } from '../types';

const currencies = ['USD', 'GHS', 'NGN', 'KES', 'ZAR', 'GBP', 'EUR', 'CAD', 'AUD', 'INR', 'JPY'];
const goals: Array<{ value: Goal; label: string }> = [{ value: 'emergency-fund', label: 'Emergency fund' }, { value: 'pay-debt', label: 'Pay debt' }, { value: 'start-saving', label: 'Start saving' }, { value: 'increase-income', label: 'Increase income' }];

type RestorePreview = { name: string; fileId?: string; records: RecordState; added: number; replaced: number; raw: string };

function downloadText(filename: string, raw: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Settings() {
  const { records, auth, syncStatus, pendingCount, deviceId, lastSyncAt, lastError, online, upsert, remove, connect, disconnect, revoke, refresh, syncNow } = useApp();
  const profile = profileOf(records);
  const debts = recordsOf<Debt>(records, 'debts');
  const conflicts = recordsOf<ConflictLogEntry>(records, 'conflictLog').sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
  const [profileDraft, setProfileDraft] = useState(() => ({ name: profile.name, salary: String(profile.salary), paydayDay: String(profile.paydayDay), currency: profile.currency, variableEstimate: String(profile.variableEstimate), currentSavings: String(profile.currentSavings), primaryGoal: profile.primaryGoal, fixedExpenses: Object.fromEntries(CATEGORIES.map((category) => [category, String(profile.fixedExpenses[category] ?? 0)])) as Record<ExpenseCategory, string> }));
  const [debtDraft, setDebtDraft] = useState({ name: '', balance: '', interestRate: '', minimumPayment: '' });
  const [dataError, setDataError] = useState(''), [dataMessage, setDataMessage] = useState('');
  const [snapshots, setSnapshots] = useState<DriveFileMeta[]>([]), [snapshotError, setSnapshotError] = useState(''), [snapshotBusy, setSnapshotBusy] = useState(false);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [driveDeleteText, setDriveDeleteText] = useState(''), [localDeleteText, setLocalDeleteText] = useState('');
  const [legacyPresent, setLegacyPresent] = useState<string[]>([]), [recoveries, setRecoveries] = useState<Array<{ id: string; name: string; createdAt: string }>>([]);
  const localSize = useMemo(() => new Blob([JSON.stringify(records)]).size, [records]);
  const sizeMb = (localSize / 1024 / 1024).toFixed(2);

  useEffect(() => { setLegacyPresent(legacyKeysPresent()); void getRecoveries().then((items) => setRecoveries(items)); }, []);
  useEffect(() => { if (auth.status === 'signed-in') void loadSnapshots(); }, [auth.status]);

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    await upsert('profile', { ...profile, ...profileDraft, salary: Number(profileDraft.salary) || 0, paydayDay: Math.max(1, Math.min(31, Number(profileDraft.paydayDay) || 1)), variableEstimate: Number(profileDraft.variableEstimate) || 0, currentSavings: Number(profileDraft.currentSavings) || 0, fixedExpenses: Object.fromEntries(CATEGORIES.map((category) => [category, Number(profileDraft.fixedExpenses[category]) || 0])), onboarded: true } as unknown as Record<string, unknown>, 'profile');
    const settings = recordsOf(records, 'settings')[0];
    await upsert('settings', { ...settings, currency: profileDraft.currency }, 'settings');
    setDataMessage('Profile changes saved on this device.');
  };

  const addDebt = async (event: FormEvent) => {
    event.preventDefault(); if (!debtDraft.name.trim() || Number(debtDraft.balance) <= 0) return;
    await upsert('debts', { name: debtDraft.name.trim(), balance: Number(debtDraft.balance), interestRate: Number(debtDraft.interestRate) || 0, minimumPayment: Number(debtDraft.minimumPayment) || 0 });
    setDebtDraft({ name: '', balance: '', interestRate: '', minimumPayment: '' });
  };
  const updateDebt = async (debt: Debt, key: keyof Debt, value: string) => {
    const next = { ...debt, [key]: key === 'name' ? value : Number(value) || 0 };
    await upsert('debts', next, debt.id);
  };
  const exportData = async () => { const state = await getRecords(); downloadJson(`salary-reset-backup-${new Date().toISOString().slice(0, 10)}.json`, encodeBackup(state, await ensureDeviceId())); setDataMessage('JSON backup downloaded. Keep it somewhere private.'); };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    setDataError(''); setDataMessage('');
    try {
      if (file.size > 5 * 1024 * 1024) setDataMessage('This backup is larger than 5 MB. Import will still be attempted.');
      const parsed = parseBackup(await file.text());
      const count = Object.values(parsed.records).reduce((sum, list) => sum + list.length, 0);
      if (!window.confirm(`Import ${count} records from this ${parsed.source === 'legacy-flowtrack' ? 'legacy FlowTrack' : 'Salary Reset'} JSON file? Matching records will be refreshed and items not in the file will remain.`)) return;
      const result = await restoreRecords(parsed.records);
      await refresh(); setDataMessage(`Imported ${result.added} new records and refreshed ${result.replaced} existing records. A local safety copy was saved.`);
      if (auth.status === 'signed-in') void syncNow();
    } catch (error) { setDataError(error instanceof Error ? error.message : 'Import failed. Existing data is unchanged.'); }
  };

  async function loadSnapshots() {
    setSnapshotBusy(true); setSnapshotError('');
    try { const token = await googleAuth.getAccessToken(); setSnapshots(await driveAdapter.listSnapshots(token)); }
    catch (error) { setSnapshotError(error instanceof Error ? error.message : 'Could not load Drive snapshots.'); }
    finally { setSnapshotBusy(false); }
  }
  const downloadSnapshot = async (file: DriveFileMeta) => {
    try { const token = await googleAuth.getAccessToken(); downloadText(file.name, await driveAdapter.downloadFile(token, file.id)); }
    catch (error) { setSnapshotError(error instanceof Error ? error.message : 'Could not download snapshot.'); }
  };
  const previewSnapshot = async (file: DriveFileMeta) => {
    try {
      const token = await googleAuth.getAccessToken(); const raw = await driveAdapter.downloadFile(token, file.id); const parsed = parseBackup(raw); const current = await getRecords();
      const old = new Set(Object.entries(current).flatMap(([collection, rows]) => rows.map((record) => `${collection}:${record.id}`)));
      let added = 0, replaced = 0;
      for (const [collection, rows] of Object.entries(parsed.records)) for (const record of rows) old.has(`${collection}:${record.id}`) ? replaced++ : added++;
      setPreview({ name: file.name, fileId: file.id, records: parsed.records, added, replaced, raw });
    } catch (error) { setSnapshotError(error instanceof Error ? error.message : 'The snapshot could not be read.'); }
  };
  const confirmRestore = async () => {
    if (!preview) return;
    try {
      const result = await restoreRecords(preview.records);
      await saveRecovery(preview.raw, `restored-${preview.name}`);
      await refresh(); setPreview(null); setDataMessage(`Restored ${result.added} new and refreshed ${result.replaced} records. A local safety snapshot was saved; Drive sync will merge the restore.`);
      if (auth.status === 'signed-in') void syncNow();
    } catch (error) { setSnapshotError(error instanceof Error ? error.message : 'Restore could not be completed.'); }
  };

  const disconnectNow = () => { disconnect(); setSnapshots([]); };
  const deleteDrive = async () => {
    if (driveDeleteText !== 'DELETE') return;
    try { const token = await googleAuth.getAccessToken(); await driveAdapter.deleteAllAppData(token); setSnapshots([]); setDriveDeleteText(''); setDataMessage('Salary Reset app data was deleted from Drive. Local data is still on this device.'); }
    catch (error) { setSnapshotError(error instanceof Error ? error.message : 'Could not delete Drive app data.'); }
  };
  const resetLocal = async () => {
    if (localDeleteText !== 'RESET') return;
    if (!window.confirm('Reset all Salary Reset data stored on this device? This cannot be undone here. Download a backup first if you want to keep it.')) return;
    try {
      const existing = await getRecords(); await saveRecovery(JSON.stringify(existing), `reset-safety-${new Date().toISOString()}.json`, existing);
      const { clearLocalData, saveRecord } = await import('../lib/db');
      await clearLocalData();
      await saveRecord('profile', { id: 'profile', name: 'My reset', salary: 0, paydayDay: 1, currency: profile.currency, fixedExpenses: { rent: 0, transport: 0, food: 0, utilities: 0, data: 0, debt: 0, other: 0 }, variableEstimate: 0, currentSavings: 0, primaryGoal: 'emergency-fund', onboarded: false }, 'profile');
      window.location.assign('/onboarding');
    } catch (error) { setDataError(error instanceof Error ? error.message : 'Local reset failed.'); }
  };
  const optInLegacyMigration = async () => {
    if (!window.confirm('Move the existing FlowTrack browser data into Salary Reset? A safety copy will be saved first. The old keys are removed only after the IndexedDB write succeeds.')) return;
    try { const { indexedDbSyncStore } = await import('../lib/db'); const count = await migrateFlowTrackOptIn(indexedDbSyncStore); await refresh(); setLegacyPresent(legacyKeysPresent()); setDataMessage(`Moved ${count} legacy records into this device. Review the imported amounts before syncing.`); }
    catch (error) { setDataError(error instanceof Error ? error.message : 'Legacy migration could not finish. The source data remains in browser storage.'); }
  };

  return <>
    <PageHeader eyebrow="YOUR DATA, YOUR CHOICES" title="Settings & sync" />
    <section id="sync" className="settings-section">
      <Card title="Google Drive connection" eyebrow="SYNC & BACKUP" action={<span className={`tag ${auth.status === 'signed-in' ? 'tag-done' : 'tag-neutral'}`}>{auth.status === 'signed-in' ? 'Connected in this session' : 'Not connected'}</span>}>
        <div className="sync-settings-row"><div className="settings-icon"><Cloud size={18} /></div><div><strong>{auth.status === 'signed-in' ? 'Drive is connected for this session' : 'Connect when you want multi-device sync'}</strong><p>{auth.status === 'signed-in' ? 'Your access token stays in memory and is cleared when you sign out or close the app.' : 'Salary Reset works without Google. Your local data remains on this device until you connect.'}</p></div><div className="settings-actions">{auth.status === 'signed-in' ? <><Button onClick={() => void syncNow()}><RefreshCw size={14} /> Sync now</Button><Button variant="quiet" onClick={disconnectNow}>Disconnect</Button></> : <Button variant="primary" onClick={() => void connect()}><Cloud size={14} /> Sign in with Google</Button>}</div></div>
        {auth.status === 'error' && <Notice tone="warning">{auth.error}</Notice>}
        {lastError && <Notice tone="warning">Last sync issue: {lastError}</Notice>}
        <div className="sync-detail-grid"><div><small>Device ID</small><strong>{deviceId ? `${deviceId.slice(0, 8)}…${deviceId.slice(-4)}` : 'Preparing'}</strong></div><div><small>Last successful sync</small><strong>{lastSyncAt ? new Date(lastSyncAt).toLocaleString() : 'Not yet'}</strong></div><div><small>Pending changes</small><strong>{pendingCount} record{pendingCount === 1 ? '' : 's'}</strong></div><div><small>Connection</small><strong>{online ? syncStatus : 'Offline · queued locally'}</strong></div></div>
        <div className="privacy-note"><Shield size={15} /> OAuth tokens stay in memory only. Your finance records are local in IndexedDB and in the Drive sync file when sync is enabled.</div>
      </Card>
    </section>
    <div className="settings-grid mt-5">
      <Card title="Profile and monthly expenses" eyebrow="EDIT YOUR PLAN">
        <form onSubmit={(event) => void saveProfile(event)}>
          <div className="field-grid"><Field label="Name"><TextInput value={profileDraft.name} onChange={(event) => setProfileDraft((old) => ({ ...old, name: event.target.value }))} /></Field><Field label="Currency"><Select value={profileDraft.currency} onChange={(event) => setProfileDraft((old) => ({ ...old, currency: event.target.value }))}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</Select></Field></div>
          <div className="field-grid"><Field label="Take-home salary"><TextInput type="number" min="0" value={profileDraft.salary} onChange={(event) => setProfileDraft((old) => ({ ...old, salary: event.target.value }))} /></Field><Field label="Payday (day of month)"><TextInput type="number" min="1" max="31" value={profileDraft.paydayDay} onChange={(event) => setProfileDraft((old) => ({ ...old, paydayDay: event.target.value }))} /></Field></div>
          <Field label="Primary goal"><Select value={profileDraft.primaryGoal} onChange={(event) => setProfileDraft((old) => ({ ...old, primaryGoal: event.target.value as Goal }))}>{goals.map((goal) => <option key={goal.value} value={goal.value}>{goal.label}</option>)}</Select></Field>
          <p className="eyebrow mt-4">FIXED EXPENSE ESTIMATES</p><div className="expense-grid">{CATEGORIES.map((category) => <Field key={category} label={CATEGORY_LABELS[category]}><TextInput type="number" min="0" value={profileDraft.fixedExpenses[category]} onChange={(event) => setProfileDraft((old) => ({ ...old, fixedExpenses: { ...old.fixedExpenses, [category]: event.target.value } }))} /></Field>)}</div>
          <div className="field-grid"><Field label="Variable spending estimate"><TextInput type="number" min="0" value={profileDraft.variableEstimate} onChange={(event) => setProfileDraft((old) => ({ ...old, variableEstimate: event.target.value }))} /></Field><Field label="Savings balance"><TextInput type="number" min="0" value={profileDraft.currentSavings} onChange={(event) => setProfileDraft((old) => ({ ...old, currentSavings: event.target.value }))} /></Field></div>
          <Button variant="primary" type="submit">Save profile</Button>
        </form>
      </Card>
      <Card title="Debt list" eyebrow={`${debts.length} BALANCE${debts.length === 1 ? '' : 'S'}`}>
        <div className="editable-debt-list">{debts.map((debt) => <article key={debt.id} className="editable-debt"><div className="editable-debt-head"><TextInput aria-label="Debt name" value={debt.name} onChange={(event) => void updateDebt(debt, 'name', event.target.value)} /><button className="icon-button danger-text" aria-label={`Delete ${debt.name}`} onClick={() => void remove('debts', debt.id)}><Trash2 size={14} /></button></div><div className="field-grid"><Field label="Balance"><TextInput type="number" min="0" value={debt.balance} onChange={(event) => void updateDebt(debt, 'balance', event.target.value)} /></Field><Field label="Interest (%)"><TextInput type="number" min="0" value={debt.interestRate} onChange={(event) => void updateDebt(debt, 'interestRate', event.target.value)} /></Field><Field label="Minimum payment"><TextInput type="number" min="0" value={debt.minimumPayment} onChange={(event) => void updateDebt(debt, 'minimumPayment', event.target.value)} /></Field></div></article>)}</div>
        <form className="add-debt-form" onSubmit={(event) => void addDebt(event)}><p className="eyebrow">ADD A DEBT</p><Field label="Name"><TextInput required value={debtDraft.name} onChange={(event) => setDebtDraft((old) => ({ ...old, name: event.target.value }))} /></Field><div className="field-grid"><Field label="Balance"><TextInput type="number" min="0" required value={debtDraft.balance} onChange={(event) => setDebtDraft((old) => ({ ...old, balance: event.target.value }))} /></Field><Field label="Rate (%)"><TextInput type="number" min="0" value={debtDraft.interestRate} onChange={(event) => setDebtDraft((old) => ({ ...old, interestRate: event.target.value }))} /></Field><Field label="Minimum"><TextInput type="number" min="0" value={debtDraft.minimumPayment} onChange={(event) => setDebtDraft((old) => ({ ...old, minimumPayment: event.target.value }))} /></Field></div><Button type="submit"><Upload size={14} /> Add debt</Button></form>
      </Card>
    </div>
    <div className="settings-grid mt-5">
      <Card title="JSON backup & import" eyebrow="OFFLINE FALLBACK">
        <p className="muted-copy">Download a portable copy of your records or import one from this app or FlowTrack. Imports update matching records and keep local records absent from the file.</p>
        <div className="backup-buttons"><Button onClick={() => void exportData()}><Download size={14} /> Export JSON</Button><label className="button button-secondary file-button"><Upload size={14} /> Import JSON<input type="file" accept=".json,application/json" onChange={(event) => void handleImport(event)} /></label><label className="button button-secondary file-button"><Upload size={14} /> Import legacy JSON<input type="file" accept=".json,application/json" onChange={(event) => void handleImport(event)} /></label></div>
        <div className="size-indicator"><FileJson size={15} /><span>Current local data: {sizeMb} MB</span></div>
        {localSize > 5 * 1024 * 1024 && <Notice tone="warning">This data is over 5 MB. Sync will still be attempted, but network transfers may take longer.</Notice>}
        {dataMessage && <p className="success-text" role="status">{dataMessage}</p>}{dataError && <Notice tone="warning">{dataError}</Notice>}
        {legacyPresent.includes('flowtrack_pro_v1') && <div className="legacy-migration"><strong>Older FlowTrack data found in this browser.</strong><p>Choose whether to move it into Salary Reset. A local recovery copy is saved before any source key is removed.</p><Button onClick={() => void optInLegacyMigration()}>Review and migrate old data</Button></div>}
        <div className="recovery-list">{recoveries.slice(-3).reverse().map((item) => <div key={item.id}><small>{item.name}</small><span>{new Date(item.createdAt).toLocaleString()}</span></div>)}</div>
      </Card>
      <Card title="Drive snapshots" eyebrow="ROLLING BACKUPS" action={auth.status === 'signed-in' && <Button onClick={() => void loadSnapshots()} disabled={snapshotBusy}><RefreshCw size={14} /> Refresh</Button>}>
        {auth.status !== 'signed-in' ? <p className="muted-copy">Connect Google Drive in this session to list, download, or restore snapshots.</p> : snapshotBusy ? <p className="muted-copy">Loading your snapshots…</p> : snapshots.length ? <div className="snapshot-list">{snapshots.map((file) => <div key={file.id} className="snapshot-row"><div><strong>{file.name}</strong><small>{file.size ? `${(file.size / 1024).toFixed(1)} KB` : ''} {file.modifiedTime ? `· ${new Date(file.modifiedTime).toLocaleString()}` : ''}</small></div><div className="snapshot-actions"><Button onClick={() => void downloadSnapshot(file)} aria-label={`Download ${file.name}`}><Download size={14} /></Button><Button onClick={() => void previewSnapshot(file)}>Restore</Button></div></div>)}</div> : <p className="muted-copy">No snapshots yet. A snapshot is created after a successful sync, at most once every 30 minutes.</p>}
        {snapshotError && <Notice tone="warning">{snapshotError}</Notice>}
        {preview && <div className="restore-preview"><div><strong>Restore {preview.name}?</strong><p>{preview.added} new record{preview.added === 1 ? '' : 's'} and {preview.replaced} matching record{preview.replaced === 1 ? '' : 's'} will be refreshed. Records missing from the snapshot remain on this device.</p><small>A local safety snapshot will be saved first. The restored records receive fresh timestamps and enter the sync queue.</small></div><div className="restore-actions"><Button onClick={() => setPreview(null)}>Cancel</Button><Button variant="primary" onClick={() => void confirmRestore()}>Confirm restore</Button></div></div>}
      </Card>
    </div>
    <Card title="Conflict review" eyebrow={`${conflicts.length} MERGE DECISION${conflicts.length === 1 ? '' : 'S'}`} className="mt-5" id="conflicts">
      {conflicts.length ? <div className="conflict-list">{conflicts.map((entry) => <details key={entry.id} className="conflict-row"><summary><span><strong>{entry.summary}</strong><small>{entry.collection} · record {entry.recordId} · {new Date(Number(entry.detectedAt.slice(0, 16))).toLocaleString()}</small></span><span className="conflict-tag">Review</span></summary><div className="conflict-details"><p>Winning edit: {entry.winningDeviceId} at {entry.winningUpdatedAt}</p><p>Kept copy from the other edit ({entry.losingDeviceId}) is preserved below.</p><pre>{JSON.stringify(entry.losingRecord, null, 2)}</pre></div></details>)}</div> : <p className="muted-copy">No conflicting edits have been detected. If two devices change the same record offline, the later HLC timestamp wins and the other edit stays visible here.</p>}
    </Card>
    <Card title="Sync help and privacy" eyebrow="HOW THE MERGE WORKS" className="mt-5">
      <div className="help-grid"><div><KeyRound size={16} /><div><strong>Local first</strong><p>IndexedDB is the source of truth on this device. Tokens are held in memory only.</p></div></div><div><RefreshCw size={16} /><div><strong>Per-record last edit wins</strong><p>Each record has a hybrid logical clock. Conflicting records merge as a whole; fields are not combined. The losing version remains in Conflict review.</p></div></div><div><Cloud size={16} /><div><strong>Drive authorization constraint</strong><p>The required drive.file scope is requested. Google documents require drive.appdata to use appDataFolder; if Google rejects that location, the error is shown and local/JSON mode continues to work.</p></div></div></div>
      <p className="field-hint">First-time Google setup is in the README under “OAuth Carry-Over Checklist.” The app uses the existing OAuth client ID from VITE_GOOGLE_CLIENT_ID.</p>
    </Card>
    <div className="danger-zone mt-5"><div><p className="eyebrow">DANGER ZONE</p><h2>Delete or reset data</h2><p>These actions are separate. Resetting this device leaves Google Drive untouched. Deleting Drive data leaves this local copy untouched.</p></div>
      <div className="danger-action"><strong>Delete all Salary Reset files in Drive</strong><p>Type DELETE to confirm. Google Drive may refuse this action if the current scope cannot access appDataFolder.</p><div className="danger-confirm"><TextInput aria-label="Type DELETE to confirm Drive deletion" value={driveDeleteText} onChange={(event) => setDriveDeleteText(event.target.value)} placeholder="Type DELETE" /><Button variant="danger" disabled={driveDeleteText !== 'DELETE' || auth.status !== 'signed-in'} onClick={() => void deleteDrive()}><Trash2 size={14} /> Delete Drive data</Button></div></div>
      <div className="danger-action"><strong>Reset local data</strong><p>Creates a local safety copy, then returns this device to onboarding.</p><div className="danger-confirm"><TextInput aria-label="Type RESET to confirm local reset" value={localDeleteText} onChange={(event) => setLocalDeleteText(event.target.value)} placeholder="Type RESET" /><Button variant="danger" disabled={localDeleteText !== 'RESET'} onClick={() => void resetLocal()}><AlertTriangle size={14} /> Reset this device</Button></div></div>
    </div>
    <div className="form-footer"><span>{auth.status === 'signed-in' ? 'Google account is connected for this browser session.' : 'Local plan stays available while signed out.'}</span>{auth.status === 'signed-in' && <Button variant="quiet" onClick={() => void revoke()}>Revoke Google access</Button>}</div>
    <p className="disclaimer-inline mt-5">This app is for personal planning, not regulated financial advice.</p>
  </>;
}
