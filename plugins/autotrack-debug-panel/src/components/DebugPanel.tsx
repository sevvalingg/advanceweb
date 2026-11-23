import React, { useMemo } from 'react';
import { GrafanaTheme2, PanelProps } from '@grafana/data';
import { css, cx } from '@emotion/css';
import { useStyles2, useTheme2 } from '@grafana/ui';
import { PanelDataErrorView } from '@grafana/runtime';
import { DebugOptions } from '../types';
import { DETECTION_LABELS, STATE_KINDS, StateKind, TASK_LABELS } from '../data/columns';
import { DebugState, buildDebugState, formatDuration, formatTime } from '../data/debugState';

export const DEVELOPER = 'Meryem Betül Abdulrahman';

interface Props extends PanelProps<DebugOptions> {}

export function stateColor(theme: GrafanaTheme2, state: string): string {
  const kind: StateKind = STATE_KINDS[state] ?? 'unknown';
  switch (kind) {
    case 'driving':
      return theme.colors.success.main;
    case 'waiting':
      return theme.colors.warning.main;
    case 'manoeuvre':
      return theme.visualization.getColorByName('purple');
    case 'done':
      return theme.colors.info.main;
    case 'idle':
      return theme.colors.secondary.main;
    default:
      return theme.colors.text.secondary;
  }
}

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(1.5)};
    overflow: auto;
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  cards: css`
    display: flex;
    flex-wrap: wrap;
    gap: ${theme.spacing(1)};
  `,
  card: css`
    flex: 1 1 170px;
    padding: ${theme.spacing(1, 1.5)};
    border: 1px solid ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
    background: ${theme.colors.background.secondary};
  `,
  heading: css`
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: ${theme.spacing(0.5)};
  `,
  big: css`
    font-size: ${theme.typography.h3.fontSize};
    font-weight: ${theme.typography.fontWeightMedium};
    line-height: 1.2;
  `,
  muted: css`
    color: ${theme.colors.text.secondary};
  `,
  badge: css`
    display: inline-block;
    padding: ${theme.spacing(0.25, 1)};
    border-radius: ${theme.shape.radius.default};
    color: ${theme.colors.background.primary};
    font-weight: ${theme.typography.fontWeightMedium};
  `,
  metricRow: css`
    display: flex;
    justify-content: space-between;
    gap: ${theme.spacing(1)};
  `,
  tasks: css`
    display: flex;
    flex-wrap: wrap;
    gap: ${theme.spacing(0.5)};
  `,
  task: css`
    padding: ${theme.spacing(0.25, 1)};
    border-radius: 999px;
    border: 1px solid ${theme.colors.border.medium};
    color: ${theme.colors.text.secondary};
  `,
  taskDone: css`
    border-color: ${theme.colors.success.border};
    color: ${theme.colors.success.text};
  `,
  taskCurrent: css`
    border-color: ${theme.colors.primary.border};
    background: ${theme.colors.primary.transparent};
    color: ${theme.colors.text.primary};
    font-weight: ${theme.typography.fontWeightMedium};
  `,
  timeline: css`
    display: flex;
    gap: 1px;
    height: 18px;
    border-radius: ${theme.shape.radius.default};
    overflow: hidden;
    background: ${theme.colors.background.canvas};
  `,
  list: css`
    margin: ${theme.spacing(0.5, 0, 0)};
    padding: 0;
    list-style: none;
    font-family: ${theme.typography.fontFamilyMonospace};
  `,
  footer: css`
    margin-top: auto;
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
    text-align: right;
  `,
});

function Missing({ column }: { column: string }) {
  const styles = useStyles2(getStyles);
  return <div className={styles.muted}>No `{column}` column in this data.</div>;
}

function StateCard({ view }: { view: DebugState }) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const current = view.state.current;
  // A task that is already in tasks_done is not "current" any more (for example after FINISHED).
  const currentTask = view.tasks.items.find((item) => item.status === 'current');
  return (
    <div className={styles.card} data-testid="debug-state">
      <div className={styles.heading}>State</div>
      {!view.state.present ? (
        <Missing column="state" />
      ) : current ? (
        <>
          <span className={cx(styles.badge, styles.big)} style={{ background: stateColor(theme, current.state) }}>
            {current.state}
          </span>
          <div className={styles.muted}>for {formatDuration(current.end - current.start)}</div>
        </>
      ) : (
        <div className={styles.muted}>No state yet</div>
      )}
      {currentTask && <div>Task: {TASK_LABELS[currentTask.id]}</div>}
    </div>
  );
}

function Metric({ label, value, unit, bad }: { label: string; value: number | null; unit: string; bad: boolean }) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  return (
    <div className={styles.metricRow}>
      <span className={styles.muted}>{label}</span>
      <span style={{ color: value !== null && bad ? theme.colors.error.text : undefined, fontWeight: 500 }}>
        {value === null ? '–' : `${value.toFixed(unit === 'ms' ? 0 : 1)} ${unit}`}
      </span>
    </div>
  );
}

