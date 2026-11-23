import { FieldType, createDataFrame } from '@grafana/data';
import { buildDebugState, formatTime, parseTaskList, stateSegments, taskProgress } from './debugState';
import { readColumn } from './readFrames';

// One frame in the shared CSV format, as Grafana's TestData "CSV content" produces it.
const csvFrame = createDataFrame({
  fields: [
    { name: 'time_ms', type: FieldType.number, values: [0, 100, 200, 300, 400] },
    { name: 'state', type: FieldType.string, values: ['IDLE', 'FOLLOW_LANE', 'FOLLOW_LANE', null, 'STOP_SIGN'] },
    {
      name: 'task',
      type: FieldType.string,
      values: ['lane_following', 'lane_following', 'traffic_sign', 'traffic_sign', 'traffic_sign'],
    },
    {
      name: 'tasks_done',
      type: FieldType.string,
      values: [null, null, 'lane_following', 'lane_following', 'lane_following'],
    },
    { name: 'perception_fps', type: FieldType.number, values: [16, 15.5, 12, 15.8, 16.1] },
    { name: 'perception_latency_ms', type: FieldType.number, values: [48, 50, 120, 52, 49] },
    { name: 'detection_class', type: FieldType.string, values: [null, null, 'sign_stop', '', null] },
    { name: 'detection_conf', type: FieldType.number, values: [null, null, 0.87, null, null] },
  ],
});

describe('stateSegments', () => {
  it('joins consecutive equal states and lets empty cells continue the current state', () => {
    const segments = stateSegments([
      { t: 0, v: 'IDLE' },
      { t: 100, v: 'FOLLOW_LANE' },
      { t: 200, v: 'FOLLOW_LANE' },
      { t: 300, v: null },
      { t: 400, v: 'STOP_SIGN' },
    ]);
    expect(segments).toEqual([
      { state: 'IDLE', start: 0, end: 100 },
      { state: 'FOLLOW_LANE', start: 100, end: 400 },
      { state: 'STOP_SIGN', start: 400, end: 400 },
    ]);
  });
});

describe('tasks', () => {
  it('ignores unknown and empty parts of tasks_done', () => {
    expect(parseTaskList('lane_following; ;flying;parking')).toEqual(['lane_following', 'parking']);
    expect(parseTaskList(null)).toEqual([]);
  });

  it('marks done, current and pending tasks in course order', () => {
    const items = taskProgress('lane_following', 'traffic_sign');
    expect(items.slice(0, 3).map((i) => i.status)).toEqual(['done', 'current', 'pending']);
    expect(items).toHaveLength(8);
  });
});

describe('buildDebugState', () => {
  const view = buildDebugState([csvFrame]);

  it('reads the current state and how long it lasted', () => {
    expect(view.state.current?.state).toBe('STOP_SIGN');
    expect(view.state.segments.map((s) => s.state)).toEqual(['IDLE', 'FOLLOW_LANE', 'STOP_SIGN']);
  });

  it('reads task progress from the last row', () => {
    expect(view.tasks.current).toBe('traffic_sign');
    expect(view.tasks.doneCount).toBe(1);
  });

  it('keeps the last detection, its confidence and the time since it', () => {
    expect(view.detection.last).toEqual({ cls: 'sign_stop', conf: 0.87, distance: null, t: 200 });
    expect(view.now).toBe(400);
  });

  it('reports a missing column instead of inventing a value', () => {
    expect(view.cameraFps).toEqual({ present: false, value: null });
    expect(view.perceptionFps).toEqual({ present: true, value: 16.1 });
    expect(view.alerts).toBeUndefined();
  });

  it('reads the alerts frame sent by the data source', () => {
    const alerts = createDataFrame({
      fields: [
        { name: 'time_ms', type: FieldType.number, values: [100, 300] },
        { name: 'level', type: FieldType.string, values: ['warning', 'critical'] },
        { name: 'message', type: FieldType.string, values: ['Lane lost', 'Connection lost'] },
      ],
    });
    expect(buildDebugState([csvFrame, alerts]).alerts?.map((a) => a.message)).toEqual(['Lane lost', 'Connection lost']);
  });
});

describe('readColumn', () => {
  it('finds a field by the readable label the current data source uses', () => {
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

  it('keeps 0 as a value and turns empty cells into null', () => {
    const frame = createDataFrame({
      fields: [
        { name: 'time_ms', type: FieldType.number, values: [0, 100] },
        { name: 'camera_fps', type: FieldType.number, values: [0, null] },
      ],
    });
    expect(readColumn([frame], 'camera_fps')).toEqual([
      { t: 0, v: 0 },
      { t: 100, v: null },
    ]);
  });
});

describe('formatTime', () => {
  it('shows run time as mm:ss.s', () => {
    expect(formatTime(0)).toBe('00:00.0');
    expect(formatTime(75300)).toBe('01:15.3');
  });
});
