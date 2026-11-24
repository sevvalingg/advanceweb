// AutoTrack AI – şerit sapması hesapları (Grafana'dan bağımsız, test edilebilir)
// Developed by Şevval Boyraz

// Pist ve araç ölçüleri (WP8 Test ve Doğrulama Belgesi, 19 Kasım 2026)
export const LANE_WIDTH_CM = 67.5; // bant ortasından bant ortasına
export const CLIP_CM = 30; // şerit ölçümü bu değerde kırpılıyor
export const STEER_LEFT_RAD = 0.31; // ölçülen sola direksiyon sınırı
export const STEER_RIGHT_RAD = -0.26; // ölçülen sağa direksiyon sınırı
const STEER_MARGIN_RAD = 0.01;

/** Bir ölçüm: zaman (ms) ve değer. Değer yoksa (şerit bulunamadı) null. */
export interface Sample {
  t: number;
  v: number | null;
}

const isNum = (v: number | null): v is number => v !== null && Number.isFinite(v);

/** Değerler metre cinsindeyse (hepsi |v| <= 1,5) santimetreye çevirir. */
export function toCm(samples: Sample[]): Sample[] {
  const maxAbs = samples.reduce((m, s) => (isNum(s.v) ? Math.max(m, Math.abs(s.v)) : m), 0);
  const factor = maxAbs > 0 && maxAbs <= 1.5 ? 100 : 1;
  return samples.map((s) => ({ t: s.t, v: isNum(s.v) ? s.v * factor : null }));
}

/**
 * Direksiyon serisinin radyana çevirme çarpanı. Serideki en büyük |değer| 1'den büyükse
 * seri derece kabul edilir (±0,34 rad sınırı derecede ±19,5 eder).
 */
export function radFactor(samples: Sample[]): number {
  const maxAbs = samples.reduce((m, s) => (isNum(s.v) ? Math.max(m, Math.abs(s.v)) : m), 0);
  return maxAbs > 1 ? Math.PI / 180 : 1;
}

/** Direksiyon ölçülen sınıra dayanmış mı? */
export function steeringAtLimit(rad: number): 'left' | 'right' | null {
  if (rad >= STEER_LEFT_RAD - STEER_MARGIN_RAD) {
    return 'left';
  }
  if (rad <= STEER_RIGHT_RAD + STEER_MARGIN_RAD) {
    return 'right';
  }
  return null;
}

/**
 * Zıplamaları bulur: art arda iki geçerli ölçüm arasındaki fark eşikten büyükse
 * ikinci ölçümün indeksini döndürür. 0,3 m/s'de bir karede 10 cm'lik değişim fiziksel olarak imkânsız.
 */
export function findJumps(samples: Sample[], thresholdCm: number): number[] {
  const jumps: number[] = [];
  let prev: number | null = null;
  samples.forEach((s, i) => {
    if (!isNum(s.v)) {
      prev = null; // şerit kaybından sonraki ilk ölçüm zıplama sayılmaz
      return;
    }
    if (prev !== null && Math.abs(s.v - prev) > thresholdCm) {
      jumps.push(i);
    }
    prev = s.v;
  });
  return jumps;
}

/** Şerit kaybı aralığı (ms). */
export interface Span {
  t0: number;
  t1: number;
}

/**
 * Şerit kaybı aralıklarını bulur: en az minMs süren ölçümsüz bölümler.
 * Daha kısa boşluklar (tek tük kaçan kareler) kayıp sayılmaz.
 */
export function laneLossSpans(samples: Sample[], minMs = 500): Span[] {
  const spans: Span[] = [];
  let start: number | null = null;
  samples.forEach((s, i) => {
    const valid = isNum(s.v);
    if (!valid && start === null) {
      start = s.t;
    }
    const end = valid ? s.t : i === samples.length - 1 ? s.t : null;
    if (start !== null && end !== null) {
      if (end - start >= minMs) {
        spans.push({ t0: start, t1: end });
      }
      if (valid) {
        start = null;
      }
    }
  });
  return spans;
}

/** Şerit kaybı sayısı: en az minMs süren ölçümsüz bölümlerin sayısı. */
export function countLaneLosses(samples: Sample[], minMs = 500): number {
  return laneLossSpans(samples, minMs).length;
}

export interface LaneSummary {
  samples: number; // toplam ölçüm
  validPct: number; // şeridin bulunduğu ölçümlerin yüzdesi
  inBandPct: number; // |sapma| < bant olan ölçümlerin yüzdesi (geçerliler içinde)
  meanAbsCm: number;
  rmsCm: number;
  p95Cm: number;
  maxAbsCm: number;
  clippedPct: number; // kırpma sınırına dayanan ölçümlerin yüzdesi
  jumps: number;
  laneLosses: number;
}

/** analyze_run.py'deki sürüş karnesinin tarayıcı versiyonu. Girdi santimetre cinsinden olmalı. */
export function summarize(samples: Sample[], bandCm: number, jumpThresholdCm: number): LaneSummary {
  const valid = samples.map((s) => s.v).filter(isNum);
  const abs = valid.map((v) => Math.abs(v)).sort((a, b) => a - b);
  const n = abs.length;
  const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

  return {
    samples: samples.length,
    validPct: pct(n, samples.length),
    inBandPct: pct(abs.filter((a) => a < bandCm).length, n),
    meanAbsCm: n ? abs.reduce((a, b) => a + b, 0) / n : 0,
    rmsCm: n ? Math.sqrt(valid.reduce((a, v) => a + v * v, 0) / n) : 0,
    p95Cm: n ? abs[Math.min(n - 1, Math.ceil(n * 0.95) - 1)] : 0,
    maxAbsCm: n ? abs[n - 1] : 0,
    clippedPct: pct(abs.filter((a) => a >= CLIP_CM - 0.5).length, n),
    jumps: findJumps(samples, jumpThresholdCm).length,
    laneLosses: countLaneLosses(samples),
  };
}

/**
 * Çizgi sayısı 0 olan anlardaki sapma ölçümlerini "şerit yok" (null) yapar.
 * Her sapma ölçümü için, zamanı ondan önce ya da aynı olan en son çizgi sayısına bakılır.
 */
export function maskByLineCount(lane: Sample[], lines: Sample[]): Sample[] {
  if (!lines.length) {
    return lane;
  }
  let j = -1;
  return lane.map((s) => {
    while (j + 1 < lines.length && lines[j + 1].t <= s.t) {
      j++;
    }
    const count = j >= 0 ? lines[j].v : null;
    return count === 0 ? { t: s.t, v: null } : s;
  });
}

/** Grafik için en fazla maxPoints ölçüm bırakır (zıplamaları kaybetmemek için indeksleri korur). */
export function downsample(samples: Sample[], maxPoints: number): Array<Sample & { i: number }> {
  const step = Math.max(1, Math.ceil(samples.length / maxPoints));
  const out: Array<Sample & { i: number }> = [];
  for (let i = 0; i < samples.length; i += step) {
    out.push({ ...samples[i], i });
  }
  return out;
}
