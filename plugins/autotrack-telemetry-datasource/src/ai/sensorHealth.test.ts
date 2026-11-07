import { HealthState, Point, analyzeSensorHealth, learnRateClusters } from './sensorHealth';

const LIDAR_HZ = 10;
const CAMERA_FPS = 15;

/** Per-second rate series of `seconds` points; the listed seconds have a rate of 0 (stalled). */
function series(seconds: number, stalled: number[], healthyRate: number): Point[] {
  const stalledSet = new Set(stalled);
  return Array.from({ length: seconds }, (_, i) => [i * 1000, stalledSet.has(i) ? 0 : healthyRate]);
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

describe('learnRateClusters (1-D k-means, k = 2)', () => {
  it('separates stalled and healthy rates and learns a threshold between them', () => {
    const clusters = learnRateClusters([0, 0, 1, 10, 11, 9, 10]);
    expect(clusters.stalledCentroid).toBeCloseTo(0.33, 1);
    expect(clusters.healthyCentroid).toBeCloseTo(10, 5);
    expect(clusters.threshold).toBeGreaterThan(1);
    expect(clusters.threshold).toBeLessThan(9);
  });

  it('does not invent a stalled cluster when every second is healthy', () => {
    const clusters = learnRateClusters([9, 10, 11, 10, 9]);
    expect(clusters.threshold).toBe(-Infinity);
  });

  it('handles an empty series', () => {
    expect(learnRateClusters([]).threshold).toBe(-Infinity);
  });
});

describe('analyzeSensorHealth', () => {
  it('reports a system-level cause when both sensors stall in the same seconds', () => {
    const stalls = range(5, 9);
    const result = analyzeSensorHealth(series(30, stalls, LIDAR_HZ), series(30, stalls, CAMERA_FPS));

    expect(result.overlap).toBe(1);
    expect(result.bestLag).toBe(0);
    expect(result.stalledSeconds).toEqual({ lidar: 5, camera: 5, both: 5 });
    expect(result.severity).toBe('warning');
    expect(result.diagnosis).toContain('System-level');
    expect(result.states[0]).toEqual([0, HealthState.Healthy]);
    expect(result.states[5]).toEqual([5000, HealthState.BothStalled]);
  });

  it('reports no stalls for a healthy recording', () => {
    const result = analyzeSensorHealth(series(30, [], LIDAR_HZ), series(30, [], CAMERA_FPS));

    expect(result.stalledSeconds).toEqual({ lidar: 0, camera: 0, both: 0 });
    expect(result.severity).toBe('info');
    expect(result.diagnosis).toContain('No sensor stalls');
  });

  it('finds the lag when the LiDAR stalls one second before the camera', () => {
    const lidarStalls = [...range(2, 7), ...range(17, 22)];
    const cameraStalls = [...range(3, 8), ...range(18, 23)];
    const result = analyzeSensorHealth(series(30, lidarStalls, LIDAR_HZ), series(30, cameraStalls, CAMERA_FPS));

    expect(result.bestLag).toBe(1);
    expect(result.diagnosis).toContain('the LiDAR stalls about 1 s before');
  });

  it('reports sensor-specific causes when the stalls are independent', () => {
    const result = analyzeSensorHealth(series(30, range(2, 4), LIDAR_HZ), series(30, range(15, 17), CAMERA_FPS));

    expect(result.overlap).toBe(0);
    expect(result.diagnosis).toContain('Mostly independent');
    expect(result.states[2]).toEqual([2000, HealthState.LidarStalled]);
    expect(result.states[15]).toEqual([15000, HealthState.CameraStalled]);
  });
});
