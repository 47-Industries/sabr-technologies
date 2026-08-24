#!/usr/bin/env python3
"""
Downsample /opt/leon-brain/brain_state/brainweb_growth.jsonl (Leon's real,
historical brain-growth telemetry) into a small set of keyframes for the
"drag to grow him" age slider on the marketing site.

IMPORTANT / HONEST-DATA NOTE:
The task that produced this script assumed brainweb_growth.jsonl spans
Leon's whole life (day ~1 to day ~88). It does not. Every row's unix
timestamp `t` falls between 2026-08-17 and 2026-08-24 (a ~7-day window),
and the pipeline's own recorded `age_days` field (present on 932/1057
rows) spans ~81.5 to ~88.4. Using the birth date given in the task
(2026-05-21) to backfill missing age_days produces impossible results
(computed ages that exceed "today's" recorded age at earlier
timestamps), so this script instead fits birth_ts as the median of
`t - age_days*86400` over every row that already has a recorded
age_days, and uses that fitted birth_ts only to fill the ~12% of rows
missing the field. That fitted birth_ts lands on ~2026-05-28, one week
off the task's assumed birth date — a real discrepancy worth flagging
upstream, not something to paper over here.

Net effect: this script (and the JSON it emits) honestly covers only
the real window present in the source file (~day 81.5 -> ~day 88.4),
not a full day-1-to-88 lifespan. Labels/copy on the page must reflect
the true min/max age_days emitted here, computed dynamically — never
hardcode "Day 1".
"""
import json
import statistics

SRC = "/opt/leon-brain/brain_state/brainweb_growth.jsonl"
DST = "/opt/leon-brain/workspaces/sabr-technologies/landing-assets/brain-growth.json"
N_KEYFRAMES = 26


def load_rows():
    rows = []
    with open(SRC) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    rows.sort(key=lambda r: r["t"])
    return rows


def fit_birth_ts(rows):
    diffs = [r["t"] - r["age_days"] * 86400 for r in rows if r.get("age_days") is not None]
    if not diffs:
        raise SystemExit("no rows with age_days present -- cannot fit birth_ts")
    return statistics.median(diffs)


def main():
    rows = load_rows()
    birth_ts = fit_birth_ts(rows)

    for r in rows:
        if r.get("age_days") is None:
            r["age_days"] = (r["t"] - birth_ts) / 86400.0

    rows.sort(key=lambda r: r["age_days"])
    min_age, max_age = rows[0]["age_days"], rows[-1]["age_days"]

    targets = [
        min_age + (max_age - min_age) * i / (N_KEYFRAMES - 1)
        for i in range(N_KEYFRAMES)
    ]

    used = set()
    picked = []
    for target in targets:
        best_i, best_d = None, None
        for i, r in enumerate(rows):
            if i in used:
                continue
            d = abs(r["age_days"] - target)
            if best_d is None or d < best_d:
                best_i, best_d = i, d
        if best_i is not None:
            used.add(best_i)
            picked.append(rows[best_i])

    picked.sort(key=lambda r: r["age_days"])

    out = []
    for r in picked:
        lobes = {k: int(v) for k, v in (r.get("lobes") or {}).items()}
        spiking = {k: round(float(v), 5) for k, v in (r.get("spiking") or {}).items()}
        out.append({
            "age_days": round(r["age_days"], 2),
            "nodes": int(r.get("nodes", 0)),
            "edges": int(r.get("edges", 0)),
            "communities": int(r.get("communities", 0)),
            "avg_spike": round(float(r.get("avg_spike", 0.0)), 5),
            "dopamine": round(float(r.get("dopamine", 0.0)), 3),
            "lobes": lobes,
            "spiking": spiking,
        })

    with open(DST, "w") as f:
        json.dump(out, f, separators=(",", ":"))

    print(f"wrote {len(out)} keyframes -> {DST}")
    print(f"age range: {out[0]['age_days']} -> {out[-1]['age_days']}")
    print(f"fitted birth_ts: {birth_ts}")
    import os
    print(f"file size: {os.path.getsize(DST)} bytes")


if __name__ == "__main__":
    main()
