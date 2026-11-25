import { FieldType, createDataFrame } from '@grafana/data';
import {
  buildDebugState,
  formatTime,
  parseDetections,
  parseReasons,
  parseTaskList,
  stateSegments,
  taskProgress,
} from './debugState';
import { readColumn } from './readFrames';

// Rows in telemetry_node's format, as Grafana's TestData "CSV content" turns them into a frame.
const run = createDataFrame({
  fields: [
    { name: 't_s', type: FieldType.number, values: [745.0, 745.1, 745.2, 745.3, 745.4] },
    { name: 'state', type: FieldType.string, values: ['DRIVE', 'DRIVE', null, 'STOP', 'STOP'] },
    {
      name: 'reasons',
      type: FieldType.string,
      values: ['yol acik', 'yol acik', 'yol acik', 'dur levhasi', 'dur levhasi; serit kayip (0.9 sn)'],
    },
    { name: 'detections', type: FieldType.string, values: [null, 'sign_stop:0.62', 'sign_stop:0.95', null, null] },
    { name: 'camera_fps', type: FieldType.number, values: [null, null, null, null, null] },
    { name: 'detections_fps', type: FieldType.number, values: [15, 14, 9, 15, 14] },
    { name: 'detection_latency_ms', type: FieldType.number, values: [86.3, 87.4, 140.2, 90.1, 88.8] },
  ],
});

describe('parsing cells', () => {
  it('splits reasons at ";"', () => {
    expect(parseReasons('engel yaklasiyor; serit kayip (0.9 sn)')).toEqual([
      'engel yaklasiyor',
      'serit kayip (0.9 sn)',
    ]);
    expect(parseReasons('')).toEqual([]);
  });

  it('reads several detections, most confident first, separated by spaces or ";"', () => {
    const expected = [
      { cls: 'light_red', conf: 0.9 },
      { cls: 'sign_stop', conf: 0.62 },
    ];
    expect(parseDetections('sign_stop:0.62 light_red:0.9')).toEqual(expected);
    expect(parseDetections('sign_stop:0.62;light_red:0.9')).toEqual(expected);
    expect(parseDetections('pedestrian')).toEqual([{ cls: 'pedestrian', conf: null }]);
    expect(parseDetections(null)).toEqual([]);
  });
});

describe('stateSegments', () => {
  it('joins equal states, lets empty cells continue a state and keeps the reasons of its first row', () => {
    const segments = stateSegments(
      [
        { t: 0, v: 'DRIVE' },
        { t: 100, v: null },
        { t: 200, v: 'STOP' },
      ],
      [
        { t: 0, v: 'yol acik' },
        { t: 100, v: 'yol acik' },
        { t: 200, v: 'dur levhasi' },
      ]
    );
    expect(segments).toEqual([
      { state: 'DRIVE', start: 0, end: 200, reasons: ['yol acik'] },
      { state: 'STOP', start: 200, end: 200, reasons: ['dur levhasi'] },
    ]);
  });
});

describe('tasks', () => {
  it('ignores unknown and empty parts of tasks_done', () => {
    expect(parseTaskList('lane_following; ;flying;parking')).toEqual(['lane_following', 'parking']);
  });

  it('marks done, current and pending tasks in course order', () => {
    const items = taskProgress('lane_following', 'traffic_sign');
    expect(items.slice(0, 3).map((i) => i.status)).toEqual(['done', 'current', 'pending']);
    expect(items).toHaveLength(8);
  });
});

describe('buildDebugState', () => {
  const view = buildDebugState([run]);

  it('reads t_s in seconds as milliseconds since the start of the run', () => {
    expect(view.now).toBe(745400);
  });

  it('reads the current state, how long it lasted and why', () => {
    expect(view.state.current).toEqual({ state: 'STOP', start: 745300, end: 745400, reasons: ['dur levhasi'] });
    expect(view.reasons.current).toEqual(['dur levhasi', 'serit kayip (0.9 sn)']);
  });

  it('keeps the last detection with its confidence and time', () => {
    expect(view.detection.last).toEqual({
      cls: 'sign_stop',
      conf: 0.95,
      t: 745200,
      all: [{ cls: 'sign_stop', conf: 0.95 }],
    });
  });

  it('reads detection FPS and latency, and an empty camera column as present but without a value', () => {
    expect(view.detectionsFps).toEqual({ present: true, value: 14 });
    expect(view.latencyMs).toEqual({ present: true, value: 88.8 });
    expect(view.cameraFps).toEqual({ present: true, value: null });
  });

  it('reports columns that telemetry_node does not write as missing', () => {
    expect(view.tasks.present).toBe(false);
    expect(view.alerts).toBeUndefined();
  });

  it('reads the alerts frame sent by the data source', () => {
    const alerts = createDataFrame({
      fields: [
        { name: 't_s', type: FieldType.number, values: [745.1, 745.3] },
        { name: 'level', type: FieldType.string, values: ['warning', 'critical'] },
        { name: 'message', type: FieldType.string, values: ['Lane lost', 'Low battery'] },
      ],
    });
    expect(buildDebugState([run, alerts]).alerts).toEqual([
      { t: 745100, level: 'warning', message: 'Lane lost' },
      { t: 745300, level: 'critical', message: 'Low battery' },
    ]);
  });
});

describe('readColumn', () => {
  it('finds a field by the readable label the current data source uses, with epoch-ms time', () => {
    const frame = createDataFrame({
      name: 'Camera frames per second',
      fields: [
        { name: 'Time', type: FieldType.time, values: [1000, 2000] },
        { name: 'Camera frames per second', type: FieldType.number, values: [15, 0] },
      ],
    });
    expect(readColumn([frame], 'camera_fps')).toEqual([
      { t: 1000, v: 15 },
      { t: 2000, v: 0 },
    ]);
  });

  it('accepts the column names of the first format draft', () => {
    const frame = createDataFrame({
      fields: [
        { name: 'time_ms', type: FieldType.number, values: [0, 100] },
        { name: 'perception_fps', type: FieldType.number, values: [0, null] },
      ],
    });
    expect(readColumn([frame], 'detections_fps')).toEqual([
      { t: 0, v: 0 },
      { t: 100, v: null },
    ]);
  });
});

describe('formatTime', () => {
  it('shows run time as mm:ss.s', () => {
    expect(formatTime(0)).toBe('00:00.0');
    expect(formatTime(745300)).toBe('12:25.3');
  });
});
