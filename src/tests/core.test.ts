import { describe, expect, it } from 'vitest';
import { compareHlc, nextHlc, observeHlc, type ClockState } from '../lib/hlc';
import { mergeRecords } from '../lib/merge';
import { FutureSchemaError, migrateRecords } from '../lib/migrations';
import { pruneSnapshots, snapshotName, type DriveAdapter } from '../lib/driveAdapter';
import { formatGoogleAuthError } from '../lib/googleAuth';
import type { RecordState, Syncable } from '../types';

const deviceA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const deviceB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const rec = (id: string, updatedAt: string, deviceId: string, payload: Record<string, unknown> = {}): Syncable => ({ id, updatedAt, deviceId, ...payload });
const project = (state: RecordState): RecordState => Object.fromEntries(Object.entries(state).map(([key, rows]) => [key, [...rows].sort((a, b) => a.id.localeCompare(b.id))]));

describe('hybrid logical clock', () => {
  it('is monotone through equal and skewed local time', () => {
    let state: ClockState = { lastPhysicalMs: 1000, lastCounter: 4 };
    const first = nextHlc(state, 900, deviceA); state = first.state;
    const second = nextHlc(state, 1000, deviceA); state = second.state;
    const third = nextHlc(state, 2000, deviceA);
    expect(compareHlc(first.value, second.value)).toBeLessThan(0);
    expect(compareHlc(second.value, third.value)).toBeLessThan(0);
    expect(third.state).toEqual({ lastPhysicalMs: 2000, lastCounter: 0 });
  });

  it('observes remote physical and counter values before creating the next stamp', () => {
    const remote = '0000000000003000-000005-remote-device';
    const observed = observeHlc({ lastPhysicalMs: 1000, lastCounter: 9 }, remote);
    const next = nextHlc(observed, 1000, deviceA);
    expect(compareHlc(next.value, remote)).toBeGreaterThan(0);
  });
});

describe('per-record merge', () => {
  it('is commutative, associative, and idempotent for the record join', () => {
    const cDevice = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const a: RecordState = { debts: [rec('same', '0000000000000010-000001-a', deviceA, { balance: 40 }), rec('left', '0000000000000011-000000-a', deviceA, { balance: 10 }), rec('same-payload', '0000000000000010-000000-a', deviceA, { note: 'same' })] };
    const b: RecordState = { debts: [rec('same', '0000000000000012-000000-b', deviceB, { balance: 35 }), rec('middle', '0000000000000013-000000-b', deviceB, { balance: 20 }), rec('same-payload', '0000000000000012-000000-b', deviceB, { note: 'same' })] };
    const c: RecordState = { debts: [rec('same', '0000000000000014-000000-c', cDevice, { balance: 30 }), rec('right', '0000000000000015-000000-c', cDevice, { balance: 30 }), rec('same-payload', '0000000000000014-000000-c', cDevice, { note: 'changed' })] };
    const ab = mergeRecords(a, b).records;
    expect(project(ab)).toEqual(project(mergeRecords(b, a).records));
    expect(project(mergeRecords(ab, c).records)).toEqual(project(mergeRecords(a, mergeRecords(b, c).records).records));
    expect(project(ab)).toEqual(project(mergeRecords(ab, ab).records));
  });

  it('keeps later tombstones and does not resurrect them from an older edit', () => {
    const tombstone = rec('debt-1', '0000000000000020-000000-a', deviceA, { deleted: true, deletedAt: '0000000000000020-000000-a' });
    const edit = rec('debt-1', '0000000000000019-000009-b', deviceB, { balance: 1 });
    expect(mergeRecords({ debts: [tombstone] }, { debts: [edit] }).records.debts?.[0]?.deleted).toBe(true);
  });

  it('uses device id to break exact timestamp ties deterministically', () => {
    const a = rec('item', '0000000000000020-000000-same', deviceA, { note: 'A' });
    const b = rec('item', '0000000000000020-000000-same', deviceB, { note: 'B' });
    expect(mergeRecords({ list: [a] }, { list: [b] }).records.list?.[0]?.note).toBe('B');
  });

  it('records the losing edit with the conflict decision', () => {
    const a = rec('item', '0000000000000020-000000-a', deviceA, { name: 'Old' });
    const b = rec('item', '0000000000000021-000000-b', deviceB, { name: 'New' });
    const result = mergeRecords({ debts: [a] }, { debts: [b] });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.losingRecord.name).toBe('Old');
    expect(result.records.conflictLog).toHaveLength(1);
  });
});

describe('schema migrations and snapshots', () => {
  it('runs each migration from v1 through v3', () => {
    const initial: RecordState = { profile: [rec('profile', 'x', 'd', { salary: 100 })] };
    expect(migrateRecords(initial, 1, 2)).toHaveProperty('settings');
    const migrated = migrateRecords(initial, 1, 3);
    expect(migrated).toHaveProperty('conflictLog');
    expect(migrated).toHaveProperty('savingsChecklist');
    expect(migrated.profile?.[0]?.salary).toBe(100);
  });

  it('refuses to downgrade an unknown future schema', () => {
    expect(() => migrateRecords({}, 4, 3)).toThrow(FutureSchemaError);
  });

  it('creates unique timestamped snapshot names and prunes to the newest ten', async () => {
    const date = new Date(2024, 0, 2, 3, 4);
    expect(snapshotName(date)).toBe('backup-2024-01-02-0304.json');
    expect(snapshotName(date, ['backup-2024-01-02-0304.json'])).toBe('backup-2024-01-02-0304-02.json');
    const deleted: string[] = [];
    const adapter = {
      listSnapshots: async () => Array.from({ length: 12 }, (_, index) => ({ id: `id-${index}`, name: `backup-${index}.json`, modifiedTime: new Date(2025, 0, 12 - index).toISOString() })),
      deleteFile: async (_token: string, id: string) => { deleted.push(id); },
    } as unknown as DriveAdapter;
    await pruneSnapshots(adapter, 'token', 10);
    expect(deleted).toEqual(['id-10', 'id-11']);
  });
});

describe('Google OAuth origin guidance', () => {
  it('names the exact origin in an actionable unauthorized-origin message', () => {
    const message = formatGoogleAuthError({ error: 'unauthorized_client', error_description: 'origin_mismatch' }, 'https://salary.example');
    expect(message).toContain('Add this origin to the existing OAuth client');
    expect(message).toContain('https://salary.example');
  });
});
