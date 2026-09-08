/** Audio manager for Gate88 – Web Audio API */

const SOUND_NAMES = [
  'fire', 'laser', 'missile', 'missile2', 'bigfire', 'bigmissile',
  'exciterbullet', 'exciterbeam', 'massdriverbullet', 'regenbullet',
  'bigregenbullet', 'shortbullet', 'minilaser', 'firebomb',
  'bhit0', 'genericcollision',
  'explode0', 'explode1', 'explode2',
  'drive', 'enemydrive', 'cloak', 'heavy',
  'changespecial', 'selfregen', 'openradar',
  'researchcomplete', 'build', 'enemyhere',
  'menucursor', 'menuselection',
] as const;

export type SoundName = typeof SOUND_NAMES[number];

const IN_GAME_MUSIC_TRACKS = [
  'absolutesound-guitar-music-guitar-528969.mp3',
  'apalonbeats-guitar-guitar-music-549446.mp3',
  'arpmedia-fast-dynamic-rhythmic-music-588478.mp3',
  'arpmedia-guitar-guitar-music-561480.mp3',
  'mondamusic-guitar-guitar-music-529564.mp3',
  'monume-guitar-solo-guitar-music-556477.mp3',
  'oceanframemusic-space-background-guitar-524596.mp3',
  'soulprodmusic-spaceship-145869.mp3',
] as const;

const MENU_MUSIC_TRACK = 'absolutesound-acoustic-guitar-chill-516783.mp3';
const MUSIC_CROSSFADE_SECONDS = 8;

const ASSET_BASE_URL = import.meta.env.BASE_URL;
const MUSIC_DECIBEL_OFFSET = -20;
const MUSIC_OUTPUT_GAIN = Math.pow(10, MUSIC_DECIBEL_OFFSET / 20);
const SFX_DECIBEL_OFFSET = -20;
const SFX_OUTPUT_GAIN = Math.pow(10, SFX_DECIBEL_OFFSET / 20);

function assetUrl(path: string): string {
  const base = ASSET_BASE_URL.endsWith('/') ? ASSET_BASE_URL : `${ASSET_BASE_URL}/`;
  return `${base}${path.replace(/^\/+/, '')}`;
}

class AudioManager {
  private ctx: AudioContext | null = null;
  private soundBuffers = new Map<string, AudioBuffer>();
  private musicElement: HTMLAudioElement | null = null;
  private fadingMusicElements = new Set<HTMLAudioElement>();
  private crossfadeTimer: ReturnType<typeof setTimeout> | null = null;
  private crossfadeFrame: number | null = null;
  private musicGeneration = 0;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private activeSoundCounts = new Map<SoundName, number>();

  private musicVolume = 0.5;
  private sfxVolume = 0.5;
  private isMenuMusic = false;
  private recentInGameTracks: string[] = [];

  /** Lazily initialise the AudioContext (must happen after a user gesture). */
  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.effectiveSfxVolume();
      this.sfxGain.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.effectiveMusicVolume();
      this.musicGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  /** Preload all sound effects. Call once during game init. */
  async loadSounds(): Promise<void> {
    const ctx = this.ensureContext();
    const promises = SOUND_NAMES.map(async (name) => {
      try {
        const response = await fetch(assetUrl(`sound/${name}.wav`));
        if (!response.ok) return;
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        this.soundBuffers.set(name, audioBuffer);
      } catch {
        // Sound not available – non-fatal
      }
    });
    await Promise.all(promises);
  }

  /** Play a sound effect by name. */
  playSound(name: SoundName, volumeScale: number = 1): void {
    const ctx = this.ensureContext();
    const buffer = this.soundBuffers.get(name);
    if (!buffer || !this.sfxGain) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (volumeScale === 1) {
      source.connect(this.sfxGain);
    } else {
      const gain = ctx.createGain();
      gain.gain.value = Math.max(0, volumeScale);
      source.connect(gain);
      gain.connect(this.sfxGain);
    }
    source.start(0);
  }

