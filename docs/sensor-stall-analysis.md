# Sensor stall analysis: LiDAR and camera dropouts

**Author:** Meryem Esma Eröz · AutoTrack AI · SEN0415 Advanced Web Programming, Fall 2026
**Data:** rosbag `rosbag2_2026_10_20-17_35_36_0.db3`, manual joystick drive on 20 October 2026, 100 s

## 1. Question

The AutoTrack Telemetry dashboard showed that both the LiDAR scan rate and the camera frame rate
regularly drop to zero for several seconds. The WP1 notes already mention that "the LiDAR occasionally
times out". We wanted to know:

1. Are the LiDAR and camera dropouts independent, or do they happen together?
2. Do the sensors actually stop producing data, or does only the recorder (rosbag) stall?

The answer matters for the vehicle: a 5-second LiDAR gap during autonomous driving would break obstacle
detection (FR-22), whereas a recorder-only stall would only affect logging.

## 2. Method

All steps are reproducible with `mock-server/tools/stall_analysis.py <bag.db3>`.

1. **Per-second message counts.** For each second of the recording we counted the messages received on
   `/scan` (RPLidar S1) and `/zed2/zed_node/rgb/image_rect_color` (ZED 2). A second with zero messages
   is a *stalled second*.
2. **Overlap.** We compared the stalled seconds of both sensors with the Jaccard index
   (shared stalled seconds / seconds where at least one sensor stalled) and with conditional rates.
3. **Lagged overlap.** We shifted the camera series by -3 to +3 seconds to see whether one sensor
   stalls before the other.
4. **Production time vs. recording time.** Each ROS message carries `header.stamp`, the time the driver
   produced it; the bag stores the time it was recorded. Gaps in `header.stamp` mean the sensor stopped
   producing data; gaps only in the bag time would mean the recorder stalled. The script reads only the
   first 12 bytes of each message, so images are never decoded.

## 3. Results

| Metric | LiDAR | Camera |
|---|---|---|
| Messages | 595 | 836 |
| Stalled seconds (out of 100) | 37 | 37 |
| Gaps > 0.5 s in sensor time (`header.stamp`) | 14 | 14 |
| Longest gap in sensor time | 4.48 s | 4.93 s |
| Longest gap in recording time | 5.41 s | 5.37 s |
| Max production → recording delay | 1.10 s | 0.75 s |

| Overlap | Value |
|---|---|
| Both stalled | 37 s |
| Jaccard index | **1.00** |
| LiDAR stalled → camera also stalled | 100 % |
| Camera stalled → LiDAR also stalled | 100 % |

| Camera lag relative to LiDAR | -3 s | -2 s | -1 s | **0 s** | +1 s | +2 s | +3 s |
|---|---|---|---|---|---|---|---|
| Shared stalled seconds | 15 | 19 | 24 | **37** | 24 | 19 | 15 |

When they are running, both sensors reach their expected rates (LiDAR about 10 Hz, camera 15–20 FPS).
The low averages (6 Hz and 8.4 FPS) come entirely from the stalls, not from slow operation.

## 4. Interpretation

- **The dropouts are perfectly synchronised.** Two independent sensors, with different drivers and
  cables, stall in exactly the same 37 seconds, with the peak overlap at zero lag. This cannot be
  coincidence: there is a common cause.
- **The sensors stop producing data at the source.** Both show 14 gaps longer than 0.5 s in
  `header.stamp`, up to 4.5–4.9 s, while the recording delay never exceeds about 1 s. A recorder-only
  stall cannot explain these gaps.
- **Conclusion:** the dropouts are a **system-level** problem, not a fault of the LiDAR or the camera.

Candidate causes, in our order of likelihood:

1. **Shared USB 3.0 hub.** Both sensors are connected to the same 7-port hub; the ZED 2 uses a lot of
   USB bandwidth. Bandwidth or power limits on the hub would silence both devices together.
2. **CPU or disk saturation on the Jetson.** Recording about 15 MB/s of images can saturate disk I/O
   and briefly freeze the driver processes.