function PerceptionCard({ view, options }: { view: DebugState; options: DebugOptions }) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const fps = view.perceptionFps;
  const nothing = !fps.present && !view.cameraFps.present && !view.latencyMs.present;
  return (
    <div className={styles.card} data-testid="debug-perception">
      <div className={styles.heading}>FPS and latency</div>
      {nothing ? (
        <Missing column="perception_fps" />
      ) : (
        <>
          <div
            className={styles.big}
            style={{ color: (fps.value ?? Infinity) < options.fpsTarget ? theme.colors.error.text : undefined }}
          >
            {fps.value === null ? '–' : `${fps.value.toFixed(1)} FPS`}
          </div>
          <div className={styles.muted}>model · target {options.fpsTarget} FPS (NFR-02)</div>
          <Metric label="Camera" value={view.cameraFps.value} unit="FPS" bad={(view.cameraFps.value ?? 1) < 1} />
          <Metric
            label="Latency"
            value={view.latencyMs.value}
            unit="ms"
            bad={(view.latencyMs.value ?? 0) > options.latencyWarnMs}
          />
        </>
      )}
    </div>
  );
}

function DetectionCard({ view }: { view: DebugState }) {
  const styles = useStyles2(getStyles);
  const last = view.detection.last;
  return (
    <div className={styles.card} data-testid="debug-detection">
      <div className={styles.heading}>Last detection</div>
      {!view.detection.present ? (
        <Missing column="detection_class" />
      ) : last ? (
        <>
          <div className={styles.big}>{DETECTION_LABELS[last.cls] ?? last.cls}</div>
          <div className={styles.muted}>
            {last.conf !== null && `${Math.round(last.conf * 100)} % · `}
            {last.distance !== null && `${last.distance.toFixed(2)} m · `}
            {view.now !== null && `${formatDuration(view.now - last.t)} ago`}
          </div>
        </>
      ) : (
        <div className={styles.muted}>Nothing detected yet</div>
      )}
    </div>
  );
}

function TaskList({ view }: { view: DebugState }) {
  const styles = useStyles2(getStyles);
  return (
    <div data-testid="debug-tasks">
      <div className={styles.heading}>
        Course tasks {view.tasks.present && `· ${view.tasks.doneCount} / ${view.tasks.items.length} done`}
      </div>
      {!view.tasks.present ? (
        <Missing column="task" />
      ) : (
        <div className={styles.tasks}>
          {view.tasks.items.map((item) => (
            <span
              key={item.id}
              className={cx(
                styles.task,
                item.status === 'done' && styles.taskDone,
                item.status === 'current' && styles.taskCurrent
              )}
            >
              {item.status === 'done' ? '✓ ' : item.status === 'current' ? '▶ ' : ''}
              {TASK_LABELS[item.id]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Timeline({ view }: { view: DebugState }) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const segments = view.state.segments;
  if (!view.state.present || segments.length === 0) {
    return null;
  }
  const total = Math.max(1, segments[segments.length - 1].end - segments[0].start);
  const recent = segments.slice(-6).reverse();
  return (
    <div data-testid="debug-timeline">
      <div className={styles.heading}>State changes</div>
      <div className={styles.timeline}>
        {segments.map((s) => (
          <div
            key={`${s.state}-${s.start}`}
            title={`${s.state}: ${formatTime(s.start)} for ${formatDuration(s.end - s.start)}`}
            style={{ flexGrow: Math.max(s.end - s.start, total / 500), background: stateColor(theme, s.state) }}
          />
        ))}
      </div>
      <ul className={styles.list}>
        {recent.map((s, i) => {
          const before = segments[segments.length - 1 - i - 1];
          return (
            <li key={`${s.state}-${s.start}`}>
              <span className={styles.muted}>{formatTime(s.start)}</span> {before ? `${before.state} → ` : ''}
              <span style={{ color: stateColor(theme, s.state) }}>{s.state}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Alerts({ view }: { view: DebugState }) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const color = (level: string) =>
    level === 'critical' ? theme.colors.error.text : level === 'warning' ? theme.colors.warning.text : undefined;
  return (
    <div data-testid="debug-alerts">
      <div className={styles.heading}>Alerts from the data source</div>
      {view.alerts === undefined ? (
        <div className={styles.muted}>No alerts frame in this data.</div>
      ) : view.alerts.length === 0 ? (
        <div className={styles.muted}>No alerts</div>
      ) : (
        <ul className={styles.list}>
          {view.alerts
            .slice(-5)
            .reverse()
            .map((a) => (
              <li key={`${a.t}-${a.message}`}>
                <span className={styles.muted}>{formatTime(a.t)}</span>{' '}
                <span style={{ color: color(a.level) }}>{a.level.toUpperCase()}</span> {a.message}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

export const DebugPanel: React.FC<Props> = ({ options, data, width, height, fieldConfig, id }) => {
  const styles = useStyles2(getStyles);
  const view = useMemo(() => buildDebugState(data.series), [data.series]);

  if (data.series.length === 0) {
    return <PanelDataErrorView fieldConfig={fieldConfig} panelId={id} data={data} />;
  }

  return (
    <div className={styles.wrapper} style={{ width, height }} data-testid="debug-panel">
      <div className={styles.cards}>
        <StateCard view={view} />
        <PerceptionCard view={view} options={options} />
        <DetectionCard view={view} />
      </div>
      <TaskList view={view} />
      {options.showTimeline && <Timeline view={view} />}
      {options.showAlerts && <Alerts view={view} />}
      <div className={styles.footer}>Developed by {DEVELOPER} · AutoTrack AI</div>
    </div>
  );
};
