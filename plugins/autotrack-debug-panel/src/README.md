# AutoTrack Debug

**Developed by Meryem Betül Abdulrahman** · AutoTrack AI · Fall 2026

What the AutoTrack AI autonomous vehicle's software is doing: the state of its decision node and why, progress
through the 8 course tasks, perception frame rate and latency, the last detected sign, traffic light or
pedestrian, and alerts from the data source.

## Data

The panel reads the columns that AutoTrack's telemetry_node writes: `t_s`, `state`, `reasons`,
`detections`, `detections_fps`, `detection_latency_ms`, `camera_fps`, and, when available, `task`,
`tasks_done` and an alerts frame with `level` and `message`. Any data source that returns these columns
works, including TestData with a CSV recorded on the track.

## Options

- **FPS target:** perception frame rate below this is shown in red (default 15, requirement NFR-02).
- **Latency warning (ms):** latency above this is shown in red (default 100).
- **Show state timeline** and **Show alerts.**
