# AutoTrack Debug panel

Grafana panel plugin for **AutoTrack AI**. Shows what the car's software is doing: the state machine,
progress through the 8 course tasks, perception frame rate and latency, the last detected sign, light or
pedestrian, and the alerts sent by the data source.

**Developer:** Meryem Betül Abdulrahman (the name is shown in the panel footer).

The panel reads its values **by column name**, using the shared format in
[`docs/data-format.md`](../../docs/data-format.md). It does not depend on the car or on one data source:

- with the AutoTrack telemetry data source, once it serves these columns;
- with Grafana's built-in **TestData** data source and a recorded CSV pasted into a "CSV content" query.

The provisioned dashboard uses the second way with a generated sample run, so the panel works right after
`docker compose up`.

## What it shows

| Part                                                                                             | Columns it reads                                            |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| State: current state, coloured by kind (driving, waiting, manoeuvre), and how long it has lasted | `state`                                                     |
| Course tasks: done ✓, current ▶, pending, and the count                                          | `task`, `tasks_done`                                        |
| FPS and latency: model FPS against the NFR-02 target (15), camera FPS, latency                   | `perception_fps`, `camera_fps`, `perception_latency_ms`     |
| Last detection: class, confidence, distance, how long ago                                        | `detection_class`, `detection_conf`, `detection_distance_m` |
| State changes: a bar of all states over the run and the last 6 transitions                       | `state`                                                     |
| Alerts: the last 5 alerts from the data source                                                   | an alerts frame with `time_ms`, `level`, `message`          |

When a column is missing the panel says so ("No `state` column in this data") instead of showing an empty
value, because a missing value and a value of 0 mean different things.

**Panel options:** FPS target, latency warning (ms), show state timeline, show alerts.

**Planned:** the AI part, a TF.js autoencoder that runs in the browser and marks moments where lane
following or steering behaves abnormally, and a summary of the tasks where the car struggles.

## Run it

```bash
cd plugins/autotrack-debug-panel
npm install
npm run build        # or: npm run dev   (rebuilds on every change)
docker compose up -d
```

Open <http://localhost:3000> → Dashboards → **AutoTrack Debug panel**. After changing `src/plugin.json`,
restart Grafana (`docker compose restart`).

## Sample run

`provisioning/data/sample_run.csv` is a **synthetic** 60-second run at 10 Hz in the shared format: it goes
through all 8 tasks once, with a perception frame-rate dip (30–34.5 s), a latency spike (31 s) and a short
lane loss (43–44.6 s). It is generated, not recorded:

```bash
node scripts/make-sample-run.mjs   # rewrites the CSVs and the CSV content in the dashboard
```

Replace it with real recordings once the car publishes these topics.

## Tests

```bash
npm run test:ci      # 16 unit tests: reading columns, states, tasks, detections, alerts, the sample run, rendering
npm run e2e          # end-to-end tests with Grafana running (docker compose up)
```

Two changes to the scaffold's test setup, both outside `.config/`:

- `jest.config.js` also transforms `.mjs` files. `@grafana/data` loads d3 packages that ship only `.mjs`;
  Node 24 loads them directly, but on Node 20 and 22 Jest failed with "Must use import to load ES Module".
- `jest-setup.js` removes `MessageChannel` before React loads. React 19's scheduler otherwise keeps a
  channel open and Jest never exits after the tests have passed.
