import React from 'react';
import { render, screen } from '@testing-library/react';
import { FieldType, LoadingState, PanelData, createDataFrame, dateTime, getDefaultTimeRange } from '@grafana/data';
import { DebugPanel, DEVELOPER } from './DebugPanel';
import { DEFAULT_OPTIONS } from '../types';

function renderPanel(series: PanelData['series']) {
  const data: PanelData = { series, state: LoadingState.Done, timeRange: getDefaultTimeRange() };
  const props = {
    id: 1,
    data,
    timeRange: data.timeRange,
    timeZone: 'utc',
    options: DEFAULT_OPTIONS,
    fieldConfig: { defaults: {}, overrides: [] },
    width: 600,
    height: 400,
    transparent: false,
    renderCounter: 0,
    title: 'Debug',
    eventBus: {} as never,
    onOptionsChange: jest.fn(),
    onFieldConfigChange: jest.fn(),
    replaceVariables: (s: string) => s,
    onChangeTimeRange: jest.fn(),
  };
  return render(<DebugPanel {...(props as React.ComponentProps<typeof DebugPanel>)} />);
}

describe('DebugPanel', () => {
  it('shows the state, the reason, the detection and the developer', () => {
    renderPanel([
      createDataFrame({
        fields: [
          { name: 't_s', type: FieldType.number, values: [760.0, 761.0, 762.5] },
          { name: 'state', type: FieldType.string, values: ['DRIVE', 'DRIVE', 'STOP'] },
          { name: 'reasons', type: FieldType.string, values: ['yol acik', 'yol acik', 'dur levhasi'] },
          { name: 'detections_fps', type: FieldType.number, values: [15, 11, 15] },
          { name: 'detections', type: FieldType.string, values: [null, 'sign_stop:0.93 light_red:0.41', null] },
        ],
      }),
    ]);
    expect(screen.getAllByText('STOP').length).toBeGreaterThan(0);
    expect(screen.getByText('Why: dur levhasi')).toBeInTheDocument();
    expect(screen.getByText('Stop sign')).toBeInTheDocument();
    expect(screen.getByText(/93 % · 1\.5 s ago/)).toBeInTheDocument();
    expect(screen.getByText(/also Red light/)).toBeInTheDocument();
    expect(screen.getByText(/No `task` column/)).toBeInTheDocument();
    expect(screen.getByText(`Developed by ${DEVELOPER} · AutoTrack AI`)).toBeInTheDocument();
  });

  it('shows the course tasks when a data source provides them', () => {
    renderPanel([
      createDataFrame({
        fields: [
          { name: 't_s', type: FieldType.number, values: [0, 1] },
          { name: 'state', type: FieldType.string, values: ['DRIVE', 'STOP'] },
          { name: 'task', type: FieldType.string, values: ['traffic_light', 'traffic_light'] },
          { name: 'tasks_done', type: FieldType.string, values: ['lane_following;traffic_sign', null] },
        ],
      }),
    ]);
    expect(screen.getByText(/2 \/ 8 done/)).toBeInTheDocument();
  });

  it('says which column is missing instead of showing empty values', () => {
    renderPanel([
      createDataFrame({
        fields: [
          { name: 'Time', type: FieldType.time, values: [dateTime().valueOf()] },
          { name: 'Speed command', type: FieldType.number, values: [0.4] },
        ],
      }),
    ]);
    expect(screen.getByText(/No `state` column/)).toBeInTheDocument();
    expect(screen.getByText(/No `detections` column/)).toBeInTheDocument();
  });
});
