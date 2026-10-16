import React, { ChangeEvent } from 'react';
import { InlineField, Input, Select, Stack } from '@grafana/ui';
import { QueryEditorProps, SelectableValue } from '@grafana/data';
import { DataSource } from '../datasource';
import { MyDataSourceOptions, MyQuery, TelemetryTopic, TOPICS } from '../types';

type Props = QueryEditorProps<DataSource, MyQuery, MyDataSourceOptions>;

const topicOptions: Array<SelectableValue<TelemetryTopic>> = (Object.keys(TOPICS) as TelemetryTopic[]).map(
  (key) => ({
    value: key,
    label: TOPICS[key].label,
    description: TOPICS[key].description,
  })
);

export function QueryEditor({ query, onChange, onRunQuery }: Props) {
  const onTopicChange = (option: SelectableValue<TelemetryTopic>) => {
    if (!option.value) {
      return;
    }
    onChange({ ...query, topic: option.value });
    onRunQuery();
  };

  const onIntervalChange = (event: ChangeEvent<HTMLInputElement>) => {
    const parsed = parseInt(event.target.value, 10);
    onChange({ ...query, intervalMs: Number.isNaN(parsed) ? undefined : parsed });
  };

  return (
    <>
      <p style={{ opacity: 0.7 }}>Developed by Meryem Esma Eröz · AutoTrack AI · Fall 2026</p>
      <Stack gap={1}>
        <InlineField label="Topic" labelWidth={10} tooltip="Which vehicle signal to query">
          <Select options={topicOptions} value={query.topic} onChange={onTopicChange} width={30} />
        </InlineField>
        <InlineField label="Interval (ms)" labelWidth={16} tooltip="Sampling interval; leave empty for automatic">
          <Input
            type="number"
            min={50}
            step={50}
            value={query.intervalMs ?? ''}
            placeholder="auto"
            onChange={onIntervalChange}
            onBlur={onRunQuery}
            width={12}
          />
        </InlineField>
      </Stack>
    </>
  );
}