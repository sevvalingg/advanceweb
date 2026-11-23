// Generates a synthetic 60-second course run in the shared CSV format (docs/data-format.md) so the
// debug panel can be developed and demonstrated without the car. It also embeds the CSV into the
// provisioned dashboard, where Grafana's TestData "CSV content" query serves it to the panel.
//
// The run is invented: it goes through all 8 course tasks once, with a frame-rate dip, a latency spike
// and a short lane loss. Replace it with real recordings once the car publishes these topics.
//
// Usage: node scripts/make-sample-run.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const STEP_MS = 100;
const DURATION_MS = 60_000;

// Deterministic noise, so the generated file only changes when this script changes.
let seed = 20261123;
const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const noise = (amount) => (random() * 2 - 1) * amount;
const round = (value, digits) => {
  if (value === null) {
    return '';
  }
  const r = Number(value.toFixed(digits));
  return (r === 0 ? 0 : r).toFixed(digits); // never write "-0.0"
};

// [start s, end s, state, task worked on, task finished at the end of the segment]
const SCRIPT = [
  [0, 2, 'IDLE', 'lane_following', null],
  [2, 10, 'FOLLOW_LANE', 'lane_following', 'lane_following'],
  [10, 11, 'FOLLOW_LANE', 'traffic_sign', null],
  [11, 14, 'STOP_SIGN', 'traffic_sign', 'traffic_sign'],
  [14, 18, 'FOLLOW_LANE', 'traffic_light', null],
  [18, 22, 'WAIT_LIGHT', 'traffic_light', 'traffic_light'],
  [22, 26, 'FOLLOW_LANE', 'pedestrian', null],
  [26, 29, 'YIELD_PEDESTRIAN', 'pedestrian', 'pedestrian'],
  [29, 33, 'FOLLOW_LANE', 'obstacle', null],
  [33, 37, 'AVOID_OBSTACLE', 'obstacle', 'obstacle'],
  [37, 41, 'OVERTAKE', 'overtaking', 'overtaking'],
  [41, 47, 'ROAD_WORKS', 'road_works', 'road_works'],
  [47, 56, 'PARK', 'parking', 'parking'],
  [56, 60, 'FINISHED', '', null],
];

// [start s, end s, class, distance at start m, distance at end m]
const DETECTIONS = [
  [8.5, 11.5, 'sign_stop', 1.6, 0.4],
  [16.5, 21.5, 'light_red', 1.5, 0.5],
  [21.5, 23, 'light_green', 0.5, 0.3],
  [24.5, 28.5, 'pedestrian', 1.4, 0.6],
];

const SPEED = {
  IDLE: 0,
  FOLLOW_LANE: 0.6,
  STOP_SIGN: 0,
  WAIT_LIGHT: 0,
  YIELD_PEDESTRIAN: 0,
  AVOID_OBSTACLE: 0.4,
  OVERTAKE: 0.8,
  ROAD_WORKS: 0.35,
  PARK: 0.25,
  FINISHED: 0,
};

const COLUMNS = [
  'time_ms',
  'speed_mps',
  'speed_cmd_mps',
  'steering_deg',
  'manual_active',
  'battery_motor_v',
  'lidar_hz',
  'camera_fps',
  'obstacle_front_m',
  'lane_detected',
  'lateral_error_m',
  'heading_error_deg',
  'lane_left_m',
  'lane_right_m',
  'detection_class',
  'detection_conf',
  'detection_distance_m',
  'perception_fps',
  'perception_latency_ms',
  'state',
  'task',
  'tasks_done',
];

