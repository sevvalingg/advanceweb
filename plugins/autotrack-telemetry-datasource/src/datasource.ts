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
  MappingType,
  ValueMapping,
} from '@grafana/data';
import { Observable, from, lastValueFrom, map, merge, switchMap, timer } from 'rxjs';

import {
  AI_DIAGNOSIS_TOPIC,
  AI_TOPICS,
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
import { HealthAnalysis, HealthState, analyzeSensorHealth } from './ai/sensorHealth';

const MIN_STEP_MS = 50;
const AI_REFRESH_MS = 5000;

const HEALTH_MAPPINGS: ValueMapping[] = [
  {
    type: MappingType.ValueToText,
    options: {
      [HealthState.Healthy]: { text: 'Healthy', color: 'green', index: 0 },
      [HealthState.CameraStalled]: { text: 'Camera stalled', color: 'orange', index: 1 },
      [HealthState.LidarStalled]: { text: 'LiDAR stalled', color: 'orange', index: 2 },
      [HealthState.BothStalled]: { text: 'Both stalled (system-level)', color: 'red', index: 3 },
    },
  },
];

function isAiTopic(topic: string): boolean {
  return AI_TOPICS.some((t) => t.id === topic);
}

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

  /** Topics offered in the query editor: a fixed list in mock mode, server topics plus AI topics otherwise. */
  async listTopics(): Promise<ServerTopic[]> {
    if (this.mode === 'mock') {
      return (Object.keys(TOPICS) as TelemetryTopic[]).map((id) => ({
        id,
        label: TOPICS[id].label,
        unit: TOPICS[id].unit,
      }));
    }
    const topics = await this.get<ServerTopic[]>('/topics');
    return [...topics, ...AI_TOPICS];
  }

  query(options: DataQueryRequest<MyQuery>): Observable<DataQueryResponse> {
    const rangeFrom = options.range.from.valueOf();
    const rangeTo = options.range.to.valueOf();
    const maxPoints = options.maxDataPoints ?? 1000;

    const streams = options.targets.map((target) => {
      if (this.mode === 'server' && isAiTopic(target.topic)) {
        return this.queryAi(target, rangeFrom, rangeTo);
      }
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
    topic: string,
    rangeFrom: number,
    rangeTo: number,
    maxPoints: number
  ): Promise<TelemetryResponse> {
    const params = new URLSearchParams({
      topic,
      from: String(rangeFrom),
      to: String(rangeTo),
      maxPoints: String(maxPoints),
    });
    return this.get<TelemetryResponse>(`/telemetry?${params.toString()}`);
  }

  private async queryServer(
    target: MyQuery,
    rangeFrom: number,
    rangeTo: number,
    maxPoints: number
  ): Promise<DataFrame> {
    const res = await this.fetchTelemetry(target.topic, rangeFrom, rangeTo, maxPoints);
    return this.toFrame(
      target.refId,
      res.label,
      res.unit,
      res.points.map((p) => p[0]),
      res.points.map((p) => p[1])
    );
  }

  /** AI topics: run the sensor health analysis once, or every few seconds on a sliding window when live. */
  private queryAi(target: MyQuery, rangeFrom: number, rangeTo: number): Observable<DataQueryResponse> {
    if (!target.live) {
      return from(this.aiFrames(target, rangeFrom, rangeTo).then((data) => ({ data, key: target.refId })));
    }
    const windowMs = rangeTo - rangeFrom;
    return timer(0, AI_REFRESH_MS).pipe(
      switchMap(() => {
        const now = Date.now();
        return from(this.aiFrames(target, now - windowMs, now));
      }),
      map((data) => ({ data, key: target.refId, state: LoadingState.Streaming }))
    );
  }

  private async aiFrames(target: MyQuery, rangeFrom: number, rangeTo: number): Promise<DataFrame[]> {
    // One point per second is needed, so ask for enough points to avoid any downsampling.
    const maxPoints = Math.ceil((rangeTo - rangeFrom) / 1000) + 10;
    const [lidar, camera] = await Promise.all([
      this.fetchTelemetry('lidar_hz', rangeFrom, rangeTo, maxPoints),
      this.fetchTelemetry('camera_fps', rangeFrom, rangeTo, maxPoints),
    ]);
    const analysis = analyzeSensorHealth(lidar.points, camera.points);
    return [
      target.topic === AI_DIAGNOSIS_TOPIC
        ? diagnosisFrame(target.refId, analysis)
        : healthFrame(target.refId, analysis),
    ];
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

      this.fetchTelemetry(target.topic, rangeFrom, rangeTo, maxPoints)
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

/** Joint health state per second, coloured by the value mappings; the diagnosis is attached as a notice. */
function healthFrame(refId: string, analysis: HealthAnalysis): DataFrame {
  return createDataFrame({
    refId,
    name: 'Sensor health',
    meta: { notices: [{ severity: analysis.severity, text: analysis.diagnosis }] },
    fields: [
      { name: 'Time', type: FieldType.time, values: analysis.states.map((s) => s[0]) },
      {
        name: 'Sensor health',
        type: FieldType.number,
        values: analysis.states.map((s) => s[1]),
        config: { displayName: 'Sensor health', mappings: HEALTH_MAPPINGS },
      },
    ],
  });
}

/** One-row summary: diagnosis text, overlap, lag, stalled seconds and the thresholds learned by k-means. */
function diagnosisFrame(refId: string, analysis: HealthAnalysis): DataFrame {
  const threshold = (value: number) => (Number.isFinite(value) ? Number(value.toFixed(1)) : null);
  return createDataFrame({
    refId,
    name: 'Stall diagnosis',
    fields: [
      { name: 'Diagnosis', type: FieldType.string, values: [analysis.diagnosis] },
      { name: 'Stall overlap', type: FieldType.number, values: [analysis.overlap], config: { unit: 'percentunit' } },
      { name: 'Lag (camera vs LiDAR)', type: FieldType.number, values: [analysis.bestLag], config: { unit: 's' } },
      { name: 'LiDAR stalled', type: FieldType.number, values: [analysis.stalledSeconds.lidar], config: { unit: 's' } },
      {
        name: 'Camera stalled',
        type: FieldType.number,
        values: [analysis.stalledSeconds.camera],
        config: { unit: 's' },
      },
      {
        name: 'Learned LiDAR threshold',
        type: FieldType.number,
        values: [threshold(analysis.lidar.threshold)],
        config: { unit: 'hertz' },
      },
      {
        name: 'Learned camera threshold',
        type: FieldType.number,
        values: [threshold(analysis.camera.threshold)],
        config: { unit: 'none' },
      },
    ],
  });
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
