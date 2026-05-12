/**
 * WebRTC DataChannel transport implementing MultiplayerTransport.
 *
 * Topology: star — the host has one RTCPeerConnection per remote client;
 * each client has exactly one connection to the host.
 *
 * DataChannels per peer-pair:
 *   control   — ordered + reliable.  Lobby/match-start control messages.
 *   snapshots — unordered, maxRetransmits=0. Host → clients authoritative snapshots.
 *   inputs    — ordered + reliable.  Client → host player inputs.
 *
 * Signaling is performed via SignalingClient (Supabase REST polling).
 *
 * NAT note: free STUN servers are used. Symmetric NATs may require a TURN
 * server; see docs/ONLINE_MULTIPLAYER.md.
 */

import type { MultiplayerTransport } from '../net/transport.js';
import type { NetInputSnapshot, NetGameSnapshot } from '../net/protocol.js';
import type { SignalingClient, SignalRow } from './signalingClient.js';

/** Free STUN servers used for ICE gathering. Add TURN entries here for production reliability. */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // TODO: Add project-owned TURN servers here, for example:
  // { urls: 'turns:turn.example.com:5349', username: '...', credential: '...' },
];

export type WebRtcPeerConnectionState =
  | 'requested'
  | 'offer_sent'
  | 'answer_received'
  | 'ice_connected'
  | 'control_open'
  | 'inputs_open'
  | 'snapshots_open'
  | 'channels_ready'
  | 'disconnected'
  | 'failed';

interface PeerEntry {
  pc: RTCPeerConnection;
  controlChannel: RTCDataChannel | null;
  /** Reliable input channel (client → host). */
  inputsChannel: RTCDataChannel | null;
  /** Unreliable snapshot channel (host → client). */
  snapshotsChannel: RTCDataChannel | null;
}

/**
 * WebRTC DataChannel transport for online multiplayer.
 *
 * After construction, call `startSignaling(remoteSlots)` to kick off the
 * offer/answer/ICE exchange.  Once all channels are open, `connected` will
 * be true.  Callbacks (onInputSnapshot, onAuthoritativeSnapshot, onDisconnect)
 * must be set before starting signaling.
 */
export class WebRtcTransport implements MultiplayerTransport {
  readonly mode = 'online' as const;
  connected = false;

  onInputSnapshot?: (fromSlot: number, input: NetInputSnapshot) => void;
  onAuthoritativeSnapshot?: (snapshot: NetGameSnapshot) => void;
  onDisconnect?: (reason: string) => void;
  onControlMessage?: (msg: unknown, fromSlot: number) => void;
  onPeerConnectionStateChanged?: (remoteSlot: number, state: WebRtcPeerConnectionState) => void;
  onPeerChannelsReady?: (remoteSlot: number) => void;

  /** Map from remoteSlot → peer data. */
  private readonly peers: Map<number, PeerEntry> = new Map();
  private readonly readyRemoteSlots = new Set<number>();

  constructor(
    private readonly signalingClient: SignalingClient,
    readonly isHost: boolean,
    readonly mySlot: number,
    /** Slot of the host (same as mySlot when isHost=true). */
    readonly hostSlot: number,
  ) {}

  // ---------------------------------------------------------------------------
  // Signaling entry points
  // ---------------------------------------------------------------------------

  /**
   * Start the signaling flow.
   * - Host: sends offers to each remoteSlot.
   * - Client: sends a want_connect signal to the host and waits for an offer.
   */
  startSignaling(remoteSlots: number[]): void {
    this.signalingClient.startPolling((signal) => this.handleSignal(signal));
    if (this.isHost) {
      for (const slot of remoteSlots) {
        this.createOffer(slot).catch((e) =>
          console.error('[WebRtcTransport] createOffer error:', e),
        );
      }
    } else {
      // Announce intent to connect so the host creates an offer for us.
      this.signalingClient
        .sendSignal(this.hostSlot, 'want_connect', { slot: this.mySlot })
        .catch((e) => console.error('[WebRtcTransport] want_connect error:', e));
      this.emitPeerState(this.hostSlot, 'requested');
    }
  }

