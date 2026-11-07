#!/usr/bin/env python3
"""Convert an AutoTrack rosbag (.db3) into a compact telemetry JSON for the Grafana plugin.

Reads the sqlite3 file directly, so metadata.yaml is not required.
Camera images are never decoded; only their timestamps are used to compute FPS.
"""
import argparse
import json
import math
import sqlite3
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from rosbags.typesys import Stores, get_typestore

FRONT_HALF_ANGLE = math.radians(30)  # LiDAR sector treated as "in front"
MIN_VALID_RANGE = 0.35  # ignore readings closer than this: the car's own body and mounts
CAMERA_TOPIC = '/zed2/zed_node/rgb/image_rect_color'


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('db3', help='path to the rosbag .db3 file')
    parser.add_argument('-o', '--out', required=True, help='output JSON path')
    parser.add_argument('--deadman-button', type=int, default=4)
    parser.add_argument('--speed-axis', type=int, default=1)
    parser.add_argument('--speed-scale', type=float, default=1.0, help='m/s at full stick')
    parser.add_argument('--steer-axis', type=int, default=0)
    parser.add_argument('--steer-scale', type=float, default=0.34, help='rad at full stick')
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    typestore = get_typestore(Stores.ROS2_HUMBLE)
    con = sqlite3.connect(f'file:{args.db3}?mode=ro', uri=True)

    topics = {name: (tid, typ) for tid, name, typ in con.execute('SELECT id, name, type FROM topics')}
    t0, t1 = con.execute('SELECT MIN(timestamp), MAX(timestamp) FROM messages').fetchone()
    duration_s = (t1 - t0) / 1e9

    def rel_ms(ns: int) -> int:
        return round((ns - t0) / 1e6)

    def rows(topic: str, with_data: bool = True):
        if topic not in topics:
            return
        tid, _ = topics[topic]
        cols = 'timestamp, data' if with_data else 'timestamp'
        yield from con.execute(f'SELECT {cols} FROM messages WHERE topic_id = ? ORDER BY timestamp', (tid,))

    def per_second(topic: str) -> list:
        counts = Counter((stamp - t0) // 1_000_000_000 for (stamp,) in rows(topic, with_data=False))
        return [[sec * 1000, counts.get(sec, 0)] for sec in range(int(duration_s) + 1)]

    # Joystick -> commanded speed, steering, manual control state
    speed, steering, manual = [], [], []
    for stamp, data in rows('/joy'):
        msg = typestore.deserialize_cdr(data, 'sensor_msgs/msg/Joy')
        axes, buttons = list(msg.axes), list(msg.buttons)
        active = len(buttons) > args.deadman_button and buttons[args.deadman_button] == 1
        v = axes[args.speed_axis] * args.speed_scale if active and len(axes) > args.speed_axis else 0.0
        s = axes[args.steer_axis] * args.steer_scale if active and len(axes) > args.steer_axis else 0.0
        t = rel_ms(stamp)
        speed.append([t, round(float(v), 3)])
        steering.append([t, round(math.degrees(s), 2)])
        manual.append([t, int(active)])

    # LiDAR -> nearest obstacle in front and overall
    obstacle_front, obstacle_any = [], []
    for stamp, data in rows('/scan'):
        msg = typestore.deserialize_cdr(data, 'sensor_msgs/msg/LaserScan')
        lower = max(msg.range_min, MIN_VALID_RANGE)
        best_front = best_any = math.inf
        for i, r in enumerate(msg.ranges):
            if not (lower <= r <= msg.range_max):
                continue  # drops NaN, inf, self-hits and out-of-range readings
            best_any = min(best_any, r)
            angle = msg.angle_min + i * msg.angle_increment
            angle = math.atan2(math.sin(angle), math.cos(angle))
            if abs(angle) <= FRONT_HALF_ANGLE:
                best_front = min(best_front, r)
        t = rel_ms(stamp)
        if best_front < math.inf:
            obstacle_front.append([t, round(float(best_front), 3)])
        if best_any < math.inf:
            obstacle_any.append([t, round(float(best_any), 3)])

    out = {
        'source': Path(args.db3).name,
        'recorded_at': datetime.fromtimestamp(t0 / 1e9, tz=timezone.utc).isoformat(),
        'duration_ms': rel_ms(t1),
        'joy_mapping': {
            'deadman_button': args.deadman_button,
            'speed_axis': args.speed_axis,
            'speed_scale': args.speed_scale,
            'steer_axis': args.steer_axis,
            'steer_scale': args.steer_scale,
        },
        'lidar_min_valid_range_m': MIN_VALID_RANGE,
        'series': {
            'speed_cmd': speed,
            'steering_cmd': steering,
            'manual_active': manual,
            'obstacle_front': obstacle_front,
            'obstacle_nearest': obstacle_any,
            'lidar_hz': per_second('/scan'),
            'camera_fps': per_second(CAMERA_TOPIC),
        },
    }

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, separators=(',', ':')))

    print(f'Duration: {duration_s:.1f} s -> {out_path}')
    for name, points in out['series'].items():
        vals = [v for _, v in points] or [0]
        print(f'  {name:18s} {len(points):5d} points   min={min(vals):8.3f}  max={max(vals):8.3f}')


if __name__ == '__main__':
    main()