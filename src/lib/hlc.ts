export type ClockState = { lastPhysicalMs: number; lastCounter: number };
export type HlcStamp = { value: string; state: ClockState };

export function nextHlc(previous: ClockState, now: number, deviceId: string): HlcStamp {
  const physical = now > previous.lastPhysicalMs ? now : previous.lastPhysicalMs;
  const counter = now > previous.lastPhysicalMs ? 0 : previous.lastCounter + 1;
  return {
    value: `${String(physical).padStart(16, '0')}-${String(counter).padStart(6, '0')}-${deviceId}`,
    state: { lastPhysicalMs: physical, lastCounter: counter },
  };
}

export function physicalMsFromHlc(value?: string): number {
  if (!value) return 0;
  const parsed = Number(value.slice(0, 16));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function observeHlc(state: ClockState, remote: string): ClockState {
  const physical = physicalMsFromHlc(remote);
  const remoteCounter = Number(remote.split('-')[1] ?? 0);
  if (physical > state.lastPhysicalMs) return { lastPhysicalMs: physical, lastCounter: Number.isFinite(remoteCounter) ? remoteCounter : 0 };
  if (physical === state.lastPhysicalMs && remoteCounter > state.lastCounter) return { lastPhysicalMs: physical, lastCounter: remoteCounter };
  return state;
}

export function compareHlc(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

export function maxHlc(values: string[]): string { return values.reduce((max, value) => value > max ? value : max, ''); }
