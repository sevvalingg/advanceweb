# AutoTrack Telemetry data source

**Developed by Meryem Esma Eröz** · AutoTrack AI · SEN0415 Advanced Web Programming, Fall 2026

A Grafana data source plugin for the telemetry of AutoTrack AI, a Jetson-based autonomous vehicle.
It reads real driving data from the AutoTrack mock server over REST and WebSocket, and runs an AI
sensor health analysis in the browser. For the full project (architecture, data pipeline, research
report and bonus claims) see the [repository README](../../README.md).

## Features

- Two modes: **Mock** (synthetic signals generated in the browser) and **AutoTrack server** (recorded runs)
- Topic list loaded from the server's `/topics` endpoint
- History over REST, live updates over WebSocket (`Live` switch)
- AI topics: sensor health timeline and stall diagnosis (k-means thresholds, overlap and lag analysis)
- Readable errors for an unreachable server, unknown topics and dropped streams
- Provisioned data source and dashboard

## Requirements

- Node.js 20 or newer
- Docker (Docker Desktop on Windows/macOS; on Windows run inside WSL 2)

## Run it

```bash
npm install
npm run build          # production build into dist/
docker compose up -d   # Grafana on :3000 and the AutoTrack mock server on :8080
```

Open <http://localhost:3000>; the `telemetry` data source and the **AutoTrack Telemetry** dashboard
are ready. Stop with `docker compose down`.

## Development

| Command | Purpose |
|---|---|
| `npm run dev` | Build in watch mode while editing |
| `npm run build` | Production build |
| `npm run test:ci` | Unit tests (Jest) |
| `npm run typecheck` | TypeScript type check |
| `npm run lint` | ESLint |

## Configuration

| Option | Description |
|---|---|
| Mode | `Mock (browser)` or `AutoTrack server` |
| Server URL | Mock server address as seen from the browser, default `http://localhost:8080` |

## Query options

| Option | Description |
|---|---|
| Topic | Signal to query (server topics plus `AI: Sensor health timeline` and `AI: Stall diagnosis`) |
| Live | Server mode: stream new points over WebSocket; AI topics re-run every 5 s |
| Interval (ms) | Mock mode: sampling interval |

## Source layout

| Path | Contents |
|---|---|
| `src/datasource.ts` | Queries, REST and WebSocket streaming, AI frames, error handling |
| `src/ai/sensorHealth.ts` | AI analysis: k-means, joint health states, overlap/lag diagnosis |
| `src/ai/sensorHealth.test.ts` | Unit tests for the AI analysis |
| `src/mock/telemetry.ts` | Synthetic signals for mock mode |
| `src/components/` | `ConfigEditor` and `QueryEditor` |
| `provisioning/` | Provisioned data source and dashboard |
| `docker-compose.yaml` | Grafana and the mock server |
