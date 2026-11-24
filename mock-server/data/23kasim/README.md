# AutoTrack – gerçek pist telemetrisi (23 Kasım 2026)

Bu klasördeki CSV'ler sentetik değil: 23 Kasım pist gününde araçta kaydedilen
`ros2 bag` kaydından (`2026-11-23_1849_test`, ~25 dakika) üretildi. Satırlar,
AutoTrack'in `telemetry_node`'unun Jetson'da yazdığı `run_*.csv` dosyalarıyla
**aynı sütunlarda ve aynı kurallarla** yazıldı. Böylece data source, pistten gelen
yeni kayıtları dönüştürmeden okuyabilir.

## Dosyalar

| Dosya | Süre | Ne gösteriyor |
|---|---|---|
| `00_tam_kayit_23kasim.csv` | 1525 s, 15 258 satır | Kaydın tamamı (virajlar, engeller, dur levhası, bekleme anları) |
| `01_duz_yol_normal.csv` | 14 s (t 730–744) | Düz yolda sorunsuz şerit takibi: DRIVE, 2 çizgi, direksiyon ±0,05 rad |
| `02_viraj_serit_kaybi.csv` | 35 s (t 220–255) | Virajda tek çizgiye düşme ve şerit kaybı: SLOW_DOWN → STOP "serit kayip" |
| `03_direksiyon_salinimi.csv` | 45 s (t 335–380) | 2. virajda direksiyonun ±0,34 rad arasında gidip gelmesi, manuel devralma (MANUAL_OVERRIDE) |
| `04_dur_levhasi.csv` | 30 s (t 745–775) | `sign_stop` tespiti, STOP "dur levhasi" |

Klipler `t_s` değerini tam kayıttaki haliyle korur (0'dan başlamaz), böylece
tam kayıtla karşılaştırılabilir.

## Sütunlar

Satır aralığı 100 ms (10 Hz). **Boş hücre = o an veri yok** (0 değil).

| # | Sütun | Birim | Kaynak topic | Not |
|---|---|---|---|---|
| 1 | `t_s` | s | – | Kayıt başından beri |
| 2 | `state` | – | `/autotrack/state` | STOP, DRIVE, SLOW_DOWN, MANUAL_OVERRIDE, … |
| 3 | `reasons` | – | `/autotrack/reasons` | Türkçe, `;` ile ayrılmış (ör. `engel yaklasiyor; serit kayip (0.9 sn)`) |
| 4 | `manual` | 0/1 | `/joy` | LB basılı = 1 |
| 5 | `speed_cmd` | m/s | `/drive_raw` | Karar düğümünün istediği hız |
| 6 | `steering_cmd` | rad | `/drive_raw` | **+ = sol** |
| 7 | `speed_out` | m/s | `/drive` | Hız sınırlayıcı ve virajda yavaşlamadan sonra |
| 8 | `lateral_error_m` | m | `/lane_error` x | **+ = şerit ortası aracın SAĞINDA** |
| 9 | `heading_error_rad` | rad | `/lane_error` y | |
| 10 | `line_count` | 0/1/2 | `/lane_error` z | Görülen şerit çizgisi sayısı |
| 11 | `obstacle_m` | m | `/autotrack/obstacle` x | LiDAR'dan öndeki engele |
| 12 | `obstacle_valid` | 0/1 | `/autotrack/obstacle` y | |
| 13 | `detections` | – | `/autotrack/detections` | `sınıf:güven`, birden fazlaysa **boşlukla** ayrılır (ör. `sign_stop:0.95`) |
| 14 | `odom_speed_mps` | m/s | `/odom` | **Güvenilir değil**, aşağıya bak |
| 15 | `camera_fps` | Hz | kamera | Bu kayıtta **boş**: kamera bag'e kaydedilmedi |
| 16 | `lane_fps` | Hz | `/lane_error` | Son 1 s'deki mesaj sayısı |
| 17 | `detections_fps` | Hz | `/autotrack/detections` | Son 1 s'deki mesaj sayısı |
| 18 | `detection_latency_ms` | ms | `/autotrack/detections` | Kamera karesi ile tespit arasındaki süre |

## Bilinmesi gerekenler

- **İşaret kuralı:** `steering_cmd`'de + = sol, ama `lateral_error_m`'de + = sağ.
  Ortak formatta "sola = pozitif" kullanılacaksa data source `lateral_error_m`'in
  işaretini çevirmeli.
- **`odom_speed_mps`:** VESC 0,2–0,3 m/s'de hızı sabit 0,864 (≈ 3990 erpm), 0,15'te 0
  bildiriyor. Gerçek hız değil, sadece "motor dönüyor mu" bilgisi. Hız grafiği için
  `speed_out` kullanın.
- **Batarya:** Bu kayıtta batarya sütunu yok. Ölçülebilen tek batarya 3S (motor):
  `/sensors/core` → `state.voltage_input`. 4S (Jetson) ölçülmüyor.
- **Bag kaydından üretim farkı:** Jetson'daki `telemetry_node` aynı değerleri
  kendi saatiyle yazar; bu dosyalarda zaman bag'in alma zamanıdır. Bir kanal
  yeniden başlatıldığında (bu kayıtta bringup birkaç kez yeniden başlatıldı)
  birkaç saniyelik boşluklar olabilir.
- Araç RB bırakılınca durur ama karar düğümü DRIVE'da kalıp direksiyon hesaplamaya
  devam edebilir. Bu yüzden `state = DRIVE` her zaman "araç hareket ediyor"
  demek değildir.
