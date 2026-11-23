import { PanelPlugin } from '@grafana/data';
import { DebugOptions, DEFAULT_OPTIONS } from './types';
import { DebugPanel } from './components/DebugPanel';

export const plugin = new PanelPlugin<DebugOptions>(DebugPanel).setPanelOptions((builder) => {
  return builder
    .addNumberInput({
      path: 'fpsTarget',
      name: 'FPS target',
      description: 'Frames per second the perception pipeline must reach (NFR-02). Lower values are shown in red.',
      defaultValue: DEFAULT_OPTIONS.fpsTarget,
      settings: { min: 1, integer: true },
    })
    .addNumberInput({
      path: 'latencyWarnMs',
      name: 'Latency warning (ms)',
      description: 'Perception latency above this value is shown as a warning.',
      defaultValue: DEFAULT_OPTIONS.latencyWarnMs,
      settings: { min: 1, integer: true },
    })
    .addBooleanSwitch({
      path: 'showTimeline',
      name: 'Show state timeline',
      defaultValue: DEFAULT_OPTIONS.showTimeline,
    })
    .addBooleanSwitch({
      path: 'showAlerts',
      name: 'Show alerts',
      defaultValue: DEFAULT_OPTIONS.showAlerts,
    });
});
