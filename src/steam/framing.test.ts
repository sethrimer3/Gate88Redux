import { describe, it, expect } from 'vitest';
import { frame, unframe, STEAM_MSG } from './SteamTransport.js';
import { NET_PROTOCOL_VERSION } from '../net/protocol.js';

describe('SteamTransport wire framing', () => {
  it('round-trips a control message', () => {
    const bytes = frame(STEAM_MSG.control, { kind: 'match_start', payload: { seed: 42 } });
    expect(bytes[0]).toBe(STEAM_MSG.control);
    const out = unframe(bytes);
    expect(out).toEqual({ type: STEAM_MSG.control, obj: { kind: 'match_start', payload: { seed: 42 } } });
  });

  it('round-trips an input snapshot with the protocol version', () => {
    const input = {
      protocolVersion: NET_PROTOCOL_VERSION,
      seq: 7, clientTimeMs: 1234,
      dx: 1 as const, dy: 0 as const, aimX: 10, aimY: -5,
      firePrimary: true, fireSpecial: false, boost: false,
    };
    const out = unframe(frame(STEAM_MSG.input, input));
    expect(out?.type).toBe(STEAM_MSG.input);
    expect(out?.obj).toEqual(input);
  });

  it('returns null for a truncated / non-JSON body', () => {
    expect(unframe([])).toBeNull();
    expect(unframe([STEAM_MSG.snapshot, 0x7b, 0x7b, 0x7b])).toBeNull(); // "{{{"
  });

  it('preserves UTF-8 in player names', () => {
    const out = unframe(frame(STEAM_MSG.control, { kind: 'chat', payload: 'héllo 🚀 名前' }));
    expect((out?.obj as { payload: string }).payload).toBe('héllo 🚀 名前');
  });
});
