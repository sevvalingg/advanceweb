/**
 * Loads a run recorded by AutoTrack's telemetry_node (run_*.csv, one row every 100 ms)
 * into the same shape as the JSON runs made by tools/bag_to_json.py, so server.ts can
 * replay either format.
 *
 * CSV conventions (see data/23kasim/README.md):
 *   - an empty cell means "no data", not 0
 *   - steering_cmd is in rad, + = left; it is converted to degrees like the JSON runs
 *   - lateral_error_m: + = lane centre is to the RIGHT of the car
 */

export type Point = [number, number];

export interface Run {
  source: string;
  recorded_at: string;
  duration_ms: number;
  series: Record<string, Point[]>;
}

/** Numeric state codes, so the state machine can be drawn as a line or a state timeline. */
export const STATE_CODES: Record<string, number> = {
  STOP: 0,
  DRIVE: 1,
  SLOW_DOWN: 2,
  MANUAL_OVERRIDE: 3,
};
export const STATE_UNKNOWN = -1;

type Column = { topic: string; convert?: (v: number) => number };

/** CSV column -> server topic. Columns not listed here are not exposed as numbers. */
const NUMERIC_COLUMNS: Record<string, Column> = {
  speed_cmd: { topic: 'speed_cmd' },
  speed_out: { topic: 'speed_out' },
  steering_cmd: { topic: 'steering_cmd', convert: (rad) => (rad * 180) / Math.PI },
  manual: { topic: 'manual_active' },
  lateral_error_m: { topic: 'lateral_error_m' },
  heading_error_rad: { topic: 'heading_error_rad' },
  line_count: { topic: 'line_count' },
  odom_speed_mps: { topic: 'odom_speed_mps' },
  camera_fps: { topic: 'camera_fps' },
  lane_fps: { topic: 'lane_fps' },
  detections_fps: { topic: 'detections_fps' },
  detection_latency_ms: { topic: 'detection_latency_ms' },
};

function round(v: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** Splits one CSV line, honouring double quotes ("a, b" stays one cell). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function num(cell: string | undefined): number | null {
  if (cell === undefined || cell.trim() === '') {
    return null;
  }
  const v = Number(cell);
  return Number.isFinite(v) ? v : null;
}

/**
 * Parses telemetry CSV text. `source` names the run, `recordedAt` is an ISO time
 * (the CSV itself only has seconds since the start of the recording).
 */
export function parseTelemetryCsv(text: string, source: string, recordedAt = new Date(0).toISOString()): Run {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) {
    throw new Error('CSV is empty');
  }
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const tIdx = col('t_s');
  if (tIdx < 0) {
    throw new Error("CSV has no 't_s' column; is this a telemetry_node run?");
  }

  const series: Record<string, Point[]> = {};
  const push = (topic: string, t: number, v: number) => (series[topic] ??= []).push([t, round(v)]);

  let t0: number | null = null;
  let lastT = 0;
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const ts = num(cells[tIdx]);
    if (ts === null) {
      continue;
    }
    t0 ??= ts;
    const t = Math.round((ts - t0) * 1000);
    lastT = t;

    for (const [name, spec] of Object.entries(NUMERIC_COLUMNS)) {
      const i = col(name);
      const v = i < 0 ? null : num(cells[i]);
      if (v !== null) {
        push(spec.topic, t, spec.convert ? spec.convert(v) : v);
      }
    }

    // Obstacle distance only while the LiDAR reading is valid (as obstacle_front in the JSON runs).
    const obs = num(cells[col('obstacle_m')]);
    const valid = num(cells[col('obstacle_valid')]);
    if (obs !== null && valid === 1) {
      push('obstacle_front', t, obs);
    }

    const state = (cells[col('state')] ?? '').trim();
    if (state !== '') {
      push('state_code', t, STATE_CODES[state] ?? STATE_UNKNOWN);
    }

    const lines_ = num(cells[col('line_count')]);
    if (lines_ !== null) {
      push('lane_lost', t, lines_ === 0 ? 1 : 0);
    }

    const det = (cells[col('detections')] ?? '').trim();
    push('detection_count', t, det === '' ? 0 : det.split(/\s+/).length);
  }

  return { source, recorded_at: recordedAt, duration_ms: Math.max(lastT, 100), series };
}
