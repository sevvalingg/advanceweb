import { readFileSync } from 'fs';
import { join } from 'path';
import { FieldType, createDataFrame } from '@grafana/data';
import { buildDebugState } from './debugState';

// Reads the real track clips the same way TestData "CSV content" does: numbers where every non-empty
// cell is a number, text otherwise, empty cells as null.
function csvToFrame(file: string) {
  const [header, ...lines] = readFileSync(join(__dirname, '../../provisioning/data', file), 'utf8')
    .trim()
    .split(/\r?\n/);
  const rows = lines.map((line) => line.split(','));
  return createDataFrame({
    fields: header.split(',').map((name, i) => {
      const cells = rows.map((r) => (r[i] === '' || r[i] === undefined ? null : r[i]));
      const numeric = cells.every((c) => c === null || !Number.isNaN(Number(c)));
      return {
        name,
        type: numeric ? FieldType.number : FieldType.string,
        values: numeric ? cells.map((c) => (c === null ? null : Number(c))) : cells,
      };
    }),
  });
}

describe('real track clips from 23 November (provisioning/data)', () => {
  it('stop sign: detects sign_stop and stops because of it', () => {
    const view = buildDebugState([csvToFrame('04_dur_levhasi.csv')]);
    const stops = view.state.segments.filter((s) => s.state === 'STOP');
    expect(stops.some((s) => s.reasons.includes('dur levhasi'))).toBe(true);
    expect(view.detection.last?.cls).toBe('sign_stop');
    expect(view.detectionsFps.present).toBe(true);
  });

  it('lane loss in a curve: slows down, then stops with "serit kayip"', () => {
    const view = buildDebugState([csvToFrame('02_viraj_serit_kaybi.csv')]);
    const states = view.state.segments.map((s) => s.state);
    expect(states).toContain('SLOW_DOWN');
    expect(view.state.segments.some((s) => s.reasons.some((r) => r.startsWith('serit kayip')))).toBe(true);
  });
});
