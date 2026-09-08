import { describe, it, expect } from 'vitest';
import { makePlayerIdentity, samePlayer, displayName } from './identity.js';

describe('PlayerIdentity', () => {
  it('trims and clamps the display name, stringifies the id', () => {
    const p = makePlayerIdentity(76561198000000000n as unknown as string, '   Loooooooooooooooooong Name Over Thirty-Two Chars   ', 'steam');
    expect(p.id).toBe('76561198000000000');
    expect(p.name.length).toBeLessThanOrEqual(32);
    expect(p.name.startsWith('Loooo')).toBe(true);
    expect(p.kind).toBe('steam');
  });

  it('compares by id only, never by name', () => {
    const a = makePlayerIdentity('123', 'Alice', 'steam');
    const b = makePlayerIdentity('123', 'AliceRenamed', 'steam');
    const c = makePlayerIdentity('456', 'Alice', 'steam');
    expect(samePlayer(a, b)).toBe(true);
    expect(samePlayer(a, c)).toBe(false);
  });

  it('displayName falls back when the backend name is empty', () => {
    expect(displayName(makePlayerIdentity('1', '', 'steam'), 'Guest')).toBe('Guest');
    expect(displayName(makePlayerIdentity('1', 'Bob', 'steam'))).toBe('Bob');
  });
});
