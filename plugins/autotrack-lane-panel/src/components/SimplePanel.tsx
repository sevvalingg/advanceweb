import React from 'react';
import { DataFrame, FieldType, GrafanaTheme2, PanelProps, getFieldDisplayName } from '@grafana/data';
import { useStyles2, useTheme2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { SimpleOptions } from 'types';
import {
  CLIP_CM,
  LANE_WIDTH_CM,
  Sample,
  downsample,
  findJumps,
  laneLossSpans,
  maskByLineCount,
  steeringAtLimit,
  summarize,
  toCm,
  radFactor,
} from '../laneMetrics';

interface Props extends PanelProps<SimpleOptions> {}

interface Signal {
  name: string;
  samples: Sample[];
}

// Tüm veri serilerindeki sayısal alanları zamanlarıyla birlikte okur
function readSignals(frames: DataFrame[]): Signal[] {
  const out: Signal[] = [];
  for (const frame of frames) {
    const time = frame.fields.find((f) => f.type === FieldType.time);
    for (const field of frame.fields) {
      if (field.type !== FieldType.number) {
        continue;
      }
      const samples: Sample[] = [];
      for (let i = 0; i < field.values.length; i++) {
        const raw = field.values[i];
        samples.push({
          t: time ? Number(time.values[i]) : i,
          v: typeof raw === 'number' && Number.isFinite(raw) ? raw : null,
        });
      }
      out.push({ name: getFieldDisplayName(field, frame, frames), samples });
    }
  }
  return out;
}

const lastValid = (samples: Sample[]): number | null => {
  for (let i = samples.length - 1; i >= 0; i--) {
    if (samples[i].v !== null) {
      return samples[i].v;
    }
  }
  return null;
};

// Önce ortak formattaki kesin sütun adına, bulunamazsa daha genel adlara bakar
const pick = (signals: Signal[], patterns: RegExp[]) => {
  for (const p of patterns) {
    const found = signals.find((s) => p.test(s.name));
    if (found) {
      return found;
    }
  }
  return undefined;
};

const fmt = (v: number, digits = 1) => v.toLocaleString('tr-TR', { maximumFractionDigits: digits, minimumFractionDigits: digits });

// ---------- Şerit sapması grafiği ----------
const Y_RANGE_CM = 40;
const CHART_W = 1000;
const CHART_H = 200;

const LaneChart = ({
  samples,
  jumps,
  bandCm,
  theme,
}: {
  samples: Sample[];
  jumps: number[];
  bandCm: number;
  theme: GrafanaTheme2;
}) => {
  if (samples.length < 2) {
    return null;
  }
  const t0 = samples[0].t;
  const t1 = samples[samples.length - 1].t;
  const span = t1 - t0 || 1;
  const x = (t: number) => ((t - t0) / span) * CHART_W;
  const y = (v: number) => ((Y_RANGE_CM - Math.max(-Y_RANGE_CM, Math.min(Y_RANGE_CM, v))) / (2 * Y_RANGE_CM)) * CHART_H;

  // Kısa boşlukları (< 500 ms) çizgiyle birleştir, uzun şerit kayıplarında çizgiyi kes ve gri boya
  const losses = laneLossSpans(samples, 500);
  let path = '';
  let lastT: number | null = null;
  for (const s of downsample(samples, 1500)) {
    if (s.v === null) {
      continue;
    }
    const join = lastT !== null && s.t - lastT < 500;
    path += `${join ? 'L' : 'M'}${x(s.t).toFixed(1)},${y(s.v).toFixed(1)} `;
    lastT = s.t;
  }

  const hLine = (v: number, color: string, dash?: string) => (
    <line x1={0} x2={CHART_W} y1={y(v)} y2={y(v)} stroke={color} strokeDasharray={dash} vectorEffect="non-scaling-stroke" />
  );
  const label = (v: number, text: string, right = false) => (
    <span style={{ position: 'absolute', [right ? 'right' : 'left']: 4, top: `calc(${(y(v) / CHART_H) * 100}% - 8px)`, fontSize: 10, color: theme.colors.text.secondary }}>
      {text}
    </span>
  );
  const half = LANE_WIDTH_CM / 2;

  return (
    <div style={{ position: 'relative', width: '100%', height: CHART_H }}>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" width="100%" height={CHART_H}>
        <rect x={0} width={CHART_W} y={y(bandCm)} height={y(-bandCm) - y(bandCm)} fill={theme.colors.success.main} opacity={0.12} />
        {hLine(half, theme.colors.text.primary, '6 4')}
        {hLine(-half, theme.colors.text.primary, '6 4')}
        {hLine(CLIP_CM, theme.colors.warning.main, '2 3')}
        {hLine(-CLIP_CM, theme.colors.warning.main, '2 3')}
        {losses.map((l) => (
          <rect key={l.t0} x={x(l.t0)} width={Math.max(1, x(l.t1) - x(l.t0))} y={0} height={CHART_H} fill={theme.colors.text.disabled} opacity={0.25} />
        ))}
        {hLine(0, theme.colors.border.medium)}
        {jumps.map((i) => (
          <line
            key={i}
            x1={x(samples[i].t)}
            x2={x(samples[i].t)}
            y1={0}
            y2={CHART_H}
            stroke={theme.colors.error.main}
            opacity={0.35}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={path} fill="none" stroke={theme.colors.primary.main} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      {label(half, 'şerit kenarı')}
      {label(CLIP_CM, 'kırpma ±30', true)}
      {label(0, '0')}
    </div>
  );
};

// ---------- Yukarıdan görünüş ----------
const TopDown = ({
  offsetCm,
  headingRad,
  bandCm,
  theme,
}: {
  offsetCm: number | null;
  headingRad: number | null;
  bandCm: number;
  theme: GrafanaTheme2;
}) => {
  const half = LANE_WIDTH_CM / 2;
  const tape = 5.5;
  const carW = 20;
  const carL = 34;
  const color =
    offsetCm === null
      ? theme.colors.text.disabled
      : Math.abs(offsetCm) < bandCm
        ? theme.colors.success.main
        : Math.abs(offsetCm) < CLIP_CM
          ? theme.colors.warning.main
          : theme.colors.error.main;
  // Pozitif sapma = araç solda, bu yüzden çizimde x ekseni ters
  const cx = offsetCm === null ? 0 : -Math.max(-half, Math.min(half, offsetCm));
  // Pozitif açı = sola; SVG'de saat yönü pozitif olduğu için işaret ters. ±60° ile sınırlı.
  const rot = headingRad === null ? 0 : Math.max(-60, Math.min(60, (-headingRad * 180) / Math.PI));

  return (
    <svg viewBox="-48 0 96 110" width="100%" height={170}>
      <rect x={-half - tape / 2} y={0} width={tape} height={110} fill={theme.colors.text.primary} opacity={0.8} />
      <rect x={half - tape / 2} y={0} width={tape} height={110} fill={theme.colors.text.primary} opacity={0.8} />
      <line x1={0} x2={0} y1={0} y2={110} stroke={theme.colors.text.secondary} strokeDasharray="4 4" strokeWidth={0.6} />
      {offsetCm === null ? (
        <text x={0} y={58} textAnchor="middle" fontSize={7} fill={theme.colors.text.secondary}>
          Şerit bulunamadı
        </text>
      ) : (
        <g transform={`translate(${cx}, 55) rotate(${rot})`}>
          <rect x={-carW / 2} y={-carL / 2} width={carW} height={carL} rx={3} fill={color} opacity={0.85} />
          <polygon points={`0,${-carL / 2 - 5} -4,${-carL / 2} 4,${-carL / 2}`} fill={color} />
        </g>
      )}
    </svg>
  );
};

// ---------- Direksiyon simidi ----------
const SteeringWheel = ({ rad, color }: { rad: number; color: string }) => {
  // Sola artı radyan; SVG'de saat yönü artı olduğu için işaret ters. Görünür olsun diye 3 katı.
  const deg = (-rad * 180 * 3) / Math.PI;
  return (
    <svg viewBox="-50 -50 100 100" width={80} height={80}>
      <g transform={`rotate(${deg})`}>
        <circle r={40} fill="none" stroke={color} strokeWidth={7} />
        <line x1={-40} y1={0} x2={40} y2={0} stroke={color} strokeWidth={6} />
        <line x1={0} y1={0} x2={0} y2={40} stroke={color} strokeWidth={6} />
        <circle cx={0} cy={-40} r={6} fill="#f2495c" />
      </g>
    </svg>
  );
};

export const SimplePanel: React.FC<Props> = ({ data, width, height, options }) => {
  const theme = useTheme2();
  const styles = useStyles2(getStyles);
  const bandCm = options.goodBandCm ?? 10;
  const jumpCm = options.jumpThresholdCm ?? 10;

  const signals = readSignals(data.series);
  // Ortak veri formatı (docs/data-format.md) ile telemetry_node sütun adları
  const laneSig = pick(signals, [/\blateral_error_m\b/i, /lateral|lane.?error|sapma|offset|deviation/i]);
  const headingSig = pick(signals, [/\bheading_error_rad\b/i, /heading/i]);
  const linesSig = pick(signals, [/\bline_count\b/i, /line.?count|çizgi/i]);
  const speedSig = pick(signals, [/\bspeed_out\b/i, /\bspeed_cmd\b/i, /speed command/i, /^(?!.*odom).*(speed|hız|hiz)/i]);
  const steerSig = pick(signals, [/\bsteering_cmd\b/i, /steer|direksiyon/i]);

  // Sapma: pozitif = araç şerit ortasının solunda. Çizgi görülmeyen anlar "şerit yok".
  const sign = options.invertOffset ? -1 : 1;
  const lane = laneSig
    ? maskByLineCount(toCm(laneSig.samples), linesSig ? linesSig.samples : []).map((s) => ({
        t: s.t,
        v: s.v === null ? null : sign * s.v,
      }))
    : [];
  const laneNow = lane.length ? lane[lane.length - 1].v : null;
  const headingRaw = headingSig ? headingSig.samples[headingSig.samples.length - 1]?.v ?? null : null;
  const headingRad = headingRaw === null || !headingSig ? null : sign * headingRaw * radFactor(headingSig.samples);
  const linesNow = linesSig && linesSig.samples.length ? linesSig.samples[linesSig.samples.length - 1].v : null;
  const jumps = findJumps(lane, jumpCm);
  const summary = lane.length ? summarize(lane, bandCm, jumpCm) : null;

  const speed = speedSig ? lastValid(speedSig.samples) : null;
  const steerRaw = steerSig ? lastValid(steerSig.samples) : null;
  const steerRad = steerRaw === null || !steerSig ? null : steerRaw * radFactor(steerSig.samples);
  const limit = steerRad === null ? null : steeringAtLimit(steerRad);

  const laneColor =
    laneNow === null
      ? theme.colors.text.disabled
      : Math.abs(laneNow) < bandCm
        ? theme.colors.success.text
        : Math.abs(laneNow) < CLIP_CM
          ? theme.colors.warning.text
          : theme.colors.error.text;

  const tile = (labelText: string, value: string, good?: boolean) => (
    <div className={styles.tile}>
      <div className={styles.tileLabel}>{labelText}</div>
      <div
        className={styles.tileValue}
        style={good === undefined ? undefined : { color: good ? theme.colors.success.text : theme.colors.warning.text }}
      >
        {value}
      </div>
    </div>
  );

  return (
    <div className={styles.wrapper} style={{ width, height }}>
      {/* Anlık değerler */}
      <div className={styles.row}>
        <div className={styles.card}>
          <div className={styles.title}>Şerit sapması</div>
          {laneSig ? (
            <div className={styles.big} style={{ color: laneColor }}>
              {laneNow === null ? 'Şerit yok' : `${fmt(laneNow)} cm`}
            </div>
          ) : (
            <div className={styles.empty}>Sapma verisi yok</div>
          )}
          {laneSig && (
            <div className={styles.sub}>
              {laneNow === null ? '' : laneNow > 0 ? 'Araç solda · ' : laneNow < 0 ? 'Araç sağda · ' : ''}
              {linesNow === null ? '' : `${linesNow} çizgi görülüyor`}
            </div>
          )}
        </div>
        <div className={styles.card}>
          <div className={styles.title}>Hız</div>
          <div className={styles.big}>{speed === null ? '–' : `${fmt(speed, 2)} m/s`}</div>
        </div>
        <div className={styles.card} style={limit ? { outline: `2px solid ${theme.colors.warning.main}` } : undefined}>
          <div className={styles.title}>Direksiyon</div>
          {steerRad === null ? (
            <div className={styles.empty}>Direksiyon verisi yok</div>
          ) : (
            <div className={styles.steer}>
              <SteeringWheel rad={steerRad} color={limit ? theme.colors.warning.main : theme.colors.primary.main} />
              <div>
                <div className={styles.big}>{fmt(steerRad, 2)} rad</div>
                <div className={styles.sub}>
                  {limit ? `Sınırda (${limit === 'left' ? 'sol' : 'sağ'})` : `${fmt((steerRad * 180) / Math.PI)}°`}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Grafik ve yukarıdan görünüş */}
      {laneSig && (
        <div className={styles.chartRow}>
          <div className={styles.card}>
            <div className={styles.title}>
              Sapma (cm) · yeşil bant ±{bandCm} cm · kırmızı: {jumps.length} zıplama (&gt;{jumpCm} cm/kare) · gri: şerit kaybı (≥ 0,5 sn)
            </div>
            <LaneChart samples={lane} jumps={jumps} bandCm={bandCm} theme={theme} />
          </div>
          <div className={styles.card}>
            <div className={styles.title}>Yukarıdan görünüş · şerit {fmt(LANE_WIDTH_CM)} cm</div>
            <TopDown offsetCm={laneNow} headingRad={laneNow === null ? null : headingRad} bandCm={bandCm} theme={theme} />
          </div>
        </div>
      )}

      {/* Sürüş karnesi */}
      {summary && (
        <div className={styles.card}>
          <div className={styles.title}>Sürüş karnesi (seçili zaman aralığı)</div>
          <div className={styles.tiles}>
            {tile(`Şeritte kalma (< ${bandCm} cm)`, `%${fmt(summary.inBandPct)}`, summary.inBandPct >= 80)}
            {tile('Şerit bulunma', `%${fmt(summary.validPct)}`, summary.validPct >= 95)}
            {tile('Ortalama |sapma|', `${fmt(summary.meanAbsCm)} cm`)}
            {tile('RMS', `${fmt(summary.rmsCm)} cm`)}
            {tile('%95', `${fmt(summary.p95Cm)} cm`)}
            {tile('En büyük', `${fmt(summary.maxAbsCm)} cm`)}
            {tile('Kırpmada', `%${fmt(summary.clippedPct)}`, summary.clippedPct < 5)}
            {tile('Zıplama', `${summary.jumps}`, summary.jumps === 0)}
            {tile('Şerit kaybı (≥ 0,5 sn)', `${summary.laneLosses}`, summary.laneLosses === 0)}
          </div>
        </div>
      )}

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
  row: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: ${theme.spacing(1)};
  `,
  chartRow: css`
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(160px, 1fr);
    gap: ${theme.spacing(1)};
    @media (max-width: 700px) {
      grid-template-columns: 1fr;
    }
  `,
  card: css`
    background: ${theme.colors.background.secondary};
    border-radius: ${theme.shape.radius.default};
    padding: ${theme.spacing(1, 1.5)};
    min-width: 0;
  `,
  title: css`
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
    margin-bottom: ${theme.spacing(0.5)};
  `,
  big: css`
    font-size: 24px;
    font-weight: ${theme.typography.fontWeightMedium};
    font-variant-numeric: tabular-nums;
  `,
  sub: css`
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  steer: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1.5)};
  `,
  empty: css`
    color: ${theme.colors.text.disabled};
    padding: ${theme.spacing(1, 0)};
  `,
  tiles: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(105px, 1fr));
    gap: ${theme.spacing(1)};
  `,
  tile: css`
    background: ${theme.colors.background.canvas};
    border-radius: ${theme.shape.radius.default};
    padding: ${theme.spacing(0.75, 1)};
  `,
  tileLabel: css`
    color: ${theme.colors.text.secondary};
    font-size: 11px;
  `,
  tileValue: css`
    font-size: 18px;
    font-weight: ${theme.typography.fontWeightMedium};
    font-variant-numeric: tabular-nums;
  `,
  footer: css`
    text-align: right;
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
});
