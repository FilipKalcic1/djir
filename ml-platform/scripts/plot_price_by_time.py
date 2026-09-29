"""
Draw "Same trip, different price" for the README: the fare the COMMITTED models
quote for Tresnjevka → Donji grad at every 15-minute pickup time of a Tuesday and
a Saturday (clear, and Saturday in rain).

The SVG is written by hand (no plotting dependency) and is deterministic, so
tests/test_project.py can check the committed file is what the models give today.

Usage (from ml-platform/):
    python scripts/plot_price_by_time.py
"""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

import joblib

ML_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_ROOT))

from djir_ml import features, predict  # noqa: E402
from djir_ml.config import ETA_MODEL_FILE, MODELS_DIR, SURGE_MODEL_FILE  # noqa: E402
from djir_ml.geo import haversine_km  # noqa: E402

CHART_PATH = ML_ROOT.parent / "docs" / "images" / "price-by-pickup-time.svg"

PICKUP = (45.8000, 15.9450)   # Tresnjevka
DROPOFF = (45.8085, 15.9775)  # Donji grad
SERIES = [  # (label, date, weather, colour)
    ("Saturday · rain", dt.date(2025, 6, 7), "rain", "#D97706"),
    ("Saturday · clear", dt.date(2025, 6, 7), "clear", "#0286FF"),
    ("Tuesday · clear", dt.date(2025, 6, 3), "clear", "#64748B"),
]
CALLOUTS = [  # the two README prices: (series index, minute of day)
    (2, 14 * 60),
    (0, 23 * 60 + 30),
]

W, H = 880, 400
LEFT, RIGHT, TOP, BOTTOM = 64, 24, 112, 56
Y_MIN, Y_MAX = 5, 13
INK, MUTED, GRID = "#111827", "#6B7280", "#E5E7EB"
FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"


def fares() -> list[list[float]]:
    models = ML_ROOT / MODELS_DIR
    eta = joblib.load(models / ETA_MODEL_FILE)
    surge = joblib.load(models / SURGE_MODEL_FILE)
    out = []
    for _, day, weather, _ in SERIES:
        start = dt.datetime(day.year, day.month, day.day, tzinfo=features.SERVICE_TZ)
        row = []
        for step in range(96):
            when = start + dt.timedelta(minutes=15 * step)
            feats = features.request_features(*PICKUP, *DROPOFF, when, weather)
            row.append(predict.quote(eta, surge, feats)["total_fare_eur"])
        out.append(row)
    return out


def x(minute: float) -> float:
    return LEFT + (W - LEFT - RIGHT) * minute / (24 * 60)


def y(eur: float) -> float:
    return TOP + (H - TOP - BOTTOM) * (Y_MAX - eur) / (Y_MAX - Y_MIN)


def describe(rows: list[list[float]]) -> str:
    """The chart's accessible description: each series' fare range, from `rows`."""
    ranges = "; ".join(
        f"{day:%A}, {weather}: €{min(row):.2f} to €{max(row):.2f}"
        for (_, day, weather, _), row in zip(SERIES, rows)
    )
    return f"Fare for Tresnjevka to Donji grad ({trip_km():.1f} km) by pickup time: {ranges}."


def trip_km() -> float:
    return haversine_km(*PICKUP, *DROPOFF)


def render(rows: list[list[float]]) -> str:
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
        f'font-family="{FONT}" role="img" aria-labelledby="title desc">',
        '<title id="title">Same trip, different price</title>',
        f'<desc id="desc">{describe(rows)}</desc>',
        f'<rect x="0.5" y="0.5" width="{W - 1}" height="{H - 1}" rx="12" fill="#FFFFFF" stroke="{GRID}"/>',
        f'<text x="{LEFT}" y="40" font-size="20" font-weight="700" fill="{INK}">Same trip, different price</text>',
        f'<text x="{LEFT}" y="64" font-size="13" fill="{MUTED}">Tresnjevka → Donji grad ({trip_km():.1f} km), '
        'quoted by the committed ETA + surge models for each 15-minute pickup time (Zagreb)</text>',
    ]
    # Legend
    lx = LEFT
    for label, _, _, colour in SERIES:
        parts.append(f'<rect x="{lx}" y="80" width="14" height="4" rx="2" fill="{colour}"/>')
        parts.append(f'<text x="{lx + 20}" y="86" font-size="12" fill="{INK}">{label}</text>')
        lx += 24 + 7.2 * len(label) + 16
    # Grid and axes
    for eur in range(Y_MIN, Y_MAX + 1):
        gy = y(eur)
        parts.append(f'<line x1="{LEFT}" y1="{gy:.1f}" x2="{W - RIGHT}" y2="{gy:.1f}" stroke="{GRID}"/>')
        parts.append(f'<text x="{LEFT - 10}" y="{gy + 4:.1f}" font-size="11" fill="{MUTED}" '
                     f'text-anchor="end">€{eur}</text>')
    for hour in range(0, 25, 3):
        gx = x(hour * 60)
        parts.append(f'<text x="{gx:.1f}" y="{H - BOTTOM + 20}" font-size="11" fill="{MUTED}" '
                     f'text-anchor="middle">{hour:02d}:00</text>')
    parts.append(f'<text x="{(LEFT + W - RIGHT) / 2:.1f}" y="{H - 14}" font-size="11" fill="{MUTED}" '
                 'text-anchor="middle">pickup time</text>')
    # Lines: steps, not slopes: a quote holds for its 15-minute pickup slot.
    for (label, _, _, colour), row in zip(SERIES, rows):
        d = f"M{x(0):.1f},{y(row[0]):.1f}"
        for i, v in enumerate(row):
            d += f" V{y(v):.1f} H{x(15 * (i + 1)):.1f}"
        parts.append(f'<path d="{d}" fill="none" stroke="{colour}" stroke-width="2.5" '
                     'stroke-linejoin="round" stroke-linecap="round"/>')
    # Callouts for the README's two prices
    for series, minute in CALLOUTS:
        eur = rows[series][minute // 15]
        cx, cy = x(minute + 7.5), y(eur)  # the middle of the slot's step
        colour = SERIES[series][3]
        anchor, dx = ("end", -10) if minute > 20 * 60 else ("middle", 0)
        ty = cy + 26
        parts.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="5" fill="#FFFFFF" stroke="{colour}" stroke-width="2.5"/>')
        parts.append(f'<text x="{cx + dx:.1f}" y="{ty:.1f}" font-size="13" font-weight="700" fill="{INK}" '
                     f'text-anchor="{anchor}">€{eur:.2f}</text>')
    parts.append("</svg>")
    return "\n".join(parts) + "\n"


def main() -> None:
    CHART_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CHART_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write(render(fares()))
    print("wrote", CHART_PATH)


if __name__ == "__main__":
    main()
