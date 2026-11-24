import { countLaneLosses, findJumps, maskByLineCount, radFactor, Sample, steeringAtLimit, summarize, toCm } from './laneMetrics';

const s = (values: Array<number | null>): Sample[] => values.map((v, i) => ({ t: i * 66, v }));

describe('toCm', () => {
  it('metre değerlerini santimetreye çevirir', () => {
    expect(toCm(s([0.1, -0.3])).map((x) => x.v)).toEqual([10, -30]);
  });
  it('zaten santimetre olan değerlere dokunmaz', () => {
    expect(toCm(s([12, -25])).map((x) => x.v)).toEqual([12, -25]);
  });
  it('eksik ölçümleri null bırakır', () => {
    expect(toCm(s([0.1, null])).map((x) => x.v)).toEqual([10, null]);
  });
});

describe('radFactor ve steeringAtLimit', () => {
  it('derece serisini tanır, küçük derece değerlerini radyan sanmaz', () => {
    expect(radFactor(s([0.5, 18, -12]))).toBeCloseTo(Math.PI / 180);
    expect(radFactor(s([0.2, -0.3]))).toBe(1);
  });
  it('ölçülen sınırları tanır', () => {
    expect(steeringAtLimit(0.31)).toBe('left');
    expect(steeringAtLimit(-0.26)).toBe('right');
    expect(steeringAtLimit(0.1)).toBeNull();
  });
});

describe('findJumps', () => {
  it('bir karede eşikten büyük değişimi bulur', () => {
    expect(findJumps(s([0, 2, 25, 24, 3]), 10)).toEqual([2, 4]);
  });
  it('şerit kaybından sonraki ilk ölçümü zıplama saymaz', () => {
    expect(findJumps(s([0, null, 25]), 10)).toEqual([]);
  });
});

describe('countLaneLosses', () => {
  // s() örnekleri 66 ms arayla üretir
  it('kısa boşlukları değil, en az 500 ms süren kayıpları sayar', () => {
    const v = [1, null, 2, ...Array(10).fill(null), 3];
    expect(countLaneLosses(s(v))).toBe(1);
  });
  it('eşik verilirse ona göre sayar', () => {
    expect(countLaneLosses(s([1, null, null, 2, null, 3]), 0)).toBe(2);
  });
});

describe('summarize', () => {
  it('sürüş karnesini hesaplar', () => {
    const r = summarize(s([5, -5, 20, null, 30]), 10, 10);
    expect(r.samples).toBe(5);
    expect(r.validPct).toBe(80);
    expect(r.inBandPct).toBe(50);
    expect(r.maxAbsCm).toBe(30);
    expect(r.meanAbsCm).toBe(15);
    expect(r.clippedPct).toBe(25);
    expect(r.jumps).toBe(1); // -5→20 zıplama; 5→-5 değil (fark 10, eşikten büyük değil)
    expect(r.laneLosses).toBe(0); // tek karelik boşluk kayıp sayılmaz
  });
  it('boş veride hata vermez', () => {
    expect(summarize([], 10, 10).rmsCm).toBe(0);
  });
});

describe('maskByLineCount', () => {
  it('çizgi sayısı 0 olan anlardaki ölçümü şerit yok sayar', () => {
    const lane = s([0.1, 0.2, 0.0, 0.1]);
    const lines = s([2, 1, 0, 2]);
    expect(maskByLineCount(lane, lines).map((x) => x.v)).toEqual([0.1, 0.2, null, 0.1]);
  });
  it('çizgi sayısı yoksa ölçümlere dokunmaz', () => {
    expect(maskByLineCount(s([0.1]), []).map((x) => x.v)).toEqual([0.1]);
  });
});
