import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { OperationRun, SimEvent } from "@netsim/engine";

/** Real milliseconds for one simulation time unit (one cable hop) at speed 1. */
export const MS_PER_UNIT = 650;
/** How long drop and delivery markers stay visible, in time units. */
export const MARK_TIME = 1.4;
const TAIL = MARK_TIME + 0.4;

/**
 * Replays an operation's events in real time. Lives outside React state so that only the
 * components that draw packets re-render every frame. Quiet stretches (waiting for a timeout)
 * are shortened so the animation never seems stuck.
 */
export class Playback {
  now = 0;
  playing = false;
  speed = 1;
  run: OperationRun | null = null;
  private listeners = new Set<() => void>();
  private raf = 0;
  private last = 0;
  private snapshot = { now: 0, playing: false, run: null as OperationRun | null };

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.snapshot;

  private emit() {
    this.snapshot = { now: this.now, playing: this.playing, run: this.run };
    for (const l of this.listeners) l();
  }

  get end(): number {
    return (this.run?.duration ?? 0) + TAIL;
  }

  start(run: OperationRun) {
    this.run = run;
    this.now = 0;
    this.play();
  }

  play() {
    if (!this.run) return;
    if (this.now >= this.end) this.now = 0;
    this.playing = true;
    this.last = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
    this.emit();
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.emit();
  }

  skipToEnd() {
    this.now = this.end;
    this.pause();
  }

  clear() {
    this.run = null;
    this.now = 0;
    this.pause();
  }

  setSpeed(s: number) {
    this.speed = s;
    this.emit();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.listeners.clear();
  }

  private tick = (ts: number) => {
    const dt = Math.min(100, ts - this.last);
    this.last = ts;
    let next = this.now + (dt / MS_PER_UNIT) * this.speed;
    const events = this.run?.events ?? [];
    if (!busy(events, this.now)) {
      const upcoming = events.find((e) => e.t > this.now);
      if (upcoming && upcoming.t - this.now > 1.2) next = Math.max(next, upcoming.t - 0.8);
      else if (!upcoming && this.now > (this.run?.duration ?? 0) + 0.2) next = this.end;
    }
    this.now = Math.min(next, this.end);
    if (this.now >= this.end) {
      this.playing = false;
      this.emit();
      return;
    }
    this.emit();
    this.raf = requestAnimationFrame(this.tick);
  };
}

function busy(events: SimEvent[], now: number): boolean {
  for (const e of events) {
    if (e.t > now) break;
    if (e.type === "tx" && now < e.t + 1) return true;
    if ((e.type === "drop" || e.type === "deliver") && now < e.t + 0.6) return true;
  }
  return false;
}

export function usePlaybackInstance(): Playback {
  const p = useMemo(() => new Playback(), []);
  useEffect(() => () => p.dispose(), [p]);
  return p;
}

export function usePlaybackState(p: Playback) {
  return useSyncExternalStore(p.subscribe, p.getSnapshot);
}
