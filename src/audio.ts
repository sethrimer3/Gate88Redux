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

const MUSIC_TRACKS = [
  'queasy - disco past the floating clouds',
  'queasy - jam session',
  'queasy - late night driving music',
  'queasy - old spark fizzes',
  'queasy - overdub theory',
  'queasy - rux9',
  'queasy - somewhere east',
] as const;

export type MusicTrack = typeof MUSIC_TRACKS[number];

const ASSET_BASE_URL = import.meta.env.BASE_URL;
const MUSIC_DECIBEL_OFFSET = -6;
const MUSIC_OUTPUT_GAIN = Math.pow(10, MUSIC_DECIBEL_OFFSET / 20);
const SFX_DECIBEL_OFFSET = -6;
const SFX_OUTPUT_GAIN = Math.pow(10, SFX_DECIBEL_OFFSET / 20);

function assetUrl(path: string): string {
  const base = ASSET_BASE_URL.endsWith('/') ? ASSET_BASE_URL : `${ASSET_BASE_URL}/`;
  return `${base}${path.replace(/^\/+/, '')}`;
}

class AudioManager {
  private ctx: AudioContext | null = null;
  private soundBuffers = new Map<string, AudioBuffer>();
  private musicElement: HTMLAudioElement | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;

  private currentTrackIndex = -1;
  private musicVolume = 0.5;
  private sfxVolume = 0.5;
  private musicPlaylist: string[] = [];
  private isMenuMusic = false;

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

  /** Start playing the in-game music playlist (shuffled order). */
  startPlaylist(): void {
    this.isMenuMusic = false;
    this.musicPlaylist = [...MUSIC_TRACKS].sort(() => Math.random() - 0.5);
    this.currentTrackIndex = -1;
    this.skipSong();
  }

  /** Play the menu music track. */
  playMenuMusic(): void {
    this.isMenuMusic = true;
    this.playMusicFile(assetUrl('music/non-ingame/menu.ogg'));
  }

  /** Skip to the next song in the playlist. */
  skipSong(): void {
    if (this.isMenuMusic) return;
    this.currentTrackIndex =
      (this.currentTrackIndex + 1) % this.musicPlaylist.length;
    const track = this.musicPlaylist[this.currentTrackIndex];
    this.playMusicFile(assetUrl(`music/${track}.ogg`));
  }

  private playMusicFile(path: string): void {
    this.ensureContext();
    if (this.musicElement) {
      this.musicElement.pause();
      this.musicElement.removeAttribute('src');
      this.musicElement.load();
    }

    const el = new globalThis.Audio(path);
    this.musicElement = el;
    el.volume = this.effectiveMusicVolume();
    el.addEventListener('ended', () => {
      if (this.isMenuMusic) {
        this.musicElement?.play();
      } else {
        this.skipSong();
      }
    });
    el.play().catch(() => {
      // Autoplay blocked – will retry on user interaction
    });
  }

  /** Stop all music. */
  stopMusic(): void {
    if (this.musicElement) {
      this.musicElement.pause();
      this.musicElement.removeAttribute('src');
      this.musicElement.load();
      this.musicElement = null;
    }
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
}

export const Audio = new AudioManager();

