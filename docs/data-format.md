# AutoTrack telemetry CSV format

> **Status: DRAFT for team review.** This version replaces the first draft. Instead of inventing new
> column names, it adopts the columns that AutoTrack's `telemetry_node` already writes on the Jetson, as
> Esma proposed, so a run recorded on the track is read by every plugin without converting it.
> Real examples: `mock-server/data/23kasim/` (PR #4). Open questions are at the end.

## 1. File layout

- One run = one CSV file (`run_*.csv` on the Jetson), UTF-8, comma separated, first line is the header.
- **One row every 100 ms (10 Hz).** The sources are faster or about the same (lane ~15 Hz, detections
  ~11 Hz, LiDAR 10 Hz, VESC 50 Hz), so 10 Hz is enough for the dashboards.
- **An empty cell means "no data"**, never `0`. A missing LiDAR reading and a reading of 0 m are different.
- Text values (`state`, `reasons`, `detections`) contain no commas.
- Not every run has every column. A plugin ignores columns it does not know and treats a missing column
  like an empty one.

## 2. Columns written by telemetry_node

| # | Column | Unit | Source topic | Notes |
|---|---|---|---|---|
| 1 | `t_s` | s | – | Time since the start of the run |
| 2 | `state` | – | `/autotrack/state` | `STOP`, `DRIVE`, `SLOW_DOWN`, `MANUAL_OVERRIDE` |
| 3 | `reasons` | – | `/autotrack/reasons` | Why the decision node is in this state, Turkish, several separated by `;` (e.g. `engel yaklasiyor; serit kayip (0.9 sn)`) |
| 4 | `manual` | 0/1 | `/joy` | 1 while LB is held |
| 5 | `speed_cmd` | m/s | `/drive_raw` | Speed requested by the decision node |
| 6 | `steering_cmd` | rad | `/drive_raw` | **+ = left** |
| 7 | `speed_out` | m/s | `/drive` | After the speed limiter and curve slow-down. **Use this for speed charts** |
| 8 | `lateral_error_m` | m | `/lane_error` x | **+ = lane centre is to the RIGHT of the car** (see section 3) |
| 9 | `heading_error_rad` | rad | `/lane_error` y | |
| 10 | `line_count` | 0/1/2 | `/lane_error` z | Lane lines seen; 0 = lane lost |
| 11 | `obstacle_m` | m | `/autotrack/obstacle` x | Nearest obstacle ahead, from the LiDAR |
| 12 | `obstacle_valid` | 0/1 | `/autotrack/obstacle` y | |
| 13 | `detections` | – | `/autotrack/detections` | `class:confidence`, several separated by a space (e.g. `sign_stop:0.95`); see question 1 |
| 14 | `odom_speed_mps` | m/s | `/odom` | **Not reliable**: the VESC reports a constant 0.864 at 0.2–0.3 m/s and 0 at 0.15 m/s. Only "is the motor turning" |
| 15 | `camera_fps` | Hz | camera | Empty when the camera is not recorded |
| 16 | `lane_fps` | Hz | `/lane_error` | Messages in the last 1 s |
| 17 | `detections_fps` | Hz | `/autotrack/detections` | Messages in the last 1 s (NFR-02 target: 15) |
| 18 | `detection_latency_ms` | ms | `/autotrack/detections` | Camera frame to detection result |

Detection classes, same names and order as `configs/classes.txt` in the AutoTrack repository:
`sign_stop`, `sign_pedestrian_crossing`, `sign_speed_limit`, `light_red`, `light_yellow`, `light_green`,
`pedestrian`.

Things to know when reading a run:

- `state = DRIVE` does not always mean the car is moving: when RB is released the car stops, but the
  decision node may stay in DRIVE and keep computing a steering angle. Use `speed_out` and `manual` too.
- Runs made from a rosbag (like `23kasim/`) use the bag's receive time; `telemetry_node` uses its own
  clock. If a node was restarted during the run there can be gaps of a few seconds.

## 3. Sign conventions

`steering_cmd` follows ROS REP 103 (+ = left), but `lateral_error_m` is + = lane centre to the **right**.
The CSV keeps the values exactly as `telemetry_node` writes them. The **data source** converts when it
serves them, so every panel sees one rule, **+ = left**:

| Column in the CSV | Served by the data source as | Conversion |
|---|---|---|
| `lateral_error_m` (+ = centre right) | car offset from the lane centre, + = car left of centre | sign flipped |
| `steering_cmd` (rad) | degrees, + = left | × 180 / π (already in PR #4) |

A panel that reads the CSV directly (Grafana TestData "CSV content") gets the raw values and must apply
the same conversion.

## 4. Battery (not in telemetry_node yet)

| Column | Unit | Source topic | Notes |
|---|---|---|---|
| `battery_drive_v` | V | `/sensors/core` `state.voltage_input` | 3S motor pack (11.1 V nominal), measured by the VESC at 50 Hz. Same value as "Sürüş aküsü" in the Driver Station |

The 4S Jetson pack cannot be measured: its level is only on the power box's LCD, no data reaches the Jetson.

## 5. Columns the panels could use later (proposal)

These are not written by any node today. The panels show "no `task` column" until they exist.

| Column | Type | Description |
|---|---|---|
| `task` | text | Course task the car is working on: `lane_following`, `traffic_sign`, `traffic_light`, `pedestrian`, `obstacle`, `overtaking`, `parking`, `road_works` |
| `tasks_done` | text | Finished tasks, separated by `;` |

## 6. Alerts (computed by the data source, not stored in the CSV)

The data source derives alerts from the columns and sends them to the panels as a separate frame with
`t_s`, `level` and `message`, and as Grafana annotations. State changes and detections are found the same
way, by comparing a row with the one before it.

| Alert | Rule | Level |
|---|---|---|
| Low drive battery | `battery_drive_v` < 10.5 V (3.5 V per cell) for 2 s | warning; critical below 10.2 V |
| Connection lost | live: no new row for 1 s; replay: gap in `t_s` > 0.5 s | critical |
| Lane lost | `line_count` = 0 for 0.5 s | warning |
| Detector too slow | `detections_fps` < 15 for 2 s (NFR-02) | warning |
| Sensor stall | `lidar_hz` or `camera_fps` = 0 (existing AI sensor health analysis, JSON runs only) | warning |

## 7. How the plugins read the format

- **Data source** (Esma): reads a CSV run with `mock-server/telemetry_csv.ts` (PR #4) and serves the
  numeric columns as topics. Text columns (`state`, `reasons`, `detections`) also need to be served as
  string fields for the debug panel; see question 2.
- **Lane panel** (Şevval): `speed_out`, `steering_cmd`, `lateral_error_m`, `heading_error_rad`, `line_count`.
- **Debug panel** (Meryem Betül): `state`, `reasons`, `detections`, `detections_fps`,
  `detection_latency_ms`, `camera_fps`, and `task` / `tasks_done` when they exist. It also reads the CSV
  directly through TestData, so it works before the data source serves text columns.

## 8. Open questions

1. **Esma:** in `detections`, are several objects separated by a space (as in the `23kasim` README) or by
   `;` (as in your message)? The recording never has more than one detection per row, so the data does not
   show it. The debug panel accepts both for now.
2. **Esma:** can the data source serve `state`, `reasons` and `detections` as string fields, next to
   `state_code`?
3. **Esma / Şevval:** do we agree that the data source flips `lateral_error_m`, and that a panel reading
   the CSV directly flips it itself?
4. **To ask Meryem Nur (AutoTrack decision engine):** could the decision node publish the current course
   task, so `task` and `tasks_done` can be written? Until then the debug panel cannot show task progress.
