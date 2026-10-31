import type { DriveFileMeta, Envelope, RecordState } from '../types';

const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

export class DriveHttpError extends Error {
  constructor(public status: number, message: string, public responseText = '') { super(message); this.name = 'DriveHttpError'; }
}
export class CorruptRemoteError extends Error {
  constructor(public raw: string) { super('Drive sync-state.json is not valid JSON. A recovery copy will be saved locally; restore a recent snapshot from Settings.'); this.name = 'CorruptRemoteError'; }
}

export type RemoteState = { file: DriveFileMeta; envelope: Envelope; raw: string };
export type WriteCondition = { fileId?: string; etag?: string; expectedRevision: number };

async function request(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    let message = `Google Drive returned ${response.status}.`;
    if (response.status === 401) message = 'Google access expired. Refreshing the sign-in token.';
    if (response.status === 403 && /appDataFolder|appdata|insufficient|scope/i.test(body)) message = 'Google Drive denied appDataFolder access. Google requires the drive.appdata scope for this folder, but this app is restricted to drive.file. Local mode remains available.';
    if (response.status === 403 && /rate|quota/i.test(body)) message = 'Google Drive is rate-limiting sync. Changes remain queued and will retry.';
    if (response.status === 412) message = 'The remote file changed on another device. Re-reading before retry.';
    throw new DriveHttpError(response.status, message, body);
  }
  return response;
}

function fileQuery(name?: string, pageToken?: string): string {
  const query = new URLSearchParams({ spaces: 'appDataFolder', pageSize: '100', fields: 'nextPageToken,files(id,name,size,modifiedTime,headRevisionId,version)' });
  if (name) query.set('q', `name = '${name.replaceAll("'", "\\'")}' and trashed = false`);
  if (pageToken) query.set('pageToken', pageToken);
  return `${API}?${query.toString()}`;
}

async function listFiles(token: string, name?: string): Promise<DriveFileMeta[]> {
  const files: DriveFileMeta[] = [];
  let pageToken: string | undefined;
  do {
    const response = await request(fileQuery(name, pageToken), token);
    const json = await response.json() as { files?: Array<Record<string, unknown>>; nextPageToken?: string };
    files.push(...(json.files ?? []).map((file) => ({ id: String(file.id), name: String(file.name), size: Number(file.size ?? 0), modifiedTime: String(file.modifiedTime ?? ''), revision: Number(file.version ?? 0) })));
    pageToken = json.nextPageToken;
  } while (pageToken);
  return files;
}

function multipart(metadata: unknown, content: string): { body: string; contentType: string } {
  const boundary = `salary_reset_${crypto.randomUUID?.() ?? Date.now()}`;
  return { contentType: `multipart/related; boundary=${boundary}`, body: `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--` };
}

export interface DriveAdapter {
  getState(token: string): Promise<RemoteState | null>;
  writeState(token: string, envelope: Envelope, condition: WriteCondition): Promise<{ fileId: string; etag?: string; revision: number }>;
  listSnapshots(token: string): Promise<DriveFileMeta[]>;
  downloadFile(token: string, fileId: string): Promise<string>;
  createSnapshot(token: string, name: string, records: RecordState): Promise<DriveFileMeta>;
  deleteFile(token: string, fileId: string): Promise<void>;
  deleteAllAppData(token: string): Promise<void>;
}