  playLimitedSound(name: SoundName, maxConcurrent: number, volumeScale: number = 1): void {
    if (maxConcurrent <= 0) return;
    const active = this.activeSoundCounts.get(name) ?? 0;
    if (active >= maxConcurrent) return;

    const ctx = this.ensureContext();
    const buffer = this.soundBuffers.get(name);
    if (!buffer || !this.sfxGain) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const finish = (): void => {
      const next = Math.max(0, (this.activeSoundCounts.get(name) ?? 1) - 1);
      if (next === 0) this.activeSoundCounts.delete(name);
      else this.activeSoundCounts.set(name, next);
    };
    source.addEventListener('ended', finish, { once: true });
    if (volumeScale === 1) {
      source.connect(this.sfxGain);
    } else {
      const gain = ctx.createGain();
      gain.gain.value = Math.max(0, volumeScale);
      source.connect(gain);
      gain.connect(this.sfxGain);
    }
    this.activeSoundCounts.set(name, active + 1);
    try {
      source.start(0);
    } catch {
      finish();
    }
  }

  /** Start the randomized in-game music rotation. */
  startPlaylist(): void {
    this.isMenuMusic = false;
    this.recentInGameTracks = [];
    this.stopMusicElements();
    this.playNextInGameTrack(false);
  }

  /** Play the menu music track. */
  playMenuMusic(): void {
    this.isMenuMusic = true;
    this.recentInGameTracks = [];
    this.stopMusicElements();
    this.playMusicFile(assetUrl(`music/Music-Menu/${MENU_MUSIC_TRACK}`), true);
  }

  /** Skip to the next song in the playlist. */
  skipSong(): void {
    if (this.isMenuMusic) return;
    this.playNextInGameTrack(this.musicElement !== null);
  }

  private pickNextInGameTrack(): string {
    // With 3+ songs, excluding the last two guarantees two different songs
    // between repeats. Smaller libraries necessarily relax that constraint.
    const excluded = IN_GAME_MUSIC_TRACKS.length >= 3
      ? new Set(this.recentInGameTracks.slice(-2))
      : new Set<string>();
    const choices = IN_GAME_MUSIC_TRACKS.filter((track) => !excluded.has(track));
    return choices[Math.floor(Math.random() * choices.length)];
  }

  private playNextInGameTrack(crossfade: boolean): void {
    if (this.isMenuMusic) return;
    const track = this.pickNextInGameTrack();
    this.recentInGameTracks.push(track);
    if (this.recentInGameTracks.length > 2) this.recentInGameTracks.shift();
    this.playMusicFile(assetUrl(`music/Music-InGame/${track}`), false, crossfade);
  }

  private playMusicFile(path: string, loop = false, crossfade = false): void {
    this.ensureContext();
    this.cancelCrossfadeSchedule();
    for (const staleFade of this.fadingMusicElements) this.disposeMusicElement(staleFade);
    this.fadingMusicElements.clear();
    const outgoing = this.musicElement;
    const el = new globalThis.Audio(path);
    this.musicElement = el;
    const generation = ++this.musicGeneration;
    el.loop = loop;
    el.preload = 'auto';
    el.volume = crossfade && outgoing ? 0 : this.effectiveMusicVolume();
    const scheduleCrossfade = (): void => {
      if (loop || this.musicElement !== el || generation !== this.musicGeneration) return;
      const delayMs = Math.max(0, (el.duration - el.currentTime - MUSIC_CROSSFADE_SECONDS) * 1000);
      if (!Number.isFinite(delayMs)) return;
      this.crossfadeTimer = setTimeout(() => {
        if (this.musicElement === el && !this.isMenuMusic) this.playNextInGameTrack(true);
      }, delayMs);
    };
    el.addEventListener('loadedmetadata', scheduleCrossfade, { once: true });
    el.addEventListener('ended', () => {
      if (this.musicElement === el && !this.isMenuMusic) this.playNextInGameTrack(false);
    });
    el.play().catch(() => {
      // Autoplay blocked – will retry on user interaction
    });

    if (crossfade && outgoing) this.fadeBetween(outgoing, el);
    else if (outgoing) this.disposeMusicElement(outgoing);
  }

