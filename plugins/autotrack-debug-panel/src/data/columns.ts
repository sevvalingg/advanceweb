// Column names of the AutoTrack telemetry CSV (docs/data-format.md in the repository root). They are
// the columns that AutoTrack's telemetry_node writes on the car, so a run recorded on the track can be
// shown without converting it. The panel finds every value by these names, so it works with any data
// source that uses them: the AutoTrack telemetry data source, or Grafana's TestData "CSV content".

export const COLUMNS = {
  state: 'state',
  reasons: 'reasons',
  cameraFps: 'camera_fps',
  detectionsFps: 'detections_fps',
  detectionLatency: 'detection_latency_ms',
  detections: 'detections',
  // Not written by telemetry_node yet; shown when a data source provides them.
  task: 'task',
  tasksDone: 'tasks_done',
} as const;

export type ColumnId = (typeof COLUMNS)[keyof typeof COLUMNS];

/** Time columns, in order of preference, and how many milliseconds one unit is. */
export const TIME_COLUMNS: Array<{ name: string; toMs: number }> = [
  { name: 't_s', toMs: 1000 }, // telemetry_node: seconds since the start of the run
  { name: 'time_ms', toMs: 1 },
];

/**
 * Other names the same value may have: the first draft of the shared format, and the readable
 * labels the current data source gives its fields (for example "Camera frames per second").
 */
export const ALIASES: Partial<Record<ColumnId, string[]>> = {
  camera_fps: ['Camera frames per second', 'Camera FPS'],
  detections_fps: ['perception_fps'],
  detection_latency_ms: ['perception_latency_ms'],
  detections: ['detection_class'],
};

/** The 8 course tasks, in course order. */
export const TASKS = [
  'lane_following',
  'traffic_sign',
  'traffic_light',
  'pedestrian',
  'obstacle',
  'overtaking',
  'parking',
  'road_works',
] as const;

export type TaskId = (typeof TASKS)[number];

export const TASK_LABELS: Record<TaskId, string> = {
  lane_following: 'Lane following',
  traffic_sign: 'Traffic sign',
  traffic_light: 'Traffic light',
  pedestrian: 'Pedestrian',
  obstacle: 'Obstacle',
  overtaking: 'Overtaking',
  parking: 'Parking',
  road_works: 'Road works',
};

/** Detection classes, same order as configs/classes.txt in the AutoTrack AI repository. */
export const DETECTION_LABELS: Record<string, string> = {
  sign_stop: 'Stop sign',
  sign_pedestrian_crossing: 'Pedestrian crossing sign',
  sign_speed_limit: 'Speed limit sign',
  light_red: 'Red light',
  light_yellow: 'Yellow light',
  light_green: 'Green light',
  pedestrian: 'Pedestrian',
};

/** How each state of the decision node is coloured: what kind of thing the car is doing. */
export type StateKind = 'driving' | 'slow' | 'stopped' | 'manual' | 'unknown';

export const STATE_KINDS: Record<string, StateKind> = {
  DRIVE: 'driving',
  SLOW_DOWN: 'slow',
  STOP: 'stopped',
  MANUAL_OVERRIDE: 'manual',
};
