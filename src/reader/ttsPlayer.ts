import { synthesizeSentence, type SynthesisResult, type WordTiming } from "../lib/ipc";
import type { NovusRenderer } from "./NovusRenderer";
import { collectSentences, type SentenceSeed } from "./sentences";

/** Sentences synthesized ahead of the one playing. */
const LOOKAHEAD = 3;
/** Beat between sentences */
const SENTENCE_GAP_S = 0.14;
const HEADING_GAP_S = 0.32;
/** Consecutive synthesis failures before the player gives up. */
const MAX_CONSECUTIVE_FAILURES = 3;

export type TtsPlayerStatus =
  | "preparing"
  | "playing"
  | "paused"
  | "stalled"
  | "finished"
  | "error";

export interface TtsVoiceChoice {
  packId: string;
  voiceId: string;
  speed: number;
}

export interface TtsPlayerEvents {
  onStatus: (status: TtsPlayerStatus, error?: string) => void;
  onSentenceStart: (seed: SentenceSeed, words: WordTiming[]) => void;
  onSentenceEnd: (seed: SentenceSeed) => void;
}

export interface Playhead {
  seed: SentenceSeed;
  audio: SynthesisResult;
  elapsedMs: number;
}

interface QueueItem {
  seed: SentenceSeed;
  audio?: SynthesisResult;
  pending?: Promise<void>;
}

export class TtsPlayer {
  #renderer: NovusRenderer;
  #voice: TtsVoiceChoice;
  #events: TtsPlayerEvents;
  #ctx: AudioContext | null = null;

  #queue: QueueItem[] = [];
  #cursor = 0;
  #epoch = 0;
  #source: AudioBufferSourceNode | null = null;
  #sentenceStartAt = 0;
  #status: TtsPlayerStatus = "preparing";
  #failures = 0;
  #destroyed = false;
  stopAtSectionEnd = false;

  constructor(renderer: NovusRenderer, voice: TtsVoiceChoice, events: TtsPlayerEvents) {
    this.#renderer = renderer;
    this.#voice = voice;
    this.#events = events;
  }

  get status(): TtsPlayerStatus {
    return this.#status;
  }