  // ---------------------------------------------------------------------------
  // Offer / answer / ICE
  // ---------------------------------------------------------------------------

  /** Host: create a PeerConnection and send an offer to remoteSlot. */
  async createOffer(remoteSlot: number): Promise<void> {
    const pc = this.makePeerConnection(remoteSlot);

    // Host creates outbound channels.
    const controlChannel = pc.createDataChannel('control', { ordered: true });
    const snapshotsChannel = pc.createDataChannel('snapshots', {
      ordered: false,
      maxRetransmits: 0,
    });

    controlChannel.onopen = () => { this.onChannelOpen(remoteSlot, 'control'); };
    controlChannel.onerror = (e) => console.warn('[WebRtcTransport] control error:', e);
    controlChannel.onmessage = (ev) => this.handleControlMessage(ev.data as string, remoteSlot);
    snapshotsChannel.onopen = () => { this.onChannelOpen(remoteSlot, 'snapshots'); };
    snapshotsChannel.onerror = (e) => console.warn('[WebRtcTransport] snapshots error:', e);

    const entry: PeerEntry = { pc, controlChannel, snapshotsChannel, inputsChannel: null };
    this.peers.set(remoteSlot, entry);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this.signalingClient.sendSignal(remoteSlot, 'offer', {
      sdp: offer.sdp,
      type: offer.type,
    });
    this.emitPeerState(remoteSlot, 'offer_sent');
  }

  /** Client: receive offer from host and send back an answer. */
  async handleOffer(fromSlot: number, sdp: string, sdpType: RTCSdpType): Promise<void> {
    const pc = this.makePeerConnection(fromSlot);

    // Client receives host's outbound channels via ondatachannel.
    pc.ondatachannel = (event) => {
      const ch = event.channel;
      const entry = this.peers.get(fromSlot);
      if (!entry) return;
      if (ch.label === 'control') {
        entry.controlChannel = ch;
        ch.onopen = () => { this.onChannelOpen(fromSlot, 'control'); };
        ch.onerror = (e) => console.warn('[WebRtcTransport] control error:', e);
        ch.onmessage = (ev) => this.handleControlMessage(ev.data as string, fromSlot);
      } else if (ch.label === 'snapshots') {
        entry.snapshotsChannel = ch;
        ch.onopen = () => { this.onChannelOpen(fromSlot, 'snapshots'); };
        ch.onmessage = (ev) => this.handleSnapshotMessage(ev.data as string);
        ch.onerror = (e) => console.warn('[WebRtcTransport] snapshots error:', e);
      }
    };

    // Client creates its own inputs channel (goes to host).
    const inputsChannel = pc.createDataChannel('inputs', { ordered: true });
    inputsChannel.onopen = () => { this.onChannelOpen(fromSlot, 'inputs'); };
    inputsChannel.onerror = (e) => console.warn('[WebRtcTransport] inputs error:', e);

    const entry: PeerEntry = { pc, controlChannel: null, snapshotsChannel: null, inputsChannel };
    this.peers.set(fromSlot, entry);

    await pc.setRemoteDescription(new RTCSessionDescription({ type: sdpType, sdp }));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await this.signalingClient.sendSignal(fromSlot, 'answer', {
      sdp: answer.sdp,
      type: answer.type,
    });
    this.emitPeerState(fromSlot, 'answer_received');
  }

  /** Host: receive answer from a remote client. */
  async handleAnswer(fromSlot: number, sdp: string, sdpType: RTCSdpType): Promise<void> {
    const entry = this.peers.get(fromSlot);
    if (!entry) return;
    await entry.pc.setRemoteDescription(new RTCSessionDescription({ type: sdpType, sdp }));
    this.emitPeerState(fromSlot, 'answer_received');
  }

