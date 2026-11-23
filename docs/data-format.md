# AutoTrack telemetry CSV format

> **Status: DRAFT for team review.** Proposed by Meryem Betül for the three plugins. Nothing here is final
> until Esma (data source), Şevval (lane panel) and Meryem Betül (debug panel) agree. Open questions are at
> the end.

One format that **every plugin reads**, whether the data comes from a recorded CSV, the replay server or,
later, the car itself. The column names follow the ROS 2 topics that AutoTrack AI publishes or will publish,
so a converted rosbag and a hand-made test CSV look the same to Grafana.

## 1. File layout

- One run = one CSV file, UTF-8, comma separated, first line is the header.
- **One row every 100 ms (10 Hz).** `time_ms` is the time since the start of the run: `0, 100, 200, ...`
- **An empty cell means "no data"**, never `0`. A missing LiDAR reading and a LiDAR reading of 0 m are
  different things, and the panels must be able to tell them apart.
- Booleans are `0` / `1`. Text values (states, classes) are written without quotes and without commas.
- Not every run has every column. A plugin must ignore columns it does not know and treat a missing column
  like an empty one. This is what lets today's manual-drive recording and tomorrow's autonomous run use the
  same format.
- File names: `<yyyy-mm-dd>_<hhmm>_<description>.csv`, for example `2026-10-20_1735_manual.csv`.
  Test files: `test_normal_drive.csv`, `test_lane_loss.csv`, `test_steering_oscillation.csv`, `test_low_battery.csv`.

## 2. Sign conventions

All angles and offsets follow ROS REP 103 (x forward, y left, counter-clockwise positive):

- **positive = left.** `steering_deg = 10` steers left; `lateral_error_m = 0.05` means the car is 5 cm
  **left** of the lane centre; `heading_error_deg = 3` means the car points 3° left of the lane direction.
- Distances are in metres, speeds in m/s, times in milliseconds.

## 3. Columns

**Unit** is the Grafana unit id the data source attaches to the field, so panels show it correctly.
**Now** says whether the current recording (20 October, manual drive) already has the value.

### Time

| Column | Type | Unit | Description | Now |
|---|---|---|---|---|
| `time_ms` | int | `ms` | Time since the start of the run. Required, strictly increasing. | ✅ |

### Driving and vehicle (Esma, WP1)

| Column | Type | Unit | ROS source | Description | Now |
|---|---|---|---|---|---|
| `speed_mps` | float | `velocityms` | `/odom` twist.linear.x | Measured speed | ⚪ |
| `speed_cmd_mps` | float | `velocityms` | `/drive` (or `/joy` in manual mode) | Commanded speed, limited to 1 m/s (NFR-04) | ✅ |
| `steering_deg` | float | `degree` | `/drive` steering_angle | Commanded steering angle, + = left | ✅ |
| `manual_active` | 0/1 | `bool` | `/joy` deadman button | 1 while the driver holds the deadman button (FR-03) | ✅ |
| `battery_motor_v` | float | `volt` | `/sensors/core` voltage_input | 3S motor pack, measured by the VESC | ⚪ |
| `battery_jetson_v` | float | `volt` | (no sensor yet) | 4S Jetson pack. Optional until it can be measured | ❌ |

### Sensors (Esma)

| Column | Type | Unit | ROS source | Description | Now |
|---|---|---|---|---|---|
| `lidar_hz` | float | `hertz` | `/scan` message rate | LiDAR scans per second | ✅ |
| `camera_fps` | float | `fps` | ZED image message rate | Camera frames per second | ✅ |
| `obstacle_front_m` | float | `lengthm` | `/scan`, front sector | Nearest obstacle ahead; empty if nothing in range | ✅ |

### Lane (Şevval, WP2)

| Column | Type | Unit | ROS source | Description | Now |
|---|---|---|---|---|---|
| `lane_detected` | 0/1 | `bool` | lane detection node | 1 when the lane is found in this frame | ❌ |
| `lateral_error_m` | float | `lengthm` | lane detection node | Car position relative to the lane centre, + = left | ❌ |
| `heading_error_deg` | float | `degree` | lane detection node | Car direction relative to the lane direction, + = left | ❌ |
| `lane_left_m` | float | `lengthm` | lane detection node | Distance from the car centre to the left boundary | ❌ |
| `lane_right_m` | float | `lengthm` | lane detection node | Distance from the car centre to the right boundary | ❌ |

`lane_left_m` and `lane_right_m` are what the top-down view needs. When `lane_detected = 0`, the four lane
values are left empty.

### Perception (Meryem Betül, WP3 and WP6)

| Column | Type | Unit | ROS source | Description | Now |
|---|---|---|---|---|---|
| `detection_class` | text | – | YOLOv8n detection node | Most relevant detection in this frame, one of the classes below; empty if none | ❌ |
| `detection_conf` | float | `percentunit` | same | Confidence 0–1 | ❌ |
| `detection_distance_m` | float | `lengthm` | same (ZED depth) | Distance to the detected object. Optional | ❌ |
| `perception_fps` | float | `fps` | detection node | Frames processed per second by the model (NFR-02: ≥ 15) | ❌ |
| `perception_latency_ms` | float | `ms` | detection node | Camera frame time to detection result | ❌ |

