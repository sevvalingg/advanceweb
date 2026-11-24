// deno test --allow-read telemetry_csv_test.ts
import assert from 'node:assert/strict';

const assertEquals = (a: unknown, b: unknown) => assert.deepEqual(a, b);
const assertAlmostEquals = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const assertThrows = (fn: () => unknown, _e: unknown, msg: string) => assert.throws(fn, (err: Error) => err.message.includes(msg));
import { parseTelemetryCsv, splitCsvLine, STATE_CODES } from './telemetry_csv.ts';

const HEADER =
  't_s,state,reasons,manual,speed_cmd,steering_cmd,speed_out,lateral_error_m,heading_error_rad,line_count,' +
  'obstacle_m,obstacle_valid,detections,odom_speed_mps,camera_fps,lane_fps,detections_fps,detection_latency_ms';

const CSV = [
  HEADER,
  '745.0,DRIVE,yol acik,0,0.3,-0.0263,0.3,0.018,-0.0214,2,10.0,1,,0.0,,15.0,15.0,86.2834',
  '745.1,SLOW_DOWN,engel yaklasiyor; serit kayip (0.5 sn),0,0.15,0.1745,0.15,,,0,0.9,1,sign_stop:0.95,,,14.0,15.0,',
  '745.2,STOP,dur levhasi,1,0.0,0.0,0.0,-0.1,0.0,1,0.8,0,sign_stop:0.95 light_red:0.80,0.864,,14.0,15.0,90.1',
].join('\r\n');

Deno.test('times start at 0 ms and follow t_s', () => {
  const run = parseTelemetryCsv(CSV, 'test.csv');
  assertEquals(run.series.speed_cmd.map((p) => p[0]), [0, 100, 200]);
  assertEquals(run.duration_ms, 200);
  assertEquals(run.source, 'test.csv');
});

Deno.test('empty cells are skipped, not read as 0', () => {
  const run = parseTelemetryCsv(CSV, 't');
  assertEquals(run.series.lateral_error_m.map((p) => p[0]), [0, 200]);
  assertEquals(run.series.camera_fps, undefined); // column always empty
  assertEquals(run.series.detection_latency_ms.map((p) => p[0]), [0, 200]);
});

Deno.test('steering is converted from rad to degrees', () => {
  const run = parseTelemetryCsv(CSV, 't');
  assertAlmostEquals(run.series.steering_cmd[1][1], 10.0, 0.01); // 0.1745 rad
});

Deno.test('obstacle_front only while the LiDAR reading is valid', () => {
  const run = parseTelemetryCsv(CSV, 't');
  assertEquals(run.series.obstacle_front, [
    [0, 10],
    [100, 0.9],
  ]);
});

Deno.test('state, lane lost and detections become numbers', () => {
  const run = parseTelemetryCsv(CSV, 't');
  assertEquals(
    run.series.state_code.map((p) => p[1]),
    [STATE_CODES.DRIVE, STATE_CODES.SLOW_DOWN, STATE_CODES.STOP],
  );
  assertEquals(run.series.lane_lost.map((p) => p[1]), [0, 1, 0]);
  assertEquals(run.series.detection_count.map((p) => p[1]), [0, 1, 2]);
  assertEquals(run.series.manual_active.map((p) => p[1]), [0, 0, 1]);
});

Deno.test('unknown state gets -1', () => {
  const run = parseTelemetryCsv(HEADER + '\n0.0,PARKING,,0,0,0,0,0,0,2,1,1,,0,,0,0,', 't');
  assertEquals(run.series.state_code[0][1], -1);
});

Deno.test('quoted cells with commas stay one cell', () => {
  assertEquals(splitCsvLine('1,"a, b",3'), ['1', 'a, b', '3']);
  assertEquals(splitCsvLine('"say ""hi""",x'), ['say "hi"', 'x']);
});

Deno.test('a CSV without t_s is refused', () => {
  assertThrows(() => parseTelemetryCsv('a,b\n1,2', 't'), Error, 't_s');
  assertThrows(() => parseTelemetryCsv('', 't'), Error, 'empty');
});

Deno.test('real 23 Nov sample loads', async () => {
  const text = await Deno.readTextFile(new URL('./data/23kasim/04_dur_levhasi.csv', import.meta.url));
  const run = parseTelemetryCsv(text, '04_dur_levhasi.csv');
  assertEquals(run.duration_ms, 30000);
  // the stop sign makes the car stop at least once in this clip
  assertEquals(run.series.state_code.some((p) => p[1] === STATE_CODES.STOP), true);
  assertEquals(run.series.detection_count.some((p) => p[1] > 0), true);
});
