import { readFileSync } from 'fs';
import { join } from 'path';
import { FieldType, createDataFrame } from '@grafana/data';
import { buildDebugState } from './debugState';

// Reads the generated sample run the same way TestData "CSV content" would: numbers where every
// non-empty cell is a number, text otherwise, empty cells as null.
function csvToFrame(file: string) {
  const [header, ...lines] = readFileSync(join(__dirname, '../../provisioning/data', file), 'utf8')
    .trim()
    .split('\n');
  const names = header.split(',');
  const rows = lines.map((line) => line.split(','));
  return createDataFrame({
    fields: names.map((name, i) => {
      const cells = rows.map((r) => (r[i] === '' ? null : r[i]));
      const numeric = cells.every((c) => c === null || !Number.isNaN(Number(c)));
      return {
        name,
        type: numeric ? FieldType.number : FieldType.string,
        values: numeric ? cells.map((c) => (c === null ? null : Number(c))) : cells,
      };
    }),
  });
}

describe('sample run (provisioning/data)', () => {
  const view = buildDebugState([csvToFrame('sample_run.csv'), csvToFrame('sample_alerts.csv')]);

  it('goes through all 8 course tasks and ends finished', () => {
    expect(view.tasks.doneCount).toBe(8);
    expect(view.state.current?.state).toBe('FINISHED');
  });

  it('has the expected sequence of states', () => {
    expect(view.state.segments.map((s) => s.state)).toEqual([
      'IDLE',
      'FOLLOW_LANE',
      'STOP_SIGN',
      'FOLLOW_LANE',
      'WAIT_LIGHT',
      'FOLLOW_LANE',
      'YIELD_PEDESTRIAN',
      'FOLLOW_LANE',
      'AVOID_OBSTACLE',
      'OVERTAKE',
      'ROAD_WORKS',
      'PARK',
      'FINISHED',
    ]);
  });

  it('has a last detection and the lane-lost alert', () => {
    expect(view.detection.last?.cls).toBe('pedestrian');
    expect(view.alerts).toEqual([{ t: 43500, level: 'warning', message: 'Lane lost for 0.5 s' }]);
  });
});