Detection classes, same names and order as `configs/classes.txt` in the AutoTrack repo:
`sign_stop`, `sign_pedestrian_crossing`, `sign_speed_limit`, `light_red`, `light_yellow`, `light_green`, `pedestrian`.

### Decision (Meryem Nur, WP4)

| Column | Type | Unit | ROS source | Description | Now |
|---|---|---|---|---|---|
| `state` | text | – | decision engine | Current state of the state machine | ❌ |
| `task` | text | – | decision engine | Course task the car is working on now | ❌ |
| `tasks_done` | text | – | decision engine | Finished tasks, separated by `;` (e.g. `lane_following;traffic_sign`) | ❌ |

Proposed states (to be confirmed with Meryem Nur):
`IDLE`, `MANUAL`, `FOLLOW_LANE`, `STOP_SIGN`, `WAIT_LIGHT`, `YIELD_PEDESTRIAN`, `AVOID_OBSTACLE`,
`OVERTAKE`, `ROAD_WORKS`, `PARK`, `FINISHED`.

The 8 course tasks:
`lane_following`, `traffic_sign`, `traffic_light`, `pedestrian`, `obstacle`, `overtaking`, `parking`, `road_works`.

## 4. Example

```csv
time_ms,speed_mps,speed_cmd_mps,steering_deg,manual_active,battery_motor_v,lidar_hz,camera_fps,obstacle_front_m,lane_detected,lateral_error_m,heading_error_deg,lane_left_m,lane_right_m,detection_class,detection_conf,perception_fps,perception_latency_ms,state,task,tasks_done
0,0.00,0.00,0.0,0,12.42,10.0,15.0,,1,0.01,0.5,0.21,0.19,,,16.2,48,IDLE,lane_following,
100,0.12,0.30,1.5,0,12.41,10.0,15.0,,1,0.02,0.8,0.20,0.20,,,16.0,51,FOLLOW_LANE,lane_following,
200,0.25,0.30,-2.0,0,12.38,10.0,14.9,1.84,1,-0.01,-0.4,0.22,0.18,sign_stop,0.87,15.8,53,FOLLOW_LANE,traffic_sign,lane_following
300,0.18,0.10,0.0,0,12.39,10.1,15.0,1.62,0,,,,,sign_stop,0.91,15.9,50,STOP_SIGN,traffic_sign,lane_following
```

Row 300 shows a frame where the lane is lost: `lane_detected = 0` and the lane values are empty, not 0.

## 5. Alerts (computed by the data source, not stored in the CSV)

The data source derives alerts from the columns above and sends them to the panels as a separate
`alerts` frame (time, level, message), and as Grafana annotations:

| Alert | Rule (proposal) | Level |
|---|---|---|
| Low motor battery | `battery_motor_v` < 10.5 V (3.5 V per cell) for 2 s | warning; critical below 10.2 V |
| Low Jetson battery | `battery_jetson_v` < 14.0 V for 2 s | warning |
| Connection lost | live: no new data for 1 s; replay: gap in `time_ms` > 500 ms | critical |
| Lane lost | `lane_detected = 0` for 0.5 s | warning |
| Sensor stall | `lidar_hz` or `camera_fps` = 0 (existing AI sensor health analysis) | warning |

## 6. How the existing pieces map to this format

- **`bag_to_json.py`** already extracts `speed_cmd`, `steering_cmd`, `manual_active`, `obstacle_front`,
  `lidar_hz` and `camera_fps`. A CSV writer that resamples them to 10 Hz gives the first real CSV
  (columns marked ✅). New topics are added to the converter as the car starts publishing them.
- **Data source:** each column becomes a topic with the column name as id and the unit from the tables.
  Text columns (`state`, `task`, `detection_class`) become string fields, which Grafana's state timeline
  can show directly.
- **Replay at 1x / 2x / 4x:** the server advances `time_ms` 1, 2 or 4 times faster than the wall clock;
  the file itself does not change.

## 7. Open questions

1. **Meryem Nur:** are these the right states? Does the decision engine know which tasks are finished,
   or should the debug panel work it out from the state changes?
2. **Şevval:** can lane detection give `lane_left_m` / `lane_right_m`, or only the lateral and heading error?
3. **Esma:** is 10 Hz enough for the panels? LiDAR runs at 10 Hz and the camera at 15 FPS, so a faster rate
   would only repeat values.
4. **Esma:** can the 4S Jetson battery be measured at all, or do we drop `battery_jetson_v`?
5. **All:** one wide CSV (this draft) or a second file for events (detections, state changes)? The wide file
   is simpler for replay; a separate events file would keep every detection when there are several per frame.