3. **Power dips.** The 4S pack powers the Jetson and the USB peripherals; a voltage dip can reset USB
   devices.

## 5. Proposed experiments

| Experiment | If the gaps disappear, the cause is |
|---|---|
| Record without the camera topic (LiDAR, joystick, `/drive`, `/sensors/core` only) | Camera load (USB bandwidth or disk I/O) |
| Connect the LiDAR directly to the Jetson instead of the hub | The USB hub |
| Run `tegrastats` in a second terminal while recording | CPU, memory or thermal saturation (if peaks match the gaps) |

Each experiment produces a new bag; running this analysis on it gives a before/after comparison.

## 6. How the Grafana plugin uses this

The data source plugin automates this analysis in the browser for every replayed run (AI section of the
project): it learns the healthy/stalled threshold of each sensor from the data (k-means), shows a joint
health timeline and reports a diagnosis based on the overlap and lag measured above.

## 7. Replication and time course (second recording)

**Data:** `rosbag2_2026_10_20-17_37_29_0.db3`, a separate drive on the same day, 969 s (16 min). Unlike the
first run, it also contains `/odom` (measured speed) and `/ackermann_cmd` (drive commands).

### 7.1 Replication

| Metric | Run 1 (100 s) | Run 2 (969 s) |
|---|---|---|
| LiDAR stalled seconds | 37 (37 %) | 530 (55 %) |
| Camera stalled seconds | 37 (37 %) | 532 (55 %) |
| Both stalled | 37 | 530 |
| Jaccard overlap | 1.00 | 1.00 (530 / 532) |
| Peak of the lagged overlap | 0 s | 0 s |
| Gaps > 0.5 s in sensor time (LiDAR / camera) | 14 / 14 | 148 / 156 |
| Longest gap in sensor time (LiDAR / camera) | 4.48 s / 4.93 s | 6.08 s / 6.80 s |
| Max production → recording delay | 1.10 s | 1.86 s |

A ten times longer, independent recording shows the same pattern: the two sensors stall together, at
zero lag, and stop producing data at the source.

### 7.2 Time course and vehicle motion

Per minute of run 2: share of seconds with no LiDAR scan, and share of `/odom` messages with a measured
speed above 0.05 m/s.

| Minute | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Stalled | 3 % | 33 % | 58 % | 60 % | 60 % | 57 % | 58 % | 62 % | 62 % | 62 % | 57 % | 60 % | 62 % | 60 % | 60 % | 60 % | 67 % |
| Moving | 37 % | 28 % | 39 % | 85 % | 84 % | 53 % | 50 % | 26 % | 68 % | 1 % | 2 % | 0 % | 56 % | 0 % | 0 % | 0 % | 0 % |

- The first minute is almost free of stalls although the car is already moving.
- Within about two minutes the stall rate rises to roughly 60 % and then stays flat.
- In minutes 9–11 and 13–16 the car stands still, yet the stall rate does not change.

### 7.3 Updated interpretation

| Hypothesis | Expected pattern | Verdict |
|---|---|---|
| Recorder-only stall | Gaps only in recording time | Rejected: gaps in sensor time (§4) |
| Thermal throttling | Slow, continuous increase | Unlikely: flat plateau |
| USB hub bandwidth | Stalls from the first second | Unlikely: first minute is healthy |
| Motor load or power dips | Stalls only while driving | Rejected: same rate while standing still |
| **Recording load (disk write-back)** | Healthy until the write cache fills, then a steady rhythm, independent of motion | **Consistent with all observations** |

About 15 MB/s of camera images are written during recording. Linux first buffers these writes in RAM;
once the buffer is full, write-back blocks and the driver processes on the Jetson are delayed with it.
This matches the healthy first minute, the fast transition and the flat plateau.

**Prediction to test on the car:** a recording without the camera topic (or with compressed images or
a faster disk) should show no stalls. If confirmed, the stalls are a property of *recording*, not of
autonomous driving, which matters for how the team logs data in WP7 and WP8.