export const driveAdapter: DriveAdapter = {
  async getState(token) {
    const files = await listFiles(token, 'sync-state.json');
    const file = files[0];
    if (!file) return null;
    try {
      const metadataResponse = await request(`${API}/${encodeURIComponent(file.id)}?fields=id,name,size,modifiedTime,headRevisionId,version`, token);
      const metadata = await metadataResponse.json() as Record<string, unknown>;
      const mediaResponse = await request(`${API}/${encodeURIComponent(file.id)}?alt=media`, token);
      const raw = await mediaResponse.text();
      let envelope: Envelope;
      try { envelope = JSON.parse(raw) as Envelope; } catch { throw new CorruptRemoteError(raw); }
      return { file: { ...file, etag: metadataResponse.headers.get('etag') ?? undefined, revision: Number(envelope.revision ?? metadata.version ?? 0) }, envelope, raw };
    } catch (error) {
      if (error instanceof DriveHttpError && error.status === 404) return null;
      throw error;
    }
  },
  async writeState(token, envelope, condition) {
    const metadata = { name: 'sync-state.json', mimeType: 'application/json', ...(condition.fileId ? {} : { parents: ['appDataFolder'] }), appProperties: { salaryResetRevision: String(envelope.revision), expectedRevision: String(condition.expectedRevision) } };
    const upload = multipart(metadata, JSON.stringify(envelope));
    const headers = new Headers({ 'Content-Type': upload.contentType });
    if (condition.fileId) {
      if (!condition.etag) throw new DriveHttpError(0, 'Google Drive did not expose a strong ETag for sync-state.json. The app cannot safely overwrite it. Export a JSON backup and try again later.');
      headers.set('If-Match', condition.etag);
    } else headers.set('If-None-Match', '*');
    const url = condition.fileId ? `${UPLOAD}/${encodeURIComponent(condition.fileId)}?uploadType=multipart&fields=id,name,version` : `${UPLOAD}?uploadType=multipart&fields=id,name,version`;
    const response = await request(url, token, { method: condition.fileId ? 'PATCH' : 'POST', headers, body: upload.body });
    const result = await response.json() as { id: string; version?: number };
    return { fileId: result.id, etag: response.headers.get('etag') ?? undefined, revision: envelope.revision };
  },
  async listSnapshots(token) { return (await listFiles(token)).filter((file) => file.name.startsWith('backup-') && file.name.endsWith('.json')).sort((a, b) => (b.modifiedTime ?? '').localeCompare(a.modifiedTime ?? '')); },
  async downloadFile(token, fileId) { return request(`${API}/${encodeURIComponent(fileId)}?alt=media`, token).then((response) => response.text()); },
  async createSnapshot(token, name, records) {
    const envelope: Envelope = { schemaVersion: 3, appVersion: '1.0.0', lastMergedAt: new Date().toISOString(), generatedByDevice: 'snapshot', revision: 0, records };
    const upload = multipart({ name, mimeType: 'application/json', parents: ['appDataFolder'] }, JSON.stringify(envelope));
    const response = await request(`${UPLOAD}?uploadType=multipart&fields=id,name,size,modifiedTime`, token, { method: 'POST', headers: { 'Content-Type': upload.contentType, 'If-None-Match': '*' }, body: upload.body });
    const file = await response.json() as Record<string, unknown>;
    return { id: String(file.id), name: String(file.name), size: Number(file.size ?? 0), modifiedTime: String(file.modifiedTime ?? '') };
  },
  async deleteFile(token, fileId) { await request(`${API}/${encodeURIComponent(fileId)}`, token, { method: 'DELETE' }); },
  async deleteAllAppData(token) {
    const files = await listFiles(token);
    for (const file of files) await this.deleteFile(token, file.id);
  },
};

export function buildEnvelope(records: RecordState, revision: number, deviceId: string): Envelope {
  const stamps = Object.values(records).flat().map((record) => record.updatedAt);
  const lastMergedAt = stamps.sort().at(-1) ?? new Date(0).toISOString();
  return { schemaVersion: 3, appVersion: '1.0.0', lastMergedAt, generatedByDevice: deviceId, revision, records };
}

export function snapshotName(date = new Date(), existing: string[] = []): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const base = `backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  let name = `${base}.json`, suffix = 2;
  while (existing.includes(name)) name = `${base}-${String(suffix++).padStart(2, '0')}.json`;
  return name;
}

export async function pruneSnapshots(adapter: DriveAdapter, token: string, keep = 10): Promise<void> {
  const files = await adapter.listSnapshots(token);
  for (const file of files.slice(keep)) await adapter.deleteFile(token, file.id);
}
