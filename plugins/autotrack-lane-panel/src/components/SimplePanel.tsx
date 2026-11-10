import React from 'react';
import { DataFrame, FieldType, GrafanaTheme2, PanelProps, getFieldDisplayName } from '@grafana/data';
import { useStyles2, useTheme2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { SimpleOptions } from 'types';

interface Props extends PanelProps<SimpleOptions> {}

interface Signal {
  name: string;
  values: number[];
  last: number | null;
}

// Bir veri serisinden sayısal değerleri ve son değeri okur
function readSignal(frame: DataFrame): Signal | null {
  const field = frame.fields.find((f) => f.type === FieldType.number);
  if (!field) {
    return null;
  }
  const values: number[] = [];
  for (const v of field.values) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      values.push(v);
    }
  }
  return {
    name: getFieldDisplayName(field, frame),
    values,
    last: values.length > 0 ? values[values.length - 1] : null,
  };
}

// Son değerlerin küçük çizgi grafiği
const Sparkline = ({ values, color }: { values: number[]; color: string }) => {
  const recent = values.slice(-200);
  if (recent.length < 2) {
    return null;
  }
  const min = recent.reduce((a, b) => Math.min(a, b), Infinity);
  const max = recent.reduce((a, b) => Math.max(a, b), -Infinity);
  const range = max - min || 1;
  const points = recent
    .map((v, i) => `${(i / (recent.length - 1)) * 100},${30 - ((v - min) / range) * 30}`)
    .join(' ');
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" width="100%" height={40}>
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

// Ortadan sağa (ileri) ya da sola (geri) dolan hız çubuğu
const SpeedBar = ({ speed, max, color, track }: { speed: number; max: number; color: string; track: string }) => {
  const ratio = Math.max(-1, Math.min(1, speed / max));
  const width = Math.abs(ratio) * 50;
  const left = ratio >= 0 ? 50 : 50 - width;
  return (
    <div style={{ position: 'relative', width: '100%', height: 12, background: track, borderRadius: 6 }}>
      <div style={{ position: 'absolute', left: `${left}%`, width: `${width}%`, top: 0, bottom: 0, background: color, borderRadius: 6 }} />
      <div style={{ position: 'absolute', left: '50%', top: -3, bottom: -3, width: 2, background: '#999' }} />
    </div>
  );
};

// Direksiyon açısına göre dönen simit (görünür olsun diye açı 3 katına çıkarılıyor)
const SteeringWheel = ({ angle, color }: { angle: number; color: string }) => (
  <svg viewBox="-50 -50 100 100" width={110} height={110}>
    <g transform={`rotate(${angle * 3})`}>
      <circle r={40} fill="none" stroke={color} strokeWidth={6} />
      <line x1={-40} y1={0} x2={40} y2={0} stroke={color} strokeWidth={5} />
      <line x1={0} y1={0} x2={0} y2={40} stroke={color} strokeWidth={5} />
      <circle r={7} fill={color} />
      <circle cx={0} cy={-40} r={5} fill="#f2495c" />
    </g>
  </svg>
);

export const SimplePanel: React.FC<Props> = ({ data, width, height }) => {
  const theme = useTheme2();
  const styles = useStyles2(getStyles);

  const signals = data.series.map(readSignal).filter((s): s is Signal => s !== null);
  const speed = signals.find((s) => /speed|hız/i.test(s.name));
  const steering = signals.find((s) => /steer|direksiyon/i.test(s.name));

  const speedMax = speed ? Math.max(1, ...speed.values.slice(-500).map((v) => Math.abs(v))) : 1;

  return (
    <div className={styles.wrapper} style={{ width, height }}>
      <div className={styles.cards}>
        <div className={styles.card}>
          <div className={styles.title}>Hız</div>
          {speed && speed.last !== null ? (
            <>
              <div className={styles.value}>{speed.last.toFixed(2)} m/s</div>
              <SpeedBar speed={speed.last} max={speedMax} color={theme.colors.success.main} track={theme.colors.background.canvas} />
              <Sparkline values={speed.values} color={theme.colors.success.main} />
            </>
          ) : (
            <div className={styles.empty}>Hız verisi yok</div>
          )}
        </div>

        <div className={styles.card}>
          <div className={styles.title}>Direksiyon</div>
          {steering && steering.last !== null ? (
            <>
              <SteeringWheel angle={steering.last} color={theme.colors.primary.main} />
              <div className={styles.value}>{steering.last.toFixed(1)}°</div>
              <Sparkline values={steering.values} color={theme.colors.primary.main} />
            </>
          ) : (
            <div className={styles.empty}>Direksiyon verisi yok</div>
          )}
        </div>
      </div>

      <div className={styles.footer}>Developed by Şevval Boyraz · AutoTrack AI</div>
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(1)};
    overflow: auto;
  `,
  cards: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: ${theme.spacing(1)};
    flex: 1;
  `,
  card: css`
    background: ${theme.colors.background.secondary};
    border-radius: ${theme.shape.radius.default};
    padding: ${theme.spacing(1.5)};
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: ${theme.spacing(1)};
  `,
  title: css`
    align-self: flex-start;
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  value: css`
    font-size: 28px;
    font-weight: ${theme.typography.fontWeightMedium};
  `,
  empty: css`
    margin: auto;
    color: ${theme.colors.text.disabled};
  `,
  footer: css`
    text-align: right;
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
});