/**
 * AutoTrack mock telemetry server.
 * Replays a recorded run (converted from a rosbag) in a loop, aligned to wall-clock time,
 * so Grafana sees it as live data. Also covers AutoTrack SRS FR-28 (replay of recorded runs).
 *
 * REST:      GET /health, GET /topics, GET /telemetry?topic=&from=&to=&maxPoints=
 * WebSocket: GET /stream?topic=   pushes new points as they "happen"
 */

type Point = [number, number];

interface Run {
  source: string;
  recorded_at: string;
  duration_ms: number;
  series: Record<string, Point[]>;
}

interface TopicMeta {
  label: string;
  unit: string; // Grafana unit id
}

const PORT = Number(Deno.env.get('PORT') ?? 8080);
const DATA_FILE = Deno.env.get('DATA_FILE') ?? './data/run_2026-10-20_1735.json';
const DEFAULT_MAX_POINTS = 2000;
const STREAM_TICK_MS = 200;

const TOPICS: Record<string, TopicMeta> = {
  speed_cmd: { label: 'Speed command', unit: 'velocityms' },
  steering_cmd: { label: 'Steering command', unit: 'degree' },
  manual_active: { label: 'Manual control active', unit: 'bool_on_off' },
  obstacle_front: { label: 'Obstacle ahead', unit: 'lengthm' },
  lidar_hz: { label: 'LiDAR scans per second', unit: 'hertz' },
  camera_fps: { label: 'Camera frames per second', unit: 'none' },
};

const run: Run = JSON.parse(await Deno.readTextFile(DATA_FILE));
const loopMs = run.duration_ms;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function isKnownTopic(topic: string): boolean {
  return topic in TOPICS && topic in run.series;
}

/** Repeat the recording back-to-back on the timeline and keep the points inside [from, to]. */
function replay(points: Point[], from: number, to: number, maxPoints: number): Point[] {
  const out: Point[] = [];
  for (let cycle = Math.floor(from / loopMs) * loopMs; cycle <= to; cycle += loopMs) {
    for (const [offset, value] of points) {
      const t = cycle + offset;
      if (t >= from && t <= to) {
        out.push([t, value]);
      }
    }
  }
  if (out.length <= maxPoints) {
    return out;
  }
  const stride = Math.ceil(out.length / maxPoints);
  return out.filter((_, i) => i % stride === 0);
}

function handleTelemetry(params: URLSearchParams): Response {
  const topic = params.get('topic') ?? '';
  const from = Number(params.get('from'));
  const to = Number(params.get('to'));
  const maxPoints = Number(params.get('maxPoints') ?? DEFAULT_MAX_POINTS);

  if (!isKnownTopic(topic)) {
    return json({ error: `Unknown topic '${topic}'`, topics: Object.keys(TOPICS) }, 404);
  }
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
    return json({ error: "Query parameters 'from' and 'to' must be epoch milliseconds with from <= to" }, 400);
  }

  return json({
    topic,
    ...TOPICS[topic],
    points: replay(run.series[topic], from, to, Math.max(10, maxPoints)),
  });
}

/** Push every new point of one topic to the client as soon as its replay time is reached. */
function handleStream(req: Request, params: URLSearchParams): Response {
  const topic = params.get('topic') ?? '';
  if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return json({ error: 'This endpoint expects a WebSocket connection' }, 400);
  }
  if (!isKnownTopic(topic)) {
    return json({ error: `Unknown topic '${topic}'`, topics: Object.keys(TOPICS) }, 404);
  }

  const { socket, response } = Deno.upgradeWebSocket(req);
  let lastSent = Date.now();
  let timer: number | undefined;

  socket.onopen = () => {
    timer = setInterval(() => {
      const now = Date.now();
      const points = replay(run.series[topic], lastSent + 1, now, Number.MAX_SAFE_INTEGER);
      lastSent = now;
      if (points.length > 0 && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ topic, points }));
      }
    }, STREAM_TICK_MS);
  };
  socket.onclose = () => clearInterval(timer);
  socket.onerror = () => clearInterval(timer);

  return response;
}

Deno.serve({ port: PORT, hostname: '0.0.0.0' }, (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  const url = new URL(req.url);
  switch (url.pathname) {
    case '/health':
      return json({ status: 'ok', source: run.source, recorded_at: run.recorded_at, loop_ms: loopMs });
    case '/topics':
      return json(Object.entries(TOPICS).map(([id, meta]) => ({ id, ...meta })));
    case '/telemetry':
      return handleTelemetry(url.searchParams);
    case '/stream':
      return handleStream(req, url.searchParams);
    default:
      return json({ error: 'Not found' }, 404);
  }
});

console.log(`AutoTrack mock server on :${PORT}, replaying ${run.source} (${loopMs} ms loop)`);
