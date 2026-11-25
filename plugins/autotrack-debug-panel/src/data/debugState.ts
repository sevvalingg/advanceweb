import { DataFrame } from '@grafana/data';
import { COLUMNS, TASKS, TaskId } from './columns';
import { AlertRow, Sample, lastValue, readAlerts, readNumbers, readStrings } from './readFrames';

/** One stretch of time the decision node spent in one state, and the reasons it gave when it entered it. */
export interface StateSegment {
  state: string;
  start: number;
  end: number;
  reasons: string[];
}

export type TaskStatus = 'done' | 'current' | 'pending';

export interface TaskProgress {
  id: TaskId;
  status: TaskStatus;
}

/** One object in a `detections` cell. */
export interface DetectionItem {
  cls: string;
  conf: number | null;
}

export interface Detection extends DetectionItem {
  t: number;
  /** All objects detected in that frame, most confident first. */
  all: DetectionItem[];
}

/** A value and whether the column exists in the data at all. */
export interface Reading {
  present: boolean;
  value: number | null;
}

/** Everything the panel shows, computed from the data frames without React. */
export interface DebugState {
  /** Time of the newest sample in the data; "ago" values are measured from here. */
  now: number | null;
  state: { present: boolean; current: StateSegment | null; segments: StateSegment[] };
  reasons: { present: boolean; current: string[] };
  tasks: { present: boolean; current: string | null; items: TaskProgress[]; doneCount: number };
  cameraFps: Reading;
  detectionsFps: Reading;
  latencyMs: Reading;
  detection: { present: boolean; last: Detection | null };
  alerts: AlertRow[] | undefined;
}

/** `engel yaklasiyor; serit kayip (0.9 sn)` → two reasons. */
export function parseReasons(text: string | null | undefined): string[] {
  return (text ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * `sign_stop:0.95 light_red:0.80` → two detections, most confident first. Objects are separated by
 * spaces in telemetry_node's CSV; `;` and `,` are accepted too, so either way of writing it works.
 */
export function parseDetections(text: string | null | undefined): DetectionItem[] {
  return (text ?? '')
    .split(/[\s;,]+/)
    .filter(Boolean)
    .map((part) => {
      const [cls, conf] = part.split(':');
      const value = conf === undefined ? NaN : Number(conf);
      return { cls, conf: Number.isFinite(value) ? value : null };
    })
    .sort((a, b) => (b.conf ?? -1) - (a.conf ?? -1));
}

/**
 * Consecutive samples with the same state become one segment. Empty cells do not end a segment.
 * Each segment keeps the reasons written in the row where it started.
 */
export function stateSegments(
  samples: Array<Sample<string>> | undefined,
  reasons?: Array<Sample<string>>
): StateSegment[] {
  const reasonAt = new Map((reasons ?? []).map((r) => [r.t, r.v]));
  const segments: StateSegment[] = [];
  for (const { t, v } of samples ?? []) {
    const last = segments[segments.length - 1];
    if (last) {
      last.end = t;
    }
    if (v !== null && v !== last?.state) {
      segments.push({ state: v, start: t, end: t, reasons: parseReasons(reasonAt.get(t)) });
    }
  }
  return segments;
}

/** Splits `lane_following;traffic_sign` into known task ids, ignoring unknown or empty parts. */
export function parseTaskList(text: string | null | undefined): TaskId[] {
  if (!text) {
    return [];
  }
  return text
    .split(';')
    .map((part) => part.trim())
    .filter((part): part is TaskId => (TASKS as readonly string[]).includes(part));
}

export function taskProgress(doneText: string | null | undefined, current: string | null | undefined): TaskProgress[] {
  const done = new Set(parseTaskList(doneText));
  return TASKS.map((id) => ({
    id,
    status: done.has(id) ? 'done' : id === current ? 'current' : 'pending',
  }));
}

function reading(samples: Array<Sample<number>> | undefined): Reading {
  return { present: samples !== undefined, value: lastValue(samples)?.v ?? null };
}

export function buildDebugState(series: DataFrame[]): DebugState {
  const states = readStrings(series, COLUMNS.state);
  const reasons = readStrings(series, COLUMNS.reasons);
  const task = readStrings(series, COLUMNS.task);
  const tasksDone = readStrings(series, COLUMNS.tasksDone);
  const camera = readNumbers(series, COLUMNS.cameraFps);
  const detectionsFps = readNumbers(series, COLUMNS.detectionsFps);
  const latency = readNumbers(series, COLUMNS.detectionLatency);
  const detections = readStrings(series, COLUMNS.detections);

  const segments = stateSegments(states, reasons);
  const lastDetection = lastValue(detections);
  const detected = parseDetections(lastDetection?.v);

  const allTimes = [states, reasons, task, camera, detectionsFps, latency, detections].flatMap((s) =>
    s && s.length ? [s[s.length - 1].t] : []
  );
  const currentTask = lastValue(task)?.v ?? null;
  const items = taskProgress(lastValue(tasksDone)?.v, currentTask);
  const lastRow = reasons?.[reasons.length - 1];

  return {
    now: allTimes.length ? Math.max(...allTimes) : null,
    state: { present: states !== undefined, current: segments[segments.length - 1] ?? null, segments },
    // Reasons of the newest row: an empty cell there means the decision node gave no reason right now.
    reasons: { present: reasons !== undefined, current: parseReasons(lastRow?.v) },
    tasks: {
      present: task !== undefined || tasksDone !== undefined,
      current: currentTask,
      items,
      doneCount: items.filter((i) => i.status === 'done').length,
    },
    cameraFps: reading(camera),
    detectionsFps: reading(detectionsFps),
    latencyMs: reading(latency),
    detection: {
      present: detections !== undefined,
      last: lastDetection && detected.length ? { ...detected[0], t: lastDetection.t, all: detected } : null,
    },
    alerts: readAlerts(series),
  };
}

/**
 * Times are milliseconds since the start of the run (t_s × 1000) or, from the data source, wall-clock
 * times (epoch ms). Anything below year 2001 in epoch ms is treated as run time.
 */
export function formatTime(t: number): string {
  if (t > 1e12) {
    return new Date(t).toLocaleTimeString([], { hour12: false });
  }
  const totalSeconds = t / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds - minutes * 60).toFixed(1).padStart(4, '0');
  return `${String(minutes).padStart(2, '0')}:${seconds}`;
}

export function formatDuration(ms: number): string {
  return ms < 60000
    ? `${(ms / 1000).toFixed(1)} s`
    : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`;
}
