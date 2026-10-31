# Salary Reset

Salary Reset is a private, offline-first financial recovery coach for someone who earns a salary and wants a practical way to rebuild savings. It uses calm prompts, editable estimates, local storage, and an optional Google Drive sync layer. The signed-out app is fully usable after its first load.

> This app is for personal planning, not regulated financial advice.

## 1. Overview & product tour

- **Onboarding** captures take-home pay, payday, currency, fixed costs, variable spending, savings, debts, and the user's primary goal. Every field can be edited later.
- **Overview** shows net worth, planned savings rate, emergency-fund months, total debt, budget versus actual, 90-day progress, next steps, and Recharts visuals. Assets can be added from the dashboard.
- **Money audit** records manual spending for the latest three months, compares fixed and variable costs, ranks up to three possible leaks, and lets the user mark a suggestion fixed or ignore it.
- **Budget builder** supports a 50/30/20 starting point or custom percentages, variable envelopes, a payday transfer, and an income-fit warning.
- **Savings plan** stages the emergency fund at one, three, and six months of expenses and includes a payday transfer and setup checklist.
- **Debt planner** compares avalanche and snowball orders, estimates months and interest, graphs the projected balance, and logs payments.
- **90-day reset** provides thirteen weekly tasks with not started, done, and skipped states.
- **Monthly review** stores actual income, spending, savings transfers, debt paid, reflections, history, and trends.
- **Settings & sync** edits the profile and debts, connects or revokes Google access, manages Drive snapshots and conflicts, imports or exports JSON, and resets local data.

The rule-based coach runs locally from saved data. It does not call an external AI service.

## 2. OAuth Carry-Over Checklist

