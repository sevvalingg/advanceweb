// Column names of the shared AutoTrack CSV format (docs/data-format.md in the repository root).
// The panel finds every value by these names, so it works with any data source that uses them:
// the AutoTrack telemetry data source, or Grafana's TestData "CSV content" with a recorded run.

export const COLUMNS = {
  time: 'time_ms',
  state: 'state',
  task: 'task',
  tasksDone: 'tasks_done',
  cameraFps: 'camera_fps',
  perceptionFps: 'perception_fps',
  perceptionLatency: 'perception_latency_ms',
  detectionClass: 'detection_class',
  detectionConf: 'detection_conf',
  detectionDistance: 'detection_distance_m',
} as const;

export type ColumnId = (typeof COLUMNS)[keyof typeof COLUMNS];

/**
 * Other names the same value may have. The current data source labels its fields with readable
 * names (for example "Camera frames per second"), so those are accepted as well.
 */
export const ALIASES: Partial<Record<ColumnId, string[]>> = {
  camera_fps: ['Camera frames per second', 'Camera FPS'],
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

/** How each state of the decision engine is coloured: what kind of thing the car is doing. */
export type StateKind = 'driving' | 'waiting' | 'manoeuvre' | 'idle' | 'done' | 'unknown';

export const STATE_KINDS: Record<string, StateKind> = {
  FOLLOW_LANE: 'driving',
  STOP_SIGN: 'waiting',
  WAIT_LIGHT: 'waiting',
  YIELD_PEDESTRIAN: 'waiting',
  AVOID_OBSTACLE: 'manoeuvre',
  OVERTAKE: 'manoeuvre',
  ROAD_WORKS: 'manoeuvre',
  PARK: 'manoeuvre',
  IDLE: 'idle',
  MANUAL: 'idle',
  FINISHED: 'done',
};