const rows = [COLUMNS.join(',')];
let speed = 0;
for (let t = 0; t < DURATION_MS; t += STEP_MS) {
  const s = t / 1000;
  const segmentIndex = SCRIPT.findIndex(([a, b]) => s >= a && s < b);
  const [, , state, task] = SCRIPT[segmentIndex];
  const done = SCRIPT.slice(0, segmentIndex).flatMap(([, , , , finished]) => (finished ? [finished] : []));

  const target = SPEED[state];
  const speedCmd = target;
  speed += (target - speed) * 0.25; // the car follows the command with some delay
  let steering = 4 * Math.sin(s * 0.9) + noise(0.8);
  if (state === 'OVERTAKE') {
    steering = 18 * Math.sin(((s - 37) / 4) * 2 * Math.PI);
  }
  if (state === 'PARK') {
    steering = -20 * Math.sin(((s - 47) / 9) * Math.PI);
  }

  const laneLost = s >= 43 && s < 44.6;
  const lateral = laneLost
    ? null
    : 0.03 * Math.sin(s * 0.7) +
      noise(0.01) +
      (state === 'OVERTAKE' ? 0.12 * Math.sin(((s - 37) / 4) * 2 * Math.PI) : 0);
  const heading = laneLost ? null : 2.5 * Math.cos(s * 0.7) + noise(0.5);
  const half = 0.2;

  const det = DETECTIONS.find(([a, b]) => s >= a && s < b);
  const detDistance = det ? det[3] + ((s - det[0]) / (det[1] - det[0])) * (det[4] - det[3]) : null;

  const obstacle =
    state === 'FOLLOW_LANE' && task === 'obstacle'
      ? 2.2 - (s - 29) * 0.4
      : state === 'AVOID_OBSTACLE'
        ? 0.6 + noise(0.05)
        : null;
  const fpsDip = s >= 30 && s < 34.5; // heavy load while the obstacle is tracked
  const perceptionFps = (fpsDip ? 12 : 16) + noise(0.6);
  const latency = (s >= 31 && s < 31.6 ? 125 : fpsDip ? 78 : 50) + noise(4);

  rows.push(
    [
      t,
      round(Math.max(0, speed + noise(0.02)), 2),
      round(speedCmd, 2),
      round(steering, 1),
      0,
      round(12.45 - (s / 60) * 0.8 - 0.15 * speed + noise(0.01), 2),
      round(10 + noise(0.1), 1),
      round(15 + noise(0.2), 1),
      obstacle === null ? '' : round(obstacle, 2),
      laneLost ? 0 : 1,
      round(lateral, 3),
      round(heading, 1),
      laneLost ? '' : round(half + (lateral ?? 0), 3),
      laneLost ? '' : round(half - (lateral ?? 0), 3),
      det ? det[2] : '',
      det ? round(0.82 + noise(0.08), 2) : '',
      det ? round(detDistance, 2) : '',
      round(perceptionFps, 1),
      round(latency, 0),
      state,
      task,
      done.join(';'),
    ].join(',')
  );
}

const alerts = ['time_ms,level,message', '43500,warning,Lane lost for 0.5 s'];

mkdirSync(new URL('provisioning/data/', root), { recursive: true });
const runCsv = rows.join('\n') + '\n';
const alertsCsv = alerts.join('\n') + '\n';
writeFileSync(new URL('provisioning/data/sample_run.csv', root), runCsv);
writeFileSync(new URL('provisioning/data/sample_alerts.csv', root), alertsCsv);

// Put the CSVs into the dashboard's TestData queries.
const dashboardUrl = new URL('provisioning/dashboards/dashboard.json', root);
const dashboard = JSON.parse(readFileSync(dashboardUrl, 'utf8'));
for (const panel of dashboard.panels) {
  for (const target of panel.targets ?? []) {
    if (target.refId === 'run') {
      target.csvContent = runCsv;
    }
    if (target.refId === 'alerts') {
      target.csvContent = alertsCsv;
    }
  }
}
writeFileSync(dashboardUrl, JSON.stringify(dashboard, null, 2) + '\n');

console.log(
  `Wrote ${rows.length - 1} rows (${DURATION_MS / 1000} s at ${1000 / STEP_MS} Hz) and ${alerts.length - 1} alert.`
);
