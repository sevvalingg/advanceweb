# AutoTrack Debug panel

Grafana panel plugin for **AutoTrack AI**. Shows what the car's software is doing: the state machine,
progress through the 8 course tasks, perception frame rate and latency, the last detected sign, light or
pedestrian, and the alerts sent by the data source.

**Developer:** Meryem Betül Abdulrahman (the name is shown in the panel footer).

The panel reads its values **by column name**, using the columns that AutoTrack's `telemetry_node` writes
on the car (see [`docs/data-format.md`](../../docs/data-format.md)). A run recorded on the track can be shown
without converting it, and the panel does not depend on one data source:

- with the AutoTrack telemetry data source, once it serves these columns;
- with Grafana's built-in **TestData** data source and a recorded CSV pasted into a "CSV content" query.

The provisioned dashboard uses the second way with two real clips from the 23 November track day.

## What it shows

| Part                                                                                                                                         | Columns it reads                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| State: current state of the decision node (DRIVE green, SLOW_DOWN orange, STOP red, MANUAL_OVERRIDE purple), how long it has lasted, and why | `state`, `reasons`                                             |
| FPS and latency: detection rate against the NFR-02 target (15 FPS), camera FPS, detection latency                                            | `detections_fps`, `camera_fps`, `detection_latency_ms`         |
| Last detection: the most confident object of the newest detection, its confidence, how long ago, and the other objects in that frame         | `detections` (`class:confidence`, several separated by spaces) |
| State changes: a bar of all states over the run and the last 6 transitions with their reasons                                                | `state`, `reasons`                                             |
| Course tasks: done ✓, current ▶, pending                                                                                                     | `task`, `tasks_done` (not written by telemetry_node yet)       |
| Alerts: the last 5 alerts from the data source                                                                                               | an alerts frame with `t_s` or `time_ms`, `level`, `message`    |

Time comes from `t_s` (seconds since the start of the run), `time_ms`, or a Grafana time field (epoch ms).
When a column is missing the panel says so ("No `task` column in this data") instead of showing an empty
value, because a missing value and a value of 0 mean different things.

**Panel options:** FPS target, latency warning (ms), show state timeline, show alerts.

**Planned:** the AI part, a TF.js autoencoder that runs in the browser and marks moments where lane
following or steering behaves abnormally, and a summary of where the car struggles.

## Run it

```bash
cd plugins/autotrack-debug-panel
npm install
npm run build        # or: npm run dev   (rebuilds on every change)
docker compose up -d
```

Open <http://localhost:3000> → Dashboards → **AutoTrack Debug panel**. After changing `src/plugin.json`,
restart Grafana (`docker compose restart`).

## Track data

`provisioning/data/` holds two clips of the **real** 23 November track recording, prepared by Esma from the
`ros2 bag` of that day in telemetry_node's format:

| File                                     | Shows                                                        |
| ---------------------------------------- | ------------------------------------------------------------ |
| `04_dur_levhasi.csv` (t 745–775 s)       | `sign_stop` detected, STOP "dur levhasi"                     |
| `02_viraj_serit_kaybi.csv` (t 220–255 s) | one lane line lost in a curve: SLOW_DOWN, STOP "serit kayip" |

They are embedded in the dashboard's TestData queries. In this recording `camera_fps` is empty (the camera
was not recorded) and the decision node does not write course tasks, so those parts of the panel say so.

## Tests

```bash
npm run test:ci      # 19 unit tests: reading columns, reasons, detections, states, alerts, the real clips, rendering
npm run e2e          # end-to-end tests with Grafana running (docker compose up)
```

Two changes to the scaffold's test setup, both outside `.config/`:

- `jest.config.js` also transforms `.mjs` files. `@grafana/data` loads d3 packages that ship only `.mjs`;
  Node 24 loads them directly, but on Node 20 and 22 Jest failed with "Must use import to load ES Module".
- `jest-setup.js` removes `MessageChannel` before React loads. React 19's scheduler otherwise keeps a
  channel open and Jest never exits after the tests have passed.
