import { DataSourceJsonData } from '@grafana/data';
import { DataQuery } from '@grafana/schema';

export type TelemetryTopic = 'speed' | 'steering' | 'battery_4s' | 'battery_3s';

export interface TopicMeta {
  label: string;
  unit: string; // Grafana unit id
  description: string;
}

export const TOPICS: Record<TelemetryTopic, TopicMeta> = {
  speed: { label: 'Speed', unit: 'velocityms', description: 'Vehicle speed (m/s), limited to 1 m/s' },
  steering: { label: 'Steering angle', unit: 'degree', description: 'Front wheel steering angle (°)' },
  battery_4s: { label: 'Battery 4S (Jetson)', unit: 'volt', description: '4S pack powering the Jetson' },
  battery_3s: { label: 'Battery 3S (Motor)', unit: 'volt', description: '3S pack powering the motor via VESC' },
};

export interface MyQuery extends DataQuery {
  topic: TelemetryTopic;
  intervalMs?: number;
}

export const DEFAULT_QUERY: Partial<MyQuery> = {
  topic: 'speed',
};

export interface DataPoint {
  Time: number;
  Value: number;
}

export interface DataSourceResponse {
  datapoints: DataPoint[];
}

/**
 * These are options configured for each DataSource instance
 */
export interface MyDataSourceOptions extends DataSourceJsonData {
  path?: string;
}

/**
 * Value that is used in the backend, but never sent over HTTP to the frontend
 */
export interface MySecureJsonData {
  apiKey?: string;
}