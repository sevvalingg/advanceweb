import { DataFrame } from '@grafana/data';
import { COLUMNS, TASKS, TaskId } from './columns';
import { AlertRow, Sample, lastValue, readAlerts, readNumbers, readStrings } from './readFrames';

/** One stretch of time the state machine spent in one state. */
export interface StateSegment {
  state: string;
  start: number;
  end: number;
}

export type TaskStatus = 'done' | 'current' | 'pending';

export interface TaskProgress {
  id: TaskId;
  status: TaskStatus;
}

export interface Detection {
  cls: string;
  conf: number | null;
  distance: number | null;
  t: number;
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
  tasks: { present: boolean; current: string | null; items: TaskProgress[]; doneCount: number };
  cameraFps: Reading;
  perceptionFps: Reading;
  latencyMs: Reading;
  detection: { present: boolean; last: Detection | null };
  alerts: AlertRow[] | undefined;
}

/** Consecutive samples with the same state become one segment. Empty cells do not end a segment. */
export function stateSegments(samples: Array<Sample<string>> | undefined): StateSegment[] {
  const segments: StateSegment[] = [];
  for (const { t, v } of samples ?? []) {
    const last = segments[segments.length - 1];
    if (last) {
      last.end = t;
    }
    if (v !== null && v !== last?.state) {
      segments.push({ state: v, start: t, end: t });
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
  const task = readStrings(series, COLUMNS.task);
  const tasksDone = readStrings(series, COLUMNS.tasksDone);
  const camera = readNumbers(series, COLUMNS.cameraFps);
  const perception = readNumbers(series, COLUMNS.perceptionFps);
  const latency = readNumbers(series, COLUMNS.perceptionLatency);
  const classes = readStrings(series, COLUMNS.detectionClass);
  const confs = readNumbers(series, COLUMNS.detectionConf);
  const distances = readNumbers(series, COLUMNS.detectionDistance);

  const segments = stateSegments(states);
  const lastDetection = lastValue(classes);
  const valueAt = (samples: Array<Sample<number>> | undefined, t: number) => samples?.find((s) => s.t === t)?.v ?? null;

  const allTimes = [states, task, camera, perception, latency, classes].flatMap((s) =>
    s && s.length ? [s[s.length - 1].t] : []
  );
  const currentTask = lastValue(task)?.v ?? null;
  const items = taskProgress(lastValue(tasksDone)?.v, currentTask);

  return {
    now: allTimes.length ? Math.max(...allTimes) : null,
    state: { present: states !== undefined, current: segments[segments.length - 1] ?? null, segments },
    tasks: {
      present: task !== undefined || tasksDone !== undefined,
      current: currentTask,
      items,
      doneCount: items.filter((i) => i.status === 'done').length,
    },
    cameraFps: reading(camera),
    perceptionFps: reading(perception),
    latencyMs: reading(latency),
    detection: {
      present: classes !== undefined,
      last: lastDetection
        ? {
            cls: lastDetection.v!,
            t: lastDetection.t,
            conf: valueAt(confs, lastDetection.t),
            distance: valueAt(distances, lastDetection.t),
          }
        : null,
    },
    alerts: readAlerts(series),
  };
}

/**
 * Times in the shared format are milliseconds since the start of the run; the data source may also
 * send wall-clock times (epoch ms). Values below year 2001 in epoch ms are treated as run time.
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
