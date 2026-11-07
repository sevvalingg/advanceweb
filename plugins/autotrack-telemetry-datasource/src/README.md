# AutoTrack Telemetry

**Developed by Meryem Esma Eröz** · AutoTrack AI · Fall 2026

Telemetry of the AutoTrack AI autonomous vehicle in Grafana: speed and steering commands, manual
control, obstacle distance, LiDAR scan rate and camera frame rate from real recorded drives, plus an
AI analysis that detects and diagnoses sensor dropouts.

## Configuration

- **Mode:** `Mock (browser)` for synthetic signals, or `AutoTrack server` for recorded runs.
- **Server URL:** address of the AutoTrack mock server, default `http://localhost:8080`.

Use **Save & test** to check the connection.

## Querying

- **Topic:** choose a vehicle signal, or one of the AI topics:
  - *AI: Sensor health timeline*: per-second state (healthy, camera stalled, LiDAR stalled, both stalled)
  - *AI: Stall diagnosis*: overlap, lag, stalled seconds, learned thresholds and a written diagnosis
- **Live:** stream new data over WebSocket instead of polling.
