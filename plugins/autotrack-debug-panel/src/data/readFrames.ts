import { DataFrame, Field, FieldType } from '@grafana/data';
import { ALIASES, ColumnId, TIME_COLUMNS } from './columns';

/** One value of a column at one moment. `v` is null when the cell was empty ("no data"). */
export interface Sample<T> {
  t: number;
  v: T | null;
}

/** Compare names without case, spaces, underscores or punctuation: "Camera FPS" ~ "camera_fps". */
export function normalise(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function namesOf(field: Field, frame: DataFrame): string[] {
  const names = [field.name, field.config?.displayName ?? ''];
  // A frame with one value field (one topic per frame) may only carry the topic in its own name.
  const valueFields = frame.fields.filter((f) => f.type !== FieldType.time);
  if (valueFields.length === 1) {
    names.push(frame.name ?? '', frame.refId ?? '');
  }
  return names.filter(Boolean).map(normalise);
}

function matches(field: Field, frame: DataFrame, column: ColumnId): boolean {
  const wanted = [column, ...(ALIASES[column] ?? [])].map(normalise);
  return namesOf(field, frame).some((name) => wanted.includes(name));
}

interface TimeAxis {
  field: Field;
  toMs: number;
}

/**
 * The time axis of a frame, in milliseconds: `t_s` (seconds, as telemetry_node writes it) or `time_ms`
 * if there is one, else the first time field (epoch ms, as the AutoTrack data source sends it).
 */
function timeAxis(frame: DataFrame): TimeAxis | undefined {
  for (const { name, toMs } of TIME_COLUMNS) {
    const field = frame.fields.find((f) => normalise(f.name) === normalise(name));
    if (field) {
      return { field, toMs };
    }
  }
  const field = frame.fields.find((f) => f.type === FieldType.time);
  return field ? { field, toMs: 1 } : undefined;
}

function timeAt(axis: TimeAxis, i: number): number {
  // Rounded so that 730.1 s becomes 730100 ms exactly, and samples of two columns can be matched by time.
  return Math.round(Number(axis.field.values[i]) * axis.toMs);
}

function clean(value: unknown): number | string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const text = String(value).trim();
  return text === '' ? null : text;
}

/**
 * All samples of one column, from whichever frame has it, sorted by time.
 * Returns undefined when no frame has the column, so the panel can say "not in this data"
 * instead of showing an empty value as if it were real.
 */
export function readColumn(series: DataFrame[], column: ColumnId): Array<Sample<number | string>> | undefined {
  for (const frame of series) {
    const time = timeAxis(frame);
    const field = frame.fields.find((f) => f !== time?.field && matches(f, frame, column));
    if (!field || !time) {
      continue;
    }
    const samples: Array<Sample<number | string>> = [];
    for (let i = 0; i < frame.length; i++) {
      const t = timeAt(time, i);
      if (Number.isFinite(t)) {
        samples.push({ t, v: clean(field.values[i]) });
      }
    }
    return samples.sort((a, b) => a.t - b.t);
  }
  return undefined;
}

export function readNumbers(series: DataFrame[], column: ColumnId): Array<Sample<number>> | undefined {
  return readColumn(series, column)?.map(({ t, v }) => ({ t, v: typeof v === 'number' ? v : toNumber(v) }));
}

export function readStrings(series: DataFrame[], column: ColumnId): Array<Sample<string>> | undefined {
  return readColumn(series, column)?.map(({ t, v }) => ({ t, v: v === null ? null : String(v) }));
}

function toNumber(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Last sample that has a value. */
export function lastValue<T>(samples: Array<Sample<T>> | undefined): Sample<T> | undefined {
  if (!samples) {
    return undefined;
  }
  for (let i = samples.length - 1; i >= 0; i--) {
    if (samples[i].v !== null) {
      return samples[i];
    }
  }
  return undefined;
}

export interface AlertRow {
  t: number;
  level: string;
  message: string;
}

/**
 * Alerts sent by the data source as their own frame with `level` and `message` fields
 * (docs/data-format.md). Returns undefined when no such frame exists.
 */
export function readAlerts(series: DataFrame[]): AlertRow[] | undefined {
  for (const frame of series) {
    const level = frame.fields.find((f) => normalise(f.name) === 'level');
    const message = frame.fields.find((f) => normalise(f.name) === 'message');
    const time = timeAxis(frame);
    if (!level || !message || !time) {
      continue;
    }
    const rows: AlertRow[] = [];
    for (let i = 0; i < frame.length; i++) {
      const msg = clean(message.values[i]);
      if (msg !== null) {
        rows.push({ t: timeAt(time, i), level: String(clean(level.values[i]) ?? 'info'), message: String(msg) });
      }
    }
    return rows.sort((a, b) => a.t - b.t);
  }
  return undefined;
}
