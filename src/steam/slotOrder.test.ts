import { describe, it, expect } from 'vitest';
import { orderMembers, assignSlots, peersForSlot } from './slotOrder.js';
import { makePlayerIdentity } from '../multiplayer/identity.js';

const id = (s: string, n = '') => makePlayerIdentity(s, n, 'steam');

describe('slotOrder', () => {
  it('puts the owner at slot 0 and everyone else ascending by id', () => {
    const members = [id('300'), id('100'), id('200')];
    const ordered = orderMembers(members, '200');
    expect(ordered.map((m) => m.id)).toEqual(['200', '100', '300']);
  });

  it('is deterministic regardless of input order (host & client agree)', () => {
    const a = [id('999'), id('111'), id('555')];
    const b = [id('555'), id('999'), id('111')];
    expect(assignSlots(a, '999')).toEqual(assignSlots(b, '999'));
  });

  it('dedupes repeated ids', () => {
    const ordered = orderMembers([id('1'), id('1'), id('2')], '1');
    expect(ordered.map((m) => m.id)).toEqual(['1', '2']);
  });

  it('assignSlots fills names and indices', () => {
    const out = assignSlots([id('10', 'Zoe'), id('20')], '10');
    expect(out).toEqual([
      { slot: 0, steamId: '10', name: 'Zoe' },
      { slot: 1, steamId: '20', name: 'Player 2' },
    ]);
  });

  it('peersForSlot excludes the local slot', () => {
    const asg = assignSlots([id('10'), id('20'), id('30')], '10');
    expect([...peersForSlot(asg, 1).entries()]).toEqual([
      [0, '10'],
      [2, '30'],
    ]);
  });
});
