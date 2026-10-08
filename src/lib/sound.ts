import { useCallback, useEffect, useRef } from "react";

export type Chirp = "happy" | "alert" | "change";

export interface Note {
  /** Frequency in Hz. */
  freq: number;
  /** Start offset in seconds. */
  start: number;
  /** Duration in seconds. */
  dur: number;
}

/** Soft, short sounds. Pure data so it can be tested without audio hardware. */
export function chirpPlan(kind: Chirp): Note[] {
  switch (kind) {
    case "happy":
      return [
        { freq: 660, start: 0, dur: 0.08 },
        { freq: 880, start: 0.09, dur: 0.12 },
      ];
    case "alert":
      return [
        { freq: 440, start: 0, dur: 0.1 },
        { freq: 440, start: 0.16, dur: 0.1 },
      ];
    case "change":
      return [{ freq: 740, start: 0, dur: 0.1 }];
  }
}

export const VOLUME = 0.04;

/** Total length of a chirp in seconds. */
export function chirpLength(kind: Chirp): number {
  return Math.max(...chirpPlan(kind).map((n) => n.start + n.dur));
}

type AudioCtor = new () => AudioContext;

function audioConstructor(): AudioCtor | undefined {
  const w = globalThis as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext;
}

/**
 * Returns `play(kind)`. It does nothing while `enabled` is false (the mute toggle) or when audio is
 * unavailable. The audio context is created lazily on first use.
 */
export function useSound(enabled: boolean): (kind: Chirp) => void {
  const ctx = useRef<AudioContext | null>(null);
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(
    () => () => {
      void ctx.current?.close().catch(() => undefined);
      ctx.current = null;
    },
    [],
  );

  return useCallback((kind: Chirp) => {
    if (!enabledRef.current) return;
    const Ctor = audioConstructor();
    if (!Ctor) return;
    try {
      ctx.current ??= new Ctor();
      const audio = ctx.current;
      void audio.resume?.();
      const now = audio.currentTime;
      for (const note of chirpPlan(kind)) {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = "sine";
        osc.frequency.value = note.freq;
        gain.gain.setValueAtTime(0, now + note.start);
        gain.gain.linearRampToValueAtTime(VOLUME, now + note.start + 0.01);
        gain.gain.linearRampToValueAtTime(0, now + note.start + note.dur);
        osc.connect(gain).connect(audio.destination);
        osc.start(now + note.start);
        osc.stop(now + note.start + note.dur + 0.02);
      }
    } catch {
      // Sound is a nicety; never let it break the app.
    }
  }, []);
}
