# AutoTrack Debug

**Developed by Meryem Betül Abdulrahman** · AutoTrack AI · Fall 2026

What the AutoTrack AI autonomous vehicle's software is doing: the state of its state machine, progress
through the 8 course tasks, perception frame rate and latency, the last detected sign, traffic light or
pedestrian, and alerts from the data source.

## Data

The panel reads columns by name, as defined in the AutoTrack shared CSV format: `state`, `task`,
`tasks_done`, `perception_fps`, `camera_fps`, `perception_latency_ms`, `detection_class`,
`detection_conf`, `detection_distance_m`, and an alerts frame with `time_ms`, `level` and `message`.
Any data source that returns these columns works, including TestData with a recorded CSV.

## Options

- **FPS target:** perception frame rate below this is shown in red (default 15, requirement NFR-02).
- **Latency warning (ms):** latency above this is shown in red (default 100).
- **Show state timeline** and **Show alerts.**
