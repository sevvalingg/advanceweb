/**
 * AI section: sensor health analysis that runs entirely in the browser,
 * on the LiDAR and camera rates the plugin receives from the AutoTrack server.
 *
 * 1. Learns, for each sensor, a "stalled" and a "healthy" message-rate cluster with 1-D k-means (k = 2),
 *    so no hand-tuned threshold is needed and it adapts to other sensors and frame rates.
 * 2. Labels every second with a joint state: healthy, camera stalled, LiDAR stalled or both stalled.
 * 3. Measures how the stalls of the two sensors overlap (Jaccard index) and at which time lag,
 *    and turns that into a diagnosis. The study behind it is in docs/sensor-stall-analysis.md.
 */

export type Point = [number, number];

export enum HealthState {
  Healthy = 0,
  CameraStalled = 1,
  LidarStalled = 2,
  BothStalled = 3,
}

export interface RateClusters {
  stalledCentroid: number;
  healthyCentroid: number;
  /** Rates at or below this value count as stalled; -Infinity when the data has no stalled cluster. */
  threshold: number;
}

export interface StalledSeconds {
  lidar: number;
  camera: number;
  both: number;
}

export interface HealthAnalysis {
  states: Point[];
  lidar: RateClusters;
  camera: RateClusters;
  seconds: number;
  stalledSeconds: StalledSeconds;
  /** Jaccard index of the stalled seconds of both sensors at zero lag (0..1). */
  overlap: number;
  /** Lag in seconds (camera relative to LiDAR) with the largest overlap; positive = LiDAR stalls first. */
  bestLag: number;
  diagnosis: string;
  severity: 'info' | 'warning';
}

/** A stalled cluster is only accepted if its centroid is at most this fraction of the healthy one. */
const MIN_SEPARATION = 0.25;
const MAX_LAG_S = 3;
const LINKED_OVERLAP = 0.8;
const INDEPENDENT_OVERLAP = 0.3;

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** 1-D k-means with k = 2 on per-second message rates. */
export function learnRateClusters(rates: number[], maxIterations = 50): RateClusters {
  if (rates.length === 0) {
    return { stalledCentroid: 0, healthyCentroid: 0, threshold: -Infinity };
  }
  let low = Math.min(...rates);
  let high = Math.max(...rates);
  for (let i = 0; i < maxIterations && low < high; i++) {
    const boundary = (low + high) / 2;
    const nextLow = mean(rates.filter((r) => r <= boundary));
    const nextHigh = mean(rates.filter((r) => r > boundary));
    if (nextLow === low && nextHigh === high) {
      break;
    }
    low = nextLow;
    high = nextHigh;
  }
  const separated = high > 0 && low <= MIN_SEPARATION * high;
  return { stalledCentroid: low, healthyCentroid: high, threshold: separated ? (low + high) / 2 : -Infinity };
}

function toState(lidarStalled: boolean, cameraStalled: boolean): HealthState {
  if (lidarStalled && cameraStalled) {
    return HealthState.BothStalled;
  }
  if (lidarStalled) {
    return HealthState.LidarStalled;
  }
  if (cameraStalled) {
    return HealthState.CameraStalled;
  }
  return HealthState.Healthy;
}

function sharedStalls(lidar: boolean[], camera: boolean[], lag: number): number {
  let shared = 0;
  for (let i = 0; i < lidar.length; i++) {
    const j = i + lag;
    if (j >= 0 && j < camera.length && lidar[i] && camera[j]) {
      shared++;
    }
  }
  return shared;
}

function diagnose(
  stalled: StalledSeconds,
  overlap: number,
  linkedOverlap: number,
  bestLag: number,
  seconds: number
): Pick<HealthAnalysis, 'diagnosis' | 'severity'> {
  if (stalled.lidar === 0 && stalled.camera === 0) {
    return { diagnosis: `No sensor stalls in the last ${seconds} s.`, severity: 'info' };
  }
  if (bestLag === 0 && overlap >= LINKED_OVERLAP) {
    return {
      diagnosis:
        `System-level: LiDAR and camera stall together (${Math.round(overlap * 100)}% overlap at 0 s lag, ` +
        `${stalled.both} of ${seconds} s). A shared cause is likely: USB hub, CPU/disk load or power.`,
      severity: 'warning',
    };
  }
  if (linkedOverlap >= LINKED_OVERLAP) {
    const first = bestLag > 0 ? 'LiDAR' : 'camera';
    return {
      diagnosis:
        `Linked: the ${first} stalls about ${Math.abs(bestLag)} s before the other sensor ` +
        `(${Math.round(linkedOverlap * 100)}% overlap). Investigate the ${first} first.`,
      severity: 'warning',
    };
  }
  if (linkedOverlap <= INDEPENDENT_OVERLAP) {
    const worse = stalled.lidar >= stalled.camera ? 'LiDAR' : 'camera';
    return {
      diagnosis:
        `Mostly independent stalls (${Math.round(linkedOverlap * 100)}% overlap): likely sensor-specific. ` +
        `The ${worse} stalls most (${Math.max(stalled.lidar, stalled.camera)} s); check its driver, cable and port.`,
      severity: 'warning',
    };
  }
  return {
    diagnosis:
      `Partly linked stalls (${Math.round(linkedOverlap * 100)}% overlap, strongest at ${bestLag} s lag): ` +
      `more than one cause is likely.`,
    severity: 'warning',
  };
}

/** Analyse per-second LiDAR scan rates and camera frame rates that share the same timestamps. */
export function analyzeSensorHealth(lidar: Point[], camera: Point[]): HealthAnalysis {
  const cameraByTime = new Map<number, number>(camera);
  const aligned = lidar
    .filter(([t]) => cameraByTime.has(t))
    .map(([t, rate]) => ({ t, lidar: rate, camera: cameraByTime.get(t) ?? 0 }));

  const lidarClusters = learnRateClusters(aligned.map((a) => a.lidar));
  const cameraClusters = learnRateClusters(aligned.map((a) => a.camera));
  const lidarStalled = aligned.map((a) => a.lidar <= lidarClusters.threshold);
  const cameraStalled = aligned.map((a) => a.camera <= cameraClusters.threshold);

  const both = lidarStalled.filter((s, i) => s && cameraStalled[i]).length;
  const either = lidarStalled.filter((s, i) => s || cameraStalled[i]).length;
  const overlap = either > 0 ? both / either : 0;

  // Search lags from small to large so that ties resolve to the smallest shift.
  let bestLag = 0;
  let bestShared = both;
  for (let d = 1; d <= MAX_LAG_S; d++) {
    for (const lag of [-d, d]) {
      const shared = sharedStalls(lidarStalled, cameraStalled, lag);
      if (shared > bestShared) {
        bestShared = shared;
        bestLag = lag;
      }
    }
  }
  const linkedOverlap = either > 0 ? bestShared / either : 0;

  const stalledSeconds: StalledSeconds = {
    lidar: lidarStalled.filter(Boolean).length,
    camera: cameraStalled.filter(Boolean).length,
    both,
  };

  return {
    states: aligned.map((a, i) => [a.t, toState(lidarStalled[i], cameraStalled[i])]),
    lidar: lidarClusters,
    camera: cameraClusters,
    seconds: aligned.length,
    stalledSeconds,
    overlap,
    bestLag,
    ...diagnose(stalledSeconds, overlap, linkedOverlap, bestLag, aligned.length),
  };
}