  /** Current sentence + audio + elapsed time, or null when not playing. */
  playhead(): Playhead | null {
    const ctx = this.#ctx;
    const item = this.#queue[this.#cursor];
    if (!ctx || !item?.audio || (this.#status !== "playing" && this.#status !== "paused")) {
      return null;
    }
    return {
      seed: item.seed,
      audio: item.audio,
      elapsedMs: Math.max(0, (ctx.currentTime - this.#sentenceStartAt) * 1000),
    };
  }

  /** Begin at `startIndex` within the current section's sentences. */
  async start(seeds: SentenceSeed[], startIndex: number): Promise<void> {
    this.#ctx = new AudioContext();
    this.#queue = seeds.map((seed) => ({ seed }));
    this.#cursor = Math.max(0, Math.min(startIndex, seeds.length - 1));
    this.#setStatus("preparing");
    await this.#playCurrent();
  }

  pause(): void {
    if (this.#status !== "playing") return;
    void this.#ctx?.suspend();
    this.#setStatus("paused");
  }

  resume(): void {
    if (this.#status !== "paused") return;
    void this.#ctx?.resume();
    this.#setStatus("playing");
  }

  /** Jump whole sentences (±1 from the pill). */
  async skip(delta: number): Promise<void> {
    const target = this.#cursor + delta;
    if (target < 0 || target >= this.#queue.length) return;
    this.#interrupt();
    this.#cursor = target;
    await this.#resumeFromCursor();
  }

  /** Restart the current sentence at a new pace (resynthesis, pitch-preserved). */
  async setSpeed(speed: number): Promise<void> {
    if (speed === this.#voice.speed) return;
    this.#voice = { ...this.#voice, speed };
    this.#interrupt();
    // Queued audio was rendered at the old pace — drop everything unplayed.
    for (let i = this.#cursor; i < this.#queue.length; i++) {
      this.#queue[i] = { seed: this.#queue[i].seed };
    }
    await this.#resumeFromCursor();
  }

  destroy(): void {
    this.#destroyed = true;
    this.#interrupt();
    void this.#ctx?.close();
    this.#ctx = null;
    this.#queue = [];
  }

  #interrupt(): void {
    this.#epoch++;
    if (this.#source) {
      this.#source.onended = null;
      try {
        this.#source.stop();
      } catch {
        // never started or already stopped
      }
      this.#source = null;
    }
    if (this.#ctx?.state === "suspended") void this.#ctx.resume();
  }

  async #resumeFromCursor(): Promise<void> {
    this.#setStatus("preparing");
    await this.#playCurrent();
  }

  #setStatus(status: TtsPlayerStatus, error?: string): void {
    if (this.#destroyed && status !== "error") return;
    this.#status = status;
    this.#events.onStatus(status, error);
  }

  /** Ensure synthesis is requested for the cursor and the lookahead window. */
  #pump(epoch: number): void {
    const until = Math.min(this.#queue.length, this.#cursor + 1 + LOOKAHEAD);
    for (let i = this.#cursor; i < until; i++) {
      const item = this.#queue[i];
      if (item.audio || item.pending) continue;
      item.pending = synthesizeSentence(
        this.#voice.packId,
        this.#voice.voiceId,
        item.seed.text,
        this.#voice.speed,
      )
        .then((audio) => {
          if (epoch === this.#epoch) item.audio = audio;
        })
        .catch(() => {
          // Leave audio unset; #playCurrent decides skip-vs-fail when it gets here.
        })
        .finally(() => {
          item.pending = undefined;
        });
    }
  }

  async #playCurrent(): Promise<void> {
    const epoch = this.#epoch;
    const ctx = this.#ctx;
    if (!ctx || this.#destroyed) return;

    // Section exhausted: cross into the next chapter, or finish the book.
    if (this.#cursor >= this.#queue.length) {
      const crossed = await this.#crossSection(epoch);
      if (!crossed || epoch !== this.#epoch) {
        if (!crossed) this.#setStatus("finished");
        return;
      }
    }

    const item = this.#queue[this.#cursor];
    this.#pump(epoch);

    if (!item.audio) {
      if (item.pending) {
        this.#setStatus(this.#status === "playing" ? "playing" : "stalled");
        await item.pending;
        if (epoch !== this.#epoch) return;
      }
      if (!item.audio) {
        // Synthesis failed for this sentence: skip it, give up after a run of failures.
        this.#failures++;
        if (this.#failures >= MAX_CONSECUTIVE_FAILURES) {
          this.#setStatus("error", "The voice engine stopped responding.");
          return;
        }
        this.#cursor++;
        await this.#playCurrent();
        return;
      }
    }
    this.#failures = 0;

    const buffer = pcmToAudioBuffer(ctx, item.audio);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const gap = item.seed.isHeading ? HEADING_GAP_S : SENTENCE_GAP_S;
    const startAt = Math.max(ctx.currentTime + 0.02, this.#sentenceStartAt);

    this.#source = source;
    this.#sentenceStartAt = startAt;
    source.onended = () => {
      if (epoch !== this.#epoch) return;
      this.#events.onSentenceEnd(item.seed);
      this.#source = null;
      this.#sentenceStartAt = ctx.currentTime + gap;
      this.#cursor++;
      void this.#playCurrent();
    };

    this.#events.onSentenceStart(item.seed, item.audio.words);
    source.start(startAt);
    this.#setStatus("playing");
  }

  /** Mount the next linear section and refill the queue from its sentences. */
  async #crossSection(epoch: number): Promise<boolean> {
    if (this.stopAtSectionEnd) return false;
    this.#setStatus("preparing");
    const advanced = await this.#renderer.displayNextSection();
    if (!advanced || epoch !== this.#epoch) return false;
    const doc = this.#renderer.contentDocument;
    if (!doc) return false;
    const seeds = collectSentences(doc, (range) => this.#renderer.cfiFromRange(range));
    if (seeds.length === 0) {
      // A sectionful of images or front matter: keep crossing.
      return this.#crossSection(epoch);
    }
    this.#queue = seeds.map((seed) => ({ seed }));
    this.#cursor = 0;
    return true;
  }
}

/** 16-bit little-endian mono PCM (base64) -> AudioBuffer. */
function pcmToAudioBuffer(ctx: AudioContext, audio: SynthesisResult): AudioBuffer {
  const raw = atob(audio.pcmBase64);
  const samples = raw.length / 2;
  const buffer = ctx.createBuffer(1, Math.max(1, samples), audio.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < samples; i++) {
    const lo = raw.charCodeAt(i * 2);
    const hi = raw.charCodeAt(i * 2 + 1);
    const value = (hi << 8) | lo;
    const signed = value >= 0x8000 ? value - 0x10000 : value;
    channel[i] = signed / 32768;
  }
  return buffer;
}