  /** Both sides: add an ICE candidate from a remote peer. */
  async handleIceCandidate(
    fromSlot: number,
    candidateInit: RTCIceCandidateInit,
  ): Promise<void> {
    const entry = this.peers.get(fromSlot);
    if (!entry) return;
    try {
      await entry.pc.addIceCandidate(new RTCIceCandidate(candidateInit));
    } catch (e) {
      console.warn('[WebRtcTransport] addIceCandidate failed:', e);
    }
  }

  // ---------------------------------------------------------------------------
  // MultiplayerTransport implementation
  // ---------------------------------------------------------------------------

  /**
   * Host: broadcast authoritative snapshot to all connected clients.
   * Sent over the unreliable `snapshots` channel.
   */
  sendAuthoritativeSnapshot(snapshot: Omit<NetGameSnapshot, 'protocolVersion'>): void {
    const data = JSON.stringify({ protocolVersion: 1, ...snapshot });
    for (const [, entry] of this.peers) {
      const ch = entry.snapshotsChannel;
      if (ch?.readyState === 'open') {
        try { ch.send(data); } catch (e) {
          console.warn('[WebRtcTransport] snapshot send error:', e);
        }
      }
    }
  }

  /**
   * Client: send local input snapshot to the host.
   * Sent over the reliable `inputs` channel.
   */
  sendInputSnapshot(input: Omit<NetInputSnapshot, 'protocolVersion'>): void {
    const hostEntry = this.peers.get(this.hostSlot);
    const ch = hostEntry?.inputsChannel;
    if (ch?.readyState === 'open') {
      try {
        ch.send(JSON.stringify({ protocolVersion: 1, ...input }));
      } catch (e) {
        console.warn('[WebRtcTransport] input send error:', e);
      }
    }
  }

  /**
   * Send a control message (e.g. match_start) to a specific slot or all peers.
   * @param toSlot Slot index or 'all'.
   */
  sendControl(toSlot: number | 'all', msg: unknown): void {
    const data = JSON.stringify(msg);
    if (toSlot === 'all') {
      for (const [, entry] of this.peers) {
        if (entry.controlChannel?.readyState === 'open') {
          try { entry.controlChannel.send(data); } catch { /* ignore */ }
        }
      }
    } else {
      const entry = this.peers.get(toSlot);
      if (entry?.controlChannel?.readyState === 'open') {
        try { entry.controlChannel.send(data); } catch { /* ignore */ }
      }
    }
  }

  /** Close all peer connections and stop signaling. */
  disconnect(): void {
    this.signalingClient.stopPolling();
    for (const [, entry] of this.peers) {
      entry.pc.close();
    }
    this.peers.clear();
    this.readyRemoteSlots.clear();
    this.connected = false;
  }

