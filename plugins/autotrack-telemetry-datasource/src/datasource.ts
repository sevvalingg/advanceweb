import { getBackendSrv, isFetchError } from '@grafana/runtime';
import {
  CoreApp,
  DataQueryRequest,
  DataQueryResponse,
  DataSourceApi,
  DataSourceInstanceSettings,
  createDataFrame,
  FieldType,
} from '@grafana/data';
import { lastValueFrom } from 'rxjs';

import { MyQuery, MyDataSourceOptions, DEFAULT_QUERY, DataSourceResponse, TOPICS } from './types';
import { generateSeries } from './mock/telemetry';

const MIN_STEP_MS = 50;

export class DataSource extends DataSourceApi<MyQuery, MyDataSourceOptions> {
  baseUrl: string;

  constructor(instanceSettings: DataSourceInstanceSettings<MyDataSourceOptions>) {
    super(instanceSettings);
    this.baseUrl = instanceSettings.url!;
  }

  getDefaultQuery(_: CoreApp): Partial<MyQuery> {
    return DEFAULT_QUERY;
  }

  filterQuery(query: MyQuery): boolean {
    return !query.hide && !!query.topic;
  }

  async query(options: DataQueryRequest<MyQuery>): Promise<DataQueryResponse> {
    const from = options.range.from.valueOf();
    const to = options.range.to.valueOf();
    const maxPoints = options.maxDataPoints ?? 1000;
    const minStepForRange = Math.ceil((to - from) / maxPoints);

    const data = options.targets.map((target) => {
      const topic = target.topic ?? 'speed';
      const meta = TOPICS[topic];
      const step = Math.max(target.intervalMs ?? options.intervalMs, minStepForRange, MIN_STEP_MS);
      const { times, values } = generateSeries(topic, from, to, step);

      return createDataFrame({
        refId: target.refId,
        name: meta.label,
        fields: [
          { name: 'Time', type: FieldType.time, values: times },
          {
            name: meta.label,
            type: FieldType.number,
            values,
            config: { unit: meta.unit, displayName: meta.label },
          },
        ],
      });
    });

    return { data };
  }

  async request(url: string, params?: string) {
    const response = getBackendSrv().fetch<DataSourceResponse>({
      url: `${this.baseUrl}${url}${params?.length ? `?${params}` : ''}`,
    });
    return lastValueFrom(response);
  }

  /**
   * Mock mode needs no connection; the REST/WebSocket check will be added with the mock server.
   */
  async testDatasource() {
    try {
      return {
        status: 'success',
        message: 'AutoTrack telemetry is ready (mock mode: data is generated in the browser).',
      };
    } catch (err) {
      let message = 'Cannot connect to API';
      if (typeof err === 'string') {
        message = err;
      } else if (isFetchError(err)) {
        message = 'Fetch error: ' + (err.statusText || message);
      }
      return { status: 'error', message };
    }
  }
}