Do these ONCE in Google Cloud Console, in the EXISTING project — not a new one:
1. APIs & Services → Credentials → select the EXISTING OAuth 2.0 Client ID (type: Web application).
2. Authorized JavaScript origins: ADD the new app’s dev origin (http://localhost:5173) and production origin (https://your-domain). KEEP existing origins. Do not remove.
3. If a redirect URI was used previously for GIS popup (usually not required for token flow), keep it; do not change the client type.
4. APIs & Services → Library → confirm Google Drive API is enabled (enable if missing).
5. OAuth consent screen: confirm `https://www.googleapis.com/auth/drive.file` is listed. If it was already approved in the prior app, do NOT add new scopes; verification carries over. If it was not present, expect a verification review.
6. Copy the Client ID → put into `.env` as VITE_GOOGLE_CLIENT_ID. Do not copy any secret (there is none for public SPA).
7. Deploy. Sign in with a test user. Confirm token issuance and Drive appDataFolder file creation. Existing users who already granted consent will not be re-prompted for the same scope.

The client ID is loaded only from `VITE_GOOGLE_CLIENT_ID` at build time. `.env.example` contains that key and no other setting. The provided FlowTrack source contains the existing public client ID; this rebuild's local ignored `.env.local` uses that value. No client secret is used or bundled. GIS requests exactly `https://www.googleapis.com/auth/drive.file`.

### Authorization limitation to resolve before enabling Drive sync

Google's Drive API documentation says `appDataFolder` access requires the `https://www.googleapis.com/auth/drive.appdata` scope. `drive.file` is documented for files created by or explicitly opened/shared with the app. These two user requirements cannot both authorize the specified `appDataFolder` backend. This build keeps your mandatory `drive.file`-only scope and tries the required `appDataFolder` location; Google may reject those requests with an actionable Settings error. Local use and JSON backup work in either case. The production sync acceptance criterion cannot be met until the scope/location constraint is resolved by the project owner. See Google's [appDataFolder guide](https://developers.google.com/workspace/drive/api/guides/appdata) and [Drive scope guide](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

An unauthorized JavaScript origin produces an inline error with the exact current origin, for example: `Add this origin to the existing OAuth client in Google Cloud Console: http://localhost:5173`. Add only the new origin to the existing OAuth client and retain every origin already present.

## 3. Architecture

```text
React screens
    │ mutations (HLC timestamp, stable ID)
    ▼
IndexedDB (source of truth per device) ── derived outbox / pending count
    │ sign-in · focus · online · ~60s · debounce · manual sync
    ▼
Sync engine: read → validate/migrate → per-record merge → local union → conditional write
    │                                                     │
    ├── conflict log (losing record retained)              └── HLC observation
    ▼
Google Drive appDataFolder: sync-state.json + rolling read-only snapshots
```

The PWA precaches the app shell and compiled assets. Financial records live in IndexedDB. Google tokens remain in module memory and are not written to localStorage, IndexedDB, URLs, or logs. A small dismissal preference is stored in localStorage.

### Project file tree

```text
salary-reset/
├── .env.example
├── .gitignore
├── index.html
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── postcss.config.js
├── public/
│   └── favicon.svg
├── README.md
├── src/
│   ├── components/
│   │   ├── AppLayout.tsx
│   │   └── Shared.tsx
│   ├── context/
│   │   └── AppProvider.tsx
│   ├── index.css
│   ├── lib/
│   │   ├── backup.ts
│   │   ├── coach.ts
│   │   ├── db.ts
│   │   ├── driveAdapter.ts
│   │   ├── googleAuth.ts
│   │   ├── hlc.ts
│   │   ├── legacyMigration.ts
│   │   ├── merge.ts
│   │   ├── migrations.ts
│   │   ├── plan.ts
│   │   ├── selectors.ts
│   │   └── syncEngine.ts
│   ├── main.tsx
│   ├── pages/
│   │   ├── BudgetBuilder.tsx
│   │   ├── Dashboard.tsx
│   │   ├── DebtPlanner.tsx
│   │   ├── MoneyAudit.tsx
│   │   ├── MonthlyReview.tsx
│   │   ├── Onboarding.tsx
│   │   ├── ResetPlan.tsx
│   │   ├── SavingsPlan.tsx
│   │   └── Settings.tsx
│   ├── tests/
│   │   ├── core.test.ts
│   │   ├── setup.ts
│   │   └── sync.integration.test.ts
│   └── types.ts
├── tailwind.config.js
├── tsconfig.app.json
├── tsconfig.json
└── vite.config.js
```

## 4. Data model & HLC

Each syncable record has `id`, `updatedAt`, `deviceId`, and optional `deleted` / `deletedAt` tombstone fields. Profile, budget, and settings use the fixed IDs `profile`, `budget`, and `settings`. Other records use stable generated IDs. The IndexedDB metadata table keeps the per-device ID, HLC state, last remote ETag/revision, last pushed HLC, last sync time, pending flag, and last error.

The HLC timestamp format is:

```text
<16-digit physical milliseconds>-<6-digit counter>-<device UUID>
```

When the local clock moves backwards or ties the previous physical value, the counter increases. After a pull, the local clock observes the largest remote physical/counter values before creating another stamp. Record updates and deletes get a new timestamp; deletes remain as tombstones.

## 5. Merge & conflict policy

For each collection and record ID, merge keeps the greater `updatedAt`. Equal timestamps use the greater `deviceId`, then a stable payload comparison for malformed duplicate imports. Collections are unioned; no record is physically removed by normal sync. A winning tombstone stays in the remote union.

This is **per-record last-write-wins**, not field-level merging. If two devices change different fields on the same record, the later whole record wins. Each differing losing payload is kept in the synced Conflict Log with both timestamps and device IDs. Users can inspect the losing values in Settings. This policy is deterministic and lets offline devices converge, but it cannot combine two edits to separate fields.

## 6. Sync protocol (If-Match / revision guard)

The engine is triggered by sign-in, focus, `online`, a foreground timer about every 60 seconds, a debounced local edit, or Sync now. It pulls Drive metadata and JSON, validates and migrates schema, unions records locally, then writes only if the remote representation differs. A stale ETag / HTTP 412 causes another read and merge, bounded retries with exponential backoff, and jitter. HTTP 401 refreshes the in-memory GIS token once. Network / server / quota errors leave the outbox dirty.

The Drive file envelope includes `revision`; the update request also records the expected and next revision in private `appProperties`. The Drive API does not expose an atomic compare-and-set for arbitrary app properties, so the actual lost-update guard is the `If-Match` ETag precondition. A missing ETag fails safely rather than issuing an unconditional overwrite. The application revision is a secondary consistency check in the payload and fake adapter; it is not a server-enforced precondition. If Google Drive does not honor conditional updates for the deployed file, a backend or a Drive-supported conditional-write primitive would be needed for a strict multi-writer guarantee.

The first successful sync and any sync at least 30 minutes after the previous snapshot create a timestamped `backup-YYYY-MM-DD-HHmm.json` snapshot. The latest ten are kept. Snapshot restores save a local safety copy first and re-stamp restored records, while preserving local records absent from the snapshot.

## 7. Privacy

- **On this device:** profile, budgets, debt, expense entries, reset plan, reviews, local conflict log, sync metadata, and corrupt-file recovery copies are in IndexedDB.
- **In Drive when authorized:** one merged `sync-state.json` and up to ten rolling snapshots, all in the app's `appDataFolder` per the requested design.
- **OAuth:** the SPA uses Google Identity Services token model, requests only `drive.file`, and holds access tokens in memory only. Sign out clears the token but keeps finance records. Revoke asks Google to revoke the in-memory access token.
- **No backend:** there is no app server and no finance data is sent to a third-party service by the rule-based coach.

The app warns when the local serialized state exceeds 5 MB but still attempts sync. JSON exports contain personal financial information; store them somewhere private.

## 8. Migration notes

Schema migrations run forward in order (currently v1 → v2 → v3). A future schema is rejected with “This backup was created by a newer version. Please update.” It is never downgraded. Invalid remote JSON is saved as a local `recovery-*.json` copy; the app warns and leaves local data intact. Settings can list local recovery copies and offer Drive snapshot restore.

If the legacy key `flowtrack_pro_v1` is found, Settings offers an explicit migration. A raw safety copy is stored before conversion. The app writes converted FlowTrack expense entries, wallet balances, and savings to IndexedDB, commits the migration marker, and only then removes legacy keys. A crash before the marker leaves source keys intact; a completed marker prevents duplicate imports. Manual Import JSON also recognizes the legacy FlowTrack shape. Old Google profile data is not used for OAuth and no legacy token is imported.

## 9. Troubleshooting

- **Unauthorized origin:** read the exact origin in the inline sign-in error. Add that origin to the existing OAuth Web client and keep all current origins. Do not create another credential or consent screen.
- **`appDataFolder` 403:** Google requires `drive.appdata` for this folder, which conflicts with the requested `drive.file`-only scope. The app will not add another scope automatically. Continue locally or use JSON until the project owner resolves the constraint.
- **Popup blocked:** allow popups for the app's origin and retry Google sign-in.
- **Consent denied / access revoked:** local use remains available. Sign in again to grant the same requested scope or choose Revoke Google access in Settings.
- **No ETag returned:** sync stops before overwrite because conditional concurrency safety cannot be established. Export JSON before troubleshooting.
- **412 concurrent update:** the app rereads and merges before retrying. Your local data remains in IndexedDB if retries are exhausted.
- **Corrupt `sync-state.json`:** the raw remote bytes are saved locally and no local records are cleared. Restore a recent Drive snapshot from Settings if available.
- **Drive file deleted:** the next successful listing is treated as no remote file; local data can create a replacement. Local records are never cleared because a remote file is missing.
- **Large payload / quota:** state remains queued; the next online, foreground, or manual sync retries. Export JSON as a second backup.
- **Local browser data:** private browsing / clearing site storage removes IndexedDB. Export JSON or connect Drive after the authorization constraint is resolved.

## 10. Run instructions

Requirements: Node.js 20+ and pnpm (npm works with the same package manifest).

```bash
cp .env.example .env
# Set the existing OAuth client ID in .env, if Google sign-in is needed.
pnpm install
pnpm dev
```

Vite serves at `http://localhost:5173`. Add that exact origin to the existing OAuth client before trying Google sign-in. The app works without a client ID when used locally; sign-in will explain the missing variable.

```bash
pnpm build
pnpm preview
pnpm test
```

Do not open the HTML files directly with `file://`: browsers block the app’s ES modules in that mode. Double-click `Open Salary Reset.cmd` to start a local preview at `http://localhost:5173`, or run the command below. Google sign-in requires the existing OAuth client to authorize that localhost origin.

```bash
pnpm exec vite preview --configLoader runner --host 127.0.0.1 --port 5173 --strictPort
```

When the preview server is running, open `http://localhost:5173` in your browser. The server window can be closed to stop it.

For production, set `VITE_GOOGLE_CLIENT_ID` in the build environment. Add the production origin (for example `https://your-domain`) to the same OAuth client. Deploy the `dist/` directory to a static host that supports SPA history fallback to `index.html` and serves over HTTPS.

### GitHub Pages deployment

This repository includes `.github/workflows/deploy.yml`. Push to `main` (or run the workflow manually) to install dependencies, run tests, build, and publish `dist/` through GitHub Pages Actions. If the repository uses another default branch, update the workflow's push branch filter.

1. In the repository, open **Settings → Pages** and set the build/deployment source to **GitHub Actions**.
2. Open **Settings → Secrets and variables → Actions → Variables** and add `VITE_GOOGLE_CLIENT_ID` with the existing public OAuth client ID. It is a public identifier, not a client secret. The workflow still builds without it, but Google sign-in will report that it is missing.
3. Push to `main`, then open the deployed URL shown by the Pages workflow. Project Pages uses `https://<owner>.github.io/<repository>/`; add the origin `https://<owner>.github.io` (origin only, no repository path) to **Authorized JavaScript origins** on the existing OAuth client. Keep all current origins. If using a custom domain, add its HTTPS origin instead.
4. The Pages build uses hash routes so screen refreshes work under the repository subpath. Asset paths are relative. OAuth continues to use only the configured `drive.file` scope; the `appDataFolder` authorization limitation above still applies.

## 11. Tests

Run `pnpm test`. Unit coverage includes HLC monotonicity and remote clock observation, merge commutativity / associativity / idempotency, tombstones, deterministic tie-breaking, conflict-log generation, each migration step, future-schema refusal, snapshot names / pruning, and actionable OAuth origin text. Fake Drive integration tests cover:

- **A:** two offline devices create distinct records and converge.
- **B:** competing same-record edits choose the later HLC and preserve the loser.
- **C:** a simulated concurrent write produces 412, remerges, and retains the racing edit.
- **D:** a later tombstone beats an older offline edit.
- **E:** a backlog of offline changes uploads in one sign-in sync.
- **F:** corrupt remote bytes are recovered locally without local data loss.
- **G:** unauthorized origin guidance includes the exact origin and does not retry-loop.

## Manual QA checklist

1. Complete onboarding, reload, and verify profile, debts, tasks, and savings checklist persist.
2. Add an asset, several audits across three months, and a monthly review; verify totals, charts, categories, and suggestions.
3. Mark a leak fixed, reload, and verify the decision remains.
4. Change a plan task to done, skipped, and not started. Verify progress updates.
5. Export JSON, reset a separate browser profile, import the file, and compare the record count.
6. Use browser DevTools Network → Offline. Create and edit records, verify “Offline · N queued,” then go Online and verify the queue drains when signed in.
7. Open two tabs in one browser. Edit separate records in both, then verify both survive after focus/online sync.
8. Use two separate browser profiles/devices. Make distinct edits while both are offline, sync device A then B then A, and compare both states.
9. In two profiles, edit the same record offline with different values. Sync both, then inspect Conflict review for the loser.
10. Simulate a stale remote ETag with the fake adapter test suite; verify 412 causes reread and merge.
11. Corrupt the remote test payload and confirm the recovery copy and local data remain.
12. Try an unauthorized origin and verify the exact origin is shown once with the Cloud Console action.
13. Confirm browser localStorage contains no OAuth token and IndexedDB still works after sign out.
14. Test on a narrow mobile viewport, keyboard navigation, visible focus, and screen-reader announcement of sync status.

## 12. Limitations / roadmap

- The required `drive.file` scope does not authorize the specified `appDataFolder` according to Google's Drive guide; Drive sync needs this owner-level constraint resolved.
- Strict distributed compare-and-set relies on Drive returning a strong ETag and honoring `If-Match`. The file's JSON revision is not a server-side CAS primitive.
- Current conflict resolution is per-record LWW. Field-level CRDTs, richer conflict tools, and optional end-to-end encryption via WebCrypto are future work.
- Snapshot file listing, restore, and Drive deletion share the same appDataFolder scope limitation.
