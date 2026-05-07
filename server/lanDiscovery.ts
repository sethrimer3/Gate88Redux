import dgram from 'node:dgram';
import http from 'node:http';
import os from 'node:os';
import { buildLabel } from '../src/version.js';
import type { LobbyState } from '../src/lan/protocol.js';
import {
  DISCOVERY_PROTOCOL_VERSION,
  type LanDiscoveryAdvertisement,
  type LanDiscoveredLobby,
} from '../src/lan/protocol.js';

const UDP_PORT = parseInt(process.env.LAN_DISCOVERY_PORT ?? '47888', 10);
const HTTP_PORT = parseInt(process.env.LAN_DISCOVERY_HTTP_PORT ?? '8788', 10);
const BROADCAST_INTERVAL_MS = 2000;
const STALE_MS = 10000;

function isPrivateIPv4(ip: string): boolean {
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  const m = ip.match(/^172\.(\d+)\./);
  if (!m) return false;
  const n = Number(m[1]);
  return n >= 16 && n <= 31;
}

function sanitizeText(input: string, maxLen: number): string {
  return input.replace(/[^\x20-\x7E]/g, '').trim().slice(0, maxLen);
}

function getCandidateIps(): string[] {
  const out: string[] = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const addr of iface ?? []) {
      if (addr.family === 'IPv4' && !addr.internal && isPrivateIPv4(addr.address)) out.push(addr.address);
    }
  }
  return Array.from(new Set(out));
}

export function createLanDiscovery(opts: {
  lanPort: number;
  maxSlots: number;
  lobbyId: string;
  getLobby: () => LobbyState | null;
  isHostActive: () => boolean;
}) {
  const socket = dgram.createSocket('udp4');
  const discovered = new Map<string, LanDiscoveredLobby>();
  let timer: ReturnType<typeof setInterval> | null = null;

  function toAdvertisement(ip: string): LanDiscoveryAdvertisement {
    const lobby = opts.getLobby();
    const slots = lobby?.slots ?? [];
    const occupiedHumanSlots = slots.filter(s => s.type === 'human').length;
    const aiSlots = slots.filter(s => s.type === 'ai').length;
    const openSlots = slots.filter(s => s.type === 'open').length;
    return {
      type: 'gate88_lan_advertise',
      protocolVersion: DISCOVERY_PROTOCOL_VERSION,
      game: 'Gate88Redux',
      lobbyId: opts.lobbyId,
      hostName: sanitizeText(os.hostname() || 'Gate88 Host', 40),
      wsUrl: `ws://${ip}:${opts.lanPort}`,
      httpUrl: `http://${ip}:5173`,
      lanPort: opts.lanPort,
      maxSlots: opts.maxSlots,
      openSlots,
      occupiedHumanSlots,
      aiSlots,
      matchStarted: lobby?.matchStarted ?? false,
      build: buildLabel(),
      timestamp: Date.now(),
    };
  }

  function parseAdvert(raw: Buffer, remoteAddress: string): LanDiscoveredLobby | null {
    try {
      const parsed = JSON.parse(raw.toString('utf8')) as Partial<LanDiscoveryAdvertisement>;
      if (parsed.type !== 'gate88_lan_advertise' || parsed.game !== 'Gate88Redux') return null;
      if (parsed.protocolVersion !== DISCOVERY_PROTOCOL_VERSION) return null;
      if (typeof parsed.wsUrl !== 'string' || typeof parsed.lobbyId !== 'string') return null;
      const now = Date.now();
      return {
        type: 'gate88_lan_advertise',
        protocolVersion: DISCOVERY_PROTOCOL_VERSION,
        game: 'Gate88Redux',
        lobbyId: parsed.lobbyId,
        hostName: sanitizeText(parsed.hostName ?? 'Gate88 Host', 40),
        wsUrl: parsed.wsUrl,
        httpUrl: typeof parsed.httpUrl === 'string' ? parsed.httpUrl : '',
        lanPort: Number(parsed.lanPort) || opts.lanPort,
        maxSlots: Number(parsed.maxSlots) || opts.maxSlots,
        openSlots: Math.max(0, Number(parsed.openSlots) || 0),
        occupiedHumanSlots: Math.max(0, Number(parsed.occupiedHumanSlots) || 0),
        aiSlots: Math.max(0, Number(parsed.aiSlots) || 0),
        matchStarted: Boolean(parsed.matchStarted),
        build: sanitizeText(parsed.build ?? '', 32),
        timestamp: Number(parsed.timestamp) || now,
        sourceIp: remoteAddress,
        lastSeenAt: now,
        expiresAt: now + STALE_MS,
      };
    } catch {
      return null;
    }
  }

  function pruneStale(): void {
    const now = Date.now();
    for (const [key, value] of discovered) if (value.expiresAt <= now) discovered.delete(key);
  }

  socket.on('message', (buf, rinfo) => {
    const adv = parseAdvert(buf, rinfo.address);
    if (!adv) return;
    discovered.set(`${adv.lobbyId}@${adv.wsUrl}`, adv);
  });

  const httpServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
    pruneStale();
    if (req.url === '/lan/discovered') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ lobbies: Array.from(discovered.values()), timestamp: Date.now() }));
      return;
    }
    if (req.url === '/lan/self') {
      const ips = getCandidateIps();
      const selfAds = opts.isHostActive() ? ips.map(ip => toAdvertisement(ip)) : [];
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ advertisements: selfAds, timestamp: Date.now() }));
      return;
    }
    res.statusCode = 404;
    res.end('Not Found');
  });

  function start(): void {
    socket.bind(UDP_PORT, () => {
      socket.setBroadcast(true);
      console.log(`[Gate88 LAN Discovery] UDP listening on 0.0.0.0:${UDP_PORT}`);
    });
    httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
      console.log(`[Gate88 LAN Discovery] HTTP endpoint at http://localhost:${HTTP_PORT}/lan/discovered`);
    });
    timer = setInterval(() => {
      pruneStale();
      if (!opts.isHostActive()) return;
      const ips = getCandidateIps();
      for (const ip of ips) {
        const payload = Buffer.from(JSON.stringify(toAdvertisement(ip)));
        socket.send(payload, UDP_PORT, '255.255.255.255');
      }
    }, BROADCAST_INTERVAL_MS);
  }

  function stop(): void {
    if (timer) clearInterval(timer);
    timer = null;
    httpServer.close();
    socket.close();
  }

  return { start, stop };
}
