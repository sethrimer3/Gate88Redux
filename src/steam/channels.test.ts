import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STEAM_REQ, STEAM_EVT, STEAM_NET_CHANNEL } from './ipc.js';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));

// Single source of truth used by the Electron main process.
const cjs = require(root + 'electron/steam/steamChannels.cjs') as {
  REQ: Record<string, string>;
  EVT: Record<string, string>;
  NET_CHANNEL: Record<string, number>;
};

describe('Steam IPC channel parity', () => {
  it('renderer mirror (ipc.ts) matches steamChannels.cjs REQ/EVT', () => {
    expect({ ...STEAM_REQ }).toEqual(cjs.REQ);
    expect({ ...STEAM_EVT }).toEqual(cjs.EVT);
    expect({ ...STEAM_NET_CHANNEL }).toEqual(cjs.NET_CHANNEL);
  });

  it('preload.cjs inlines the exact same channel strings', () => {
    const preload = readFileSync(root + 'electron/preload.cjs', 'utf8');
    for (const value of [...Object.values(cjs.REQ), ...Object.values(cjs.EVT)]) {
      expect(preload).toContain(`'${value}'`);
    }
  });
});
