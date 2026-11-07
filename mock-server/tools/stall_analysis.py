#!/usr/bin/env python3
"""Sensor stall analysis for an AutoTrack rosbag (.db3).

Answers two questions:
  1. Do LiDAR and camera dropouts happen at the same time? (per-second overlap, lagged overlap)
  2. Do the sensors stop producing data, or does only the recorder stall?
     (gaps in header.stamp = production time vs. gaps in the bag timestamp = recording time)

Only the first 12 bytes of each message are read, so camera images are never decoded.
Reading a large camera topic from a Windows drive (/mnt/c) can still take a few minutes.
"""
import argparse
import sqlite3
import struct
from collections import Counter

LIDAR_TOPIC = '/scan'
CAMERA_TOPIC = '/zed2/zed_node/rgb/image_rect_color'
GAP_S = 0.5
MAX_LAG_S = 3


def read_stamps(con: sqlite3.Connection, topic: str) -> list:
    """Return (bag_time_s, header_stamp_s) for every message of a topic."""
    row = con.execute('SELECT id FROM topics WHERE name = ?', (topic,)).fetchone()
    if row is None:
        raise SystemExit(f'Topic {topic} not found in the bag')
    rows = con.execute(
        'SELECT timestamp, substr(data, 1, 12) FROM messages WHERE topic_id = ? ORDER BY timestamp', (row[0],)
    )
    stamps = []
    for bag_ns, head in rows:
        # CDR little-endian: 4-byte encapsulation header, then std_msgs/Header.stamp (int32 sec, uint32 nanosec)
        sec, nsec = struct.unpack_from('<iI', head, 4)
        stamps.append((bag_ns / 1e9, sec + nsec / 1e9))
    return stamps


def gap_report(name: str, stamps: list) -> None:
    bag_gaps = [b2 - b1 for (b1, _), (b2, _) in zip(stamps, stamps[1:])]
    hdr_gaps = [h2 - h1 for (_, h1), (_, h2) in zip(stamps, stamps[1:])]
    delays = [b - h for b, h in stamps]
    print(f'\n{name}: {len(stamps)} messages')
    print(f'  gaps > {GAP_S}s in recording time: {sum(g > GAP_S for g in bag_gaps):3d}   longest {max(bag_gaps):.2f}s')
    print(f'  gaps > {GAP_S}s in sensor time:    {sum(g > GAP_S for g in hdr_gaps):3d}   longest {max(hdr_gaps):.2f}s')
    print(f'  production -> recording delay:   min {min(delays):.2f}s   max {max(delays):.2f}s')


def stalled_seconds(stamps: list, t0: float, seconds: int) -> list:
    counts = Counter(int(b - t0) for b, _ in stamps)
    return [counts.get(s, 0) == 0 for s in range(seconds)]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('db3', help='path to the rosbag .db3 file')
    args = parser.parse_args()

    con = sqlite3.connect(f'file:{args.db3}?mode=ro', uri=True)
    t0_ns, t1_ns = con.execute('SELECT MIN(timestamp), MAX(timestamp) FROM messages').fetchone()
    t0 = t0_ns / 1e9
    seconds = int((t1_ns - t0_ns) / 1e9) + 1
    print(f'Recording length: {seconds} s')

    lidar = read_stamps(con, LIDAR_TOPIC)
    camera = read_stamps(con, CAMERA_TOPIC)
    gap_report('LiDAR', lidar)
    gap_report('Camera', camera)

    lidar_stall = stalled_seconds(lidar, t0, seconds)
    camera_stall = stalled_seconds(camera, t0, seconds)
    both = sum(a and b for a, b in zip(lidar_stall, camera_stall))
    either = sum(a or b for a, b in zip(lidar_stall, camera_stall))

    print('\nPer-second dropouts (no message received in that second)')
    print(f'  LiDAR stalled:  {sum(lidar_stall)} s')
    print(f'  Camera stalled: {sum(camera_stall)} s')
    print(f'  Both stalled:   {both} s')
    print(f'  Jaccard overlap: {both / either:.2f}' if either else '  No dropouts')

    print('\nLagged overlap (camera shifted relative to LiDAR)')
    for lag in range(-MAX_LAG_S, MAX_LAG_S + 1):
        pairs = [(lidar_stall[i], camera_stall[i + lag]) for i in range(seconds) if 0 <= i + lag < seconds]
        print(f'  {lag:+d}s: {sum(a and b for a, b in pairs)} shared stalled seconds')


if __name__ == '__main__':
    main()