  private fadeBetween(outgoing: HTMLAudioElement, incoming: HTMLAudioElement): void {
    this.fadingMusicElements.add(outgoing);
    const startedAt = performance.now();
    const outgoingStartVolume = outgoing.volume;
    const step = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / (MUSIC_CROSSFADE_SECONDS * 1000));
      outgoing.volume = outgoingStartVolume * (1 - progress);
      incoming.volume = this.effectiveMusicVolume() * progress;
      if (progress < 1 && this.musicElement === incoming) {
        this.crossfadeFrame = requestAnimationFrame(step);
      } else {
        this.crossfadeFrame = null;
        this.fadingMusicElements.delete(outgoing);
        this.disposeMusicElement(outgoing);
      }
    };
    this.crossfadeFrame = requestAnimationFrame(step);
  }

  private cancelCrossfadeSchedule(): void {
    if (this.crossfadeTimer !== null) clearTimeout(this.crossfadeTimer);
    this.crossfadeTimer = null;
    if (this.crossfadeFrame !== null) cancelAnimationFrame(this.crossfadeFrame);
    this.crossfadeFrame = null;
  }

  private disposeMusicElement(el: HTMLAudioElement): void {
    el.pause();
    el.removeAttribute('src');
    el.load();
  }

  private stopMusicElements(): void {
    this.cancelCrossfadeSchedule();
    this.musicGeneration++;
    if (this.musicElement) this.disposeMusicElement(this.musicElement);
    for (const el of this.fadingMusicElements) this.disposeMusicElement(el);
    this.fadingMusicElements.clear();
    this.musicElement = null;
  }

  /** Stop all music. */
  stopMusic(): void {
    this.stopMusicElements();
  }

  setSfxVolume(v: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, v));
    if (this.sfxGain) this.sfxGain.gain.value = this.effectiveSfxVolume();
  }

  setMusicVolume(v: number): void {
    this.musicVolume = Math.max(0, Math.min(1, v));
    const effectiveVolume = this.effectiveMusicVolume();
    if (this.musicGain) this.musicGain.gain.value = effectiveVolume;
    if (this.musicElement) this.musicElement.volume = effectiveVolume;
    for (const el of this.fadingMusicElements) {
      el.volume = Math.min(el.volume, effectiveVolume);
    }
  }

  getSfxVolume(): number {
    return this.sfxVolume;
  }

  getMusicVolume(): number {
    return this.musicVolume;
  }

  private effectiveMusicVolume(): number {
    return Math.max(0, Math.min(1, this.musicVolume * MUSIC_OUTPUT_GAIN));
  }

  private effectiveSfxVolume(): number {
    return Math.max(0, Math.min(1, this.sfxVolume * SFX_OUTPUT_GAIN));
  }

  // -----------------------------------------------------------------------
  // Drive / engine loop
  // -----------------------------------------------------------------------

  private driveSource: AudioBufferSourceNode | null = null;

  /** Start (or keep running) the looped drive engine sound. */
  startDriveLoop(): void {
    if (this.driveSource) return;
    const ctx = this.ensureContext();
    const buffer = this.soundBuffers.get('drive');
    if (!buffer || !this.sfxGain) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(this.sfxGain);
    source.start(0);
    this.driveSource = source;
  }

  /** Stop the looped drive engine sound. */
  stopDriveLoop(): void {
    if (this.driveSource) {
      this.driveSource.stop();
      this.driveSource = null;
    }
  }

  // -----------------------------------------------------------------------
  // Spatial / distance-culled helper
  // -----------------------------------------------------------------------

  /**
   * Play a sound only if it occurs within hearing range of the player.
   * @param name - Sound to play.
   * @param dist - Distance from the player to the event (world units).
   * @param maxDist - Maximum audible distance (default 800).
   */
  playSoundAt(name: SoundName, dist: number, maxDist: number = 800): void {
    if (dist <= maxDist) {
      this.playSound(name);
    }
  }

  playLimitedSoundAt(name: SoundName, dist: number, maxConcurrent: number, maxDist: number = 800): void {
    if (dist <= maxDist) {
      this.playLimitedSound(name, maxConcurrent);
    }
  }
}

export const Audio = new AudioManager();

