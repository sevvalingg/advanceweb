import React, { ChangeEvent } from 'react';
import { InlineField, Input, RadioButtonGroup } from '@grafana/ui';
import { DataSourcePluginOptionsEditorProps, SelectableValue } from '@grafana/data';
import { DEFAULT_SERVER_URL, MyDataSourceOptions, SourceMode } from '../types';

type Props = DataSourcePluginOptionsEditorProps<MyDataSourceOptions>;

const modeOptions: Array<SelectableValue<SourceMode>> = [
  { label: 'Mock (browser)', value: 'mock', description: 'Synthetic signals generated in the browser' },
  { label: 'AutoTrack server', value: 'server', description: 'Recorded runs served over REST' },
];

export function ConfigEditor({ options, onOptionsChange }: Props) {
  const { jsonData } = options;
  const mode = jsonData.mode ?? 'mock';

  const update = (patch: Partial<MyDataSourceOptions>) => {
    onOptionsChange({ ...options, jsonData: { ...jsonData, ...patch } });
  };

  return (
    <>
      <p style={{ opacity: 0.7 }}>Developed by Meryem Esma Eröz · AutoTrack AI · Fall 2026</p>
      <InlineField label="Mode" labelWidth={14} tooltip="Where the telemetry comes from">
        <RadioButtonGroup options={modeOptions} value={mode} onChange={(value) => update({ mode: value })} />
      </InlineField>
      {mode === 'server' && (
        <InlineField
          label="Server URL"
          labelWidth={14}
          interactive
          tooltip="Address of the AutoTrack mock server as seen from your browser"
        >
          <Input
            width={40}
            value={jsonData.serverUrl ?? ''}
            placeholder={DEFAULT_SERVER_URL}
            onChange={(event: ChangeEvent<HTMLInputElement>) => update({ serverUrl: event.target.value })}
          />
        </InlineField>
      )}
    </>
  );
}
