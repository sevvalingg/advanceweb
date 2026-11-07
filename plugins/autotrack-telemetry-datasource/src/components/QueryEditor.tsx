import React, { ChangeEvent, useEffect, useState } from 'react';
import { Alert, InlineField, InlineSwitch, Input, Select, Stack } from '@grafana/ui';
import { QueryEditorProps, SelectableValue } from '@grafana/data';
import { DataSource } from '../datasource';
import { MyDataSourceOptions, MyQuery } from '../types';

type Props = QueryEditorProps<DataSource, MyQuery, MyDataSourceOptions>;

export function QueryEditor({ query, onChange, onRunQuery, datasource }: Props) {
  const [topicOptions, setTopicOptions] = useState<Array<SelectableValue<string>>>([]);
  const [loadError, setLoadError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    datasource
      .listTopics()
      .then((topics) => {
        if (!cancelled) {
          setTopicOptions(topics.map((t) => ({ value: t.id, label: t.label })));
          setLoadError(undefined);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [datasource]);

  const onTopicChange = (option: SelectableValue<string>) => {
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

  const onLiveChange = (event: React.FormEvent<HTMLInputElement>) => {
    onChange({ ...query, live: event.currentTarget.checked });
    onRunQuery();
  };

  return (
    <>
      <p style={{ opacity: 0.7 }}>Developed by Meryem Esma Eröz · AutoTrack AI · Fall 2026</p>
      {loadError && (
        <Alert title="Could not load topics" severity="error">
          {loadError}
        </Alert>
      )}
      <Stack gap={1}>
        <InlineField label="Topic" labelWidth={10} tooltip="Which vehicle signal to query">
          <Select
            options={topicOptions}
            value={query.topic}
            onChange={onTopicChange}
            isLoading={!topicOptions.length && !loadError}
            width={30}
          />
        </InlineField>
        {datasource.mode === 'server' && (
          <InlineField label="Live" tooltip="Stream new points over a WebSocket instead of polling">
            <InlineSwitch value={!!query.live} onChange={onLiveChange} />
          </InlineField>
        )}
        {datasource.mode === 'mock' && (
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
        )}
      </Stack>
    </>
  );
}
