import { DataSourceJsonData } from '@grafana/data';
import { DataQuery } from '@grafana/schema';

/** Where the data comes from. */
export type SourceMode = 'mock' | 'server';

export const DEFAULT_SERVER_URL = 'http://localhost:8080';

/** Synthetic signals generated in the browser (mock mode). */
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

/** A topic as listed by the AutoTrack server's /topics endpoint. */
export interface ServerTopic {
  id: string;
  label: string;
  unit: string;
}

/** Response of the AutoTrack server's /telemetry endpoint. */
export interface TelemetryResponse {
  topic: string;
  label: string;
  unit: string;
  points: Array<[number, number]>;
}

export interface MyQuery extends DataQuery {
  topic: string;
  intervalMs?: number;
  /** Server mode only: keep the panel updated over a WebSocket. */
  live?: boolean;
}

/** Message pushed by the AutoTrack server's /stream WebSocket. */
export interface StreamMessage {
  topic: string;
  points: Array<[number, number]>;
}

/**
 * These are options configured for each DataSource instance
 */
export interface MyDataSourceOptions extends DataSourceJsonData {
  mode?: SourceMode;
  serverUrl?: string;
}

/** Topics computed in the browser by the AI sensor health analysis (server mode only). */
export const AI_HEALTH_TOPIC = 'ai_sensor_health';
export const AI_DIAGNOSIS_TOPIC = 'ai_diagnosis';
export const AI_TOPICS: ServerTopic[] = [
  { id: AI_HEALTH_TOPIC, label: 'AI: Sensor health timeline', unit: 'none' },
  { id: AI_DIAGNOSIS_TOPIC, label: 'AI: Stall diagnosis', unit: 'none' },
];