  getReadyRemoteSlots(): number[] {
    return Array.from(this.readyRemoteSlots).sort((a, b) => a - b);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private makePeerConnection(remoteSlot: number): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signalingClient
          .sendSignal(remoteSlot, 'ice', {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
          })
          .catch((e) => console.warn('[WebRtcTransport] ICE send error:', e));
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        this.emitPeerState(remoteSlot, 'ice_connected');
        this.checkPeerReady(remoteSlot);
      }
      if (state === 'disconnected' || state === 'failed') {
        this.readyRemoteSlots.delete(remoteSlot);
        this.connected = this.readyRemoteSlots.size > 0;
        this.emitPeerState(remoteSlot, state);
        this.onDisconnect?.(
          `WebRTC connection to slot ${remoteSlot} ${state}`,
        );
      }
    };

    // Host side: receive the 'inputs' datachannel created by the remote client.
    if (this.isHost) {
      pc.ondatachannel = (event) => {
        const ch = event.channel;
        if (ch.label === 'inputs') {
          const entry = this.peers.get(remoteSlot);
          if (entry) {
            entry.inputsChannel = ch;
            ch.onopen = () => { this.onChannelOpen(remoteSlot, 'inputs'); };
            ch.onmessage = (ev) => this.handleInputMessage(ev.data as string, remoteSlot);
            ch.onerror = (e) => console.warn('[WebRtcTransport] inputs error:', e);
          }
        }
      };
    }

    return pc;
  }

  private onChannelOpen(remoteSlot: number, channel: 'control' | 'inputs' | 'snapshots'): void {
    this.emitPeerState(
      remoteSlot,
      channel === 'control' ? 'control_open' : channel === 'inputs' ? 'inputs_open' : 'snapshots_open',
    );
    this.checkPeerReady(remoteSlot);
  }

  private handleControlMessage(data: string, fromSlot: number): void {
    try {
      this.onControlMessage?.(JSON.parse(data), fromSlot);
    } catch (e) {
      console.warn('[WebRtcTransport] control parse error:', e);
    }
  }

  private handleSnapshotMessage(data: string): void {
    if (this.isHost) return; // host should not receive snapshots
    try {
      const snapshot = JSON.parse(data) as NetGameSnapshot;
      this.onAuthoritativeSnapshot?.(snapshot);
    } catch (e) {
      console.warn('[WebRtcTransport] snapshot parse error:', e);
    }
  }

  private handleInputMessage(data: string, fromSlot: number): void {
    if (!this.isHost) return; // only host processes incoming inputs
    try {
      const input = JSON.parse(data) as NetInputSnapshot;
      this.onInputSnapshot?.(fromSlot, input);
    } catch (e) {
      console.warn('[WebRtcTransport] input parse error:', e);
    }
  }

  handleSignal(signal: SignalRow): void {
    const { type, from_slot } = signal;
    const p = signal.payload as Record<string, unknown>;

    switch (type) {
      case 'want_connect':
        if (this.isHost) {
          this.emitPeerState(from_slot, 'requested');
          this.createOffer(from_slot).catch((e) =>
            console.error('[WebRtcTransport] createOffer error:', e),
          );
        }
        break;

      case 'offer':
        if (!this.isHost) {
          this.handleOffer(
            from_slot,
            p['sdp'] as string,
            p['type'] as RTCSdpType,
          ).catch((e) => console.error('[WebRtcTransport] handleOffer error:', e));
        }
        break;

      case 'answer':
        if (this.isHost) {
          this.handleAnswer(
            from_slot,
            p['sdp'] as string,
            p['type'] as RTCSdpType,
          ).catch((e) => console.error('[WebRtcTransport] handleAnswer error:', e));
        }
        break;

      case 'ice': {
        const candidateInit: RTCIceCandidateInit = {
          candidate: p['candidate'] as string,
          sdpMid: (p['sdpMid'] ?? null) as string | null,
          sdpMLineIndex: (p['sdpMLineIndex'] ?? null) as number | null,
        };
        this.handleIceCandidate(from_slot, candidateInit).catch((e) =>
          console.warn('[WebRtcTransport] handleIceCandidate error:', e),
        );
        break;
      }

      case 'match_start':
        this.onControlMessage?.(signal.payload, from_slot);
        break;

      default:
        break;
    }
  }

  private checkPeerReady(remoteSlot: number): void {
    const entry = this.peers.get(remoteSlot);
    if (!entry) return;
    const ready =
      entry.controlChannel?.readyState === 'open' &&
      entry.inputsChannel?.readyState === 'open' &&
      entry.snapshotsChannel?.readyState === 'open';
    if (!ready || this.readyRemoteSlots.has(remoteSlot)) return;
    this.readyRemoteSlots.add(remoteSlot);
    this.connected = true;
    this.emitPeerState(remoteSlot, 'channels_ready');
    this.onPeerChannelsReady?.(remoteSlot);
  }

  private emitPeerState(remoteSlot: number, state: WebRtcPeerConnectionState): void {
    this.onPeerConnectionStateChanged?.(remoteSlot, state);
    console.debug(`[WebRtcTransport] slot ${remoteSlot}: ${state}`);
  }
}

/** Returns true if RTCPeerConnection is available in this runtime. */
export function isWebRtcAvailable(): boolean {
  return typeof RTCPeerConnection !== 'undefined';
}
