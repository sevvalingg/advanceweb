export interface DebugOptions {
  /** NFR-02: the perception pipeline must reach at least this many frames per second. */
  fpsTarget: number;
  /** Perception latency above this is shown as a warning. */
  latencyWarnMs: number;
  showTimeline: boolean;
  showAlerts: boolean;
}

export const DEFAULT_OPTIONS: DebugOptions = {
  fpsTarget: 15,
  latencyWarnMs: 100,
  showTimeline: true,
  showAlerts: true,
};
