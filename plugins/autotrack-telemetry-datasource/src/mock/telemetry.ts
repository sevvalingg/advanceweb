import { TelemetryTopic } from '../types';

const SPEED_LIMIT_MS = 1.0; // NFR-04 software speed limit
const MAX_STEER_RAD = 0.34;
const LAP_S = 20; // one simulated lap
const STOP_CYCLE_S = 60; // a short stop every minute (e.g. red light)
const STOP_DURATION_S = 6;
const BATTERY_CYCLE_S = 30 * 60; // one simulated discharge cycle

/** Deterministic pseudo-noise in [-1, 1]: same timestamp always gives the same value. */
function noise(t: number, seed: number): number {
  const x = Math.sin(t * 12.9898 + seed * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function speedAt(t: number): number {
  if (t % STOP_CYCLE_S > STOP_CYCLE_S - STOP_DURATION_S) {
    return 0;
  }
  const v = 0.65 + 0.25 * Math.sin((2 * Math.PI * t) / LAP_S) + 0.03 * noise(t, 1);
  return clamp(v, 0, SPEED_LIMIT_MS);
}

function steeringDegAt(t: number): number {
  const rad = 0.22 * Math.sin((2 * Math.PI * t) / (LAP_S / 2)) + 0.02 * noise(t, 2);
  return (clamp(rad, -MAX_STEER_RAD, MAX_STEER_RAD) * 180) / Math.PI;
}

function discharge(t: number, full: number, empty: number): number {
  const progress = (t % BATTERY_CYCLE_S) / BATTERY_CYCLE_S;
  return full - (full - empty) * progress;
}

export function mockValue(topic: TelemetryTopic, timeMs: number): number {
  const t = timeMs / 1000;
  switch (topic) {
    case 'speed':
      return speedAt(t);
    case 'steering':
      return steeringDegAt(t);
    case 'battery_4s':
      return discharge(t, 16.6, 15.0) + 0.02 * noise(t, 3);
    case 'battery_3s':
      // Motor pack: voltage sags under load
      return discharge(t, 12.5, 11.4) - 0.15 * speedAt(t) + 0.02 * noise(t, 4);
  }
}

export function generateSeries(topic: TelemetryTopic, from: number, to: number, stepMs: number) {
  const times: number[] = [];
  const values: number[] = [];
  const start = Math.ceil(from / stepMs) * stepMs;
  for (let ts = start; ts <= to; ts += stepMs) {
    times.push(ts);
    values.push(mockValue(topic, ts));
  }
  return { times, values };
}   