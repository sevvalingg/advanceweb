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
  LoadingState,
} from '@grafana/data';
import { Observable, from, lastValueFrom, merge } from 'rxjs';

import {
  DEFAULT_SERVER_URL,
  MyDataSourceOptions,
  MyQuery,
  ServerTopic,
  SourceMode,
  StreamMessage,
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

  /** WebSocket address of the server (http -> ws, https -> wss). */
  get wsUrl(): string {
    return this.serverUrl.replace(/^http/, 'ws');
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

  query(options: DataQueryRequest<MyQuery>): Observable<DataQueryResponse> {
    const rangeFrom = options.range.from.valueOf();
    const rangeTo = options.range.to.valueOf();
    const maxPoints = options.maxDataPoints ?? 1000;

    const streams = options.targets.map((target) => {
      if (this.mode === 'server' && target.live) {
        return this.streamServer(target, rangeFrom, rangeTo, maxPoints);
      }
      const frame =
        this.mode === 'server'
          ? this.queryServer(target, rangeFrom, rangeTo, maxPoints)
          : Promise.resolve(this.queryMock(target, rangeFrom, rangeTo, maxPoints, options.intervalMs));
      return from(frame.then((f) => ({ data: [f], key: target.refId })));
    });

    return merge(...streams);
  }

  private queryMock(
    target: MyQuery,
    rangeFrom: number,
    rangeTo: number,
    maxPoints: number,
    intervalMs: number
  ): DataFrame {
    const topic = (target.topic in TOPICS ? target.topic : 'speed') as TelemetryTopic;
    const meta = TOPICS[topic];
    const minStepForRange = Math.ceil((rangeTo - rangeFrom) / maxPoints);
    const step = Math.max(target.intervalMs ?? intervalMs, minStepForRange, MIN_STEP_MS);
    const { times, values } = generateSeries(topic, rangeFrom, rangeTo, step);
    return this.toFrame(target.refId, meta.label, meta.unit, times, values);
  }

  private fetchTelemetry(
    target: MyQuery,
    rangeFrom: number,
    rangeTo: number,
    maxPoints: number
  ): Promise<TelemetryResponse> {
    const params = new URLSearchParams({
      topic: target.topic,
      from: String(rangeFrom),
      to: String(rangeTo),
      maxPoints: String(maxPoints),
    });
    return this.get<TelemetryResponse>(`/telemetry?${params.toString()}`);
  }

  private async queryServer(target: MyQuery, rangeFrom: number, rangeTo: number, maxPoints: number): Promise<DataFrame> {
    const res = await this.fetchTelemetry(target, rangeFrom, rangeTo, maxPoints);
    return this.toFrame(
      target.refId,
      res.label,
      res.unit,
      res.points.map((p) => p[0]),
      res.points.map((p) => p[1])
    );
  }

  /** Backfill the visible range over REST, then append the points pushed over the WebSocket. */
  private streamServer(
    target: MyQuery,
    rangeFrom: number,
    rangeTo: number,
    maxPoints: number
  ): Observable<DataQueryResponse> {
    return new Observable<DataQueryResponse>((subscriber) => {
      const windowMs = rangeTo - rangeFrom;
      const times: number[] = [];
      const values: number[] = [];
      let label = target.topic;
      let unit = 'none';
      let socket: WebSocket | undefined;
      let stopped = false;

      const emit = () => {
        subscriber.next({
          data: [this.toFrame(target.refId, label, unit, [...times], [...values])],
          key: target.refId,
          state: LoadingState.Streaming,
        });
      };

      const fail = (message: string) => {
        if (!stopped) {
          stopped = true;
          subscriber.error(new Error(message));
        }
      };

      this.fetchTelemetry(target, rangeFrom, rangeTo, maxPoints)
        .then((history) => {
          if (stopped) {
            return;
          }
          label = history.label;
          unit = history.unit;
          for (const [t, v] of history.points) {
            times.push(t);
            values.push(v);
          }
          emit();

          const params = new URLSearchParams({ topic: target.topic });
          socket = new WebSocket(`${this.wsUrl}/stream?${params.toString()}`);
          socket.onmessage = (event: MessageEvent<string>) => {
            const message: StreamMessage = JSON.parse(event.data);
            for (const [t, v] of message.points) {
              times.push(t);
              values.push(v);
            }
            const oldest = times[times.length - 1] - windowMs;
            while (times.length > 0 && times[0] < oldest) {
              times.shift();
              values.shift();
            }
            emit();
          };
          socket.onerror = () => fail(`Live stream to ${this.wsUrl} failed. Is the mock server running?`);
          socket.onclose = () => fail('Live stream was closed by the AutoTrack server.');
        })
        .catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));

      return () => {
        stopped = true;
        socket?.close();
      };
    });
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
