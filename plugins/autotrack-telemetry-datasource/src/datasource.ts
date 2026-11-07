import { getBackendSrv, isFetchError } from '@grafana/runtime';
import {
  CoreApp,
  DataFrame,
  DataQueryRequest,
  DataQueryResponse,
  DataSourceApi,
  DataSourceInstanceSettings,
  createDataFrame,
  FieldType,
} from '@grafana/data';
import { lastValueFrom } from 'rxjs';

import {
  DEFAULT_SERVER_URL,
  MyDataSourceOptions,
  MyQuery,
  ServerTopic,
  SourceMode,
  TOPICS,
  TelemetryResponse,
  TelemetryTopic,
} from './types';
import { generateSeries } from './mock/telemetry';

const MIN_STEP_MS = 50;

export class DataSource extends DataSourceApi<MyQuery, MyDataSourceOptions> {
  readonly mode: SourceMode;
  readonly serverUrl: string;

  constructor(instanceSettings: DataSourceInstanceSettings<MyDataSourceOptions>) {
    super(instanceSettings);
    this.mode = instanceSettings.jsonData.mode ?? 'mock';
    this.serverUrl = (instanceSettings.jsonData.serverUrl || DEFAULT_SERVER_URL).replace(/\/+$/, '');
  }

  getDefaultQuery(_: CoreApp): Partial<MyQuery> {
    return { topic: this.mode === 'server' ? 'speed_cmd' : 'speed' };
  }

  filterQuery(query: MyQuery): boolean {
    return !query.hide && !!query.topic;
  }

  /** Topics offered in the query editor: a fixed list in mock mode, read from the server otherwise. */
  async listTopics(): Promise<ServerTopic[]> {
    if (this.mode === 'mock') {
      return (Object.keys(TOPICS) as TelemetryTopic[]).map((id) => ({
        id,
        label: TOPICS[id].label,
        unit: TOPICS[id].unit,
      }));
    }
    return this.get<ServerTopic[]>('/topics');
  }

  async query(options: DataQueryRequest<MyQuery>): Promise<DataQueryResponse> {
    const from = options.range.from.valueOf();
    const to = options.range.to.valueOf();
    const maxPoints = options.maxDataPoints ?? 1000;

    const data = await Promise.all(
      options.targets.map((target) =>
        this.mode === 'server'
          ? this.queryServer(target, from, to, maxPoints)
          : this.queryMock(target, from, to, maxPoints, options.intervalMs)
      )
    );
    return { data };
  }

  private queryMock(target: MyQuery, from: number, to: number, maxPoints: number, intervalMs: number): DataFrame {
    const topic = (target.topic in TOPICS ? target.topic : 'speed') as TelemetryTopic;
    const meta = TOPICS[topic];
    const minStepForRange = Math.ceil((to - from) / maxPoints);
    const step = Math.max(target.intervalMs ?? intervalMs, minStepForRange, MIN_STEP_MS);
    const { times, values } = generateSeries(topic, from, to, step);
    return this.toFrame(target.refId, meta.label, meta.unit, times, values);
  }

  private async queryServer(target: MyQuery, from: number, to: number, maxPoints: number): Promise<DataFrame> {
    const params = new URLSearchParams({
      topic: target.topic,
      from: String(from),
      to: String(to),
      maxPoints: String(maxPoints),
    });
    const res = await this.get<TelemetryResponse>(`/telemetry?${params.toString()}`);
    return this.toFrame(
      target.refId,
      res.label,
      res.unit,
      res.points.map((p) => p[0]),
      res.points.map((p) => p[1])
    );
  }

  private toFrame(refId: string, label: string, unit: string, times: number[], values: number[]): DataFrame {
    return createDataFrame({
      refId,
      name: label,
      fields: [
        { name: 'Time', type: FieldType.time, values: times },
        { name: label, type: FieldType.number, values, config: { unit, displayName: label } },
      ],
    });
  }

  /** GET a JSON resource from the AutoTrack server; failures become readable errors. */
  private async get<T>(path: string): Promise<T> {
    try {
      const response = await lastValueFrom(
        getBackendSrv().fetch<T>({ url: `${this.serverUrl}${path}`, method: 'GET', showErrorAlert: false })
      );
      return response.data;
    } catch (err) {
      throw new Error(describeError(err, this.serverUrl));
    }
  }

  async testDatasource() {
    if (this.mode === 'mock') {
      return { status: 'success', message: 'Mock mode: data is generated in the browser.' };
    }
    try {
      const health = await this.get<{ source: string; loop_ms: number }>('/health');
      return {
        status: 'success',
        message: `Connected to ${this.serverUrl}. Replaying ${health.source} (${(health.loop_ms / 1000).toFixed(1)} s loop).`,
      };
    } catch (err) {
      return { status: 'error', message: err instanceof Error ? err.message : String(err) };
    }
  }
}

function describeError(err: unknown, serverUrl: string): string {
  const unreachable = `Cannot reach the AutoTrack server at ${serverUrl}. Is the mock server running?`;
  // A refused connection is reported by the browser as a TypeError ("Failed to fetch"), not as an HTTP error.
  if (err instanceof TypeError) {
    return unreachable;
  }
  if (isFetchError(err)) {
    if (!err.status || err.status <= 0) {
      return unreachable;
    }
    const detail = (err.data as { error?: string } | undefined)?.error ?? err.statusText;
    return `AutoTrack server returned ${err.status}: ${detail}`;
  }
  return err instanceof Error ? err.message : String(err);
}
