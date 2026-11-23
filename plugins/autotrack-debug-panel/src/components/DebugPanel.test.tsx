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
  it('shows the state, the tasks, the detection and the developer', () => {
    renderPanel([
      createDataFrame({
        fields: [
          { name: 'time_ms', type: FieldType.number, values: [0, 1000, 2500] },
          { name: 'state', type: FieldType.string, values: ['FOLLOW_LANE', 'FOLLOW_LANE', 'WAIT_LIGHT'] },
          { name: 'task', type: FieldType.string, values: ['traffic_light', 'traffic_light', 'traffic_light'] },
          { name: 'tasks_done', type: FieldType.string, values: ['lane_following;traffic_sign', null, null] },
          { name: 'perception_fps', type: FieldType.number, values: [16, 11, 16] },
          { name: 'detection_class', type: FieldType.string, values: [null, 'light_red', null] },
        ],
      }),
    ]);
    expect(screen.getAllByText('WAIT_LIGHT').length).toBeGreaterThan(0);
    expect(screen.getByText('Red light')).toBeInTheDocument();
    expect(screen.getByText(/1\.5 s ago/)).toBeInTheDocument();
    expect(screen.getByText(/2 \/ 8 done/)).toBeInTheDocument();
    expect(screen.getByText(`Developed by ${DEVELOPER} · AutoTrack AI`)).toBeInTheDocument();
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
    expect(screen.getByText(/No `detection_class` column/)).toBeInTheDocument();
  });
});
