"""The FastAPI quote service: validation, the Zagreb clock and graceful loading."""

import importlib

import pytest
from fastapi.testclient import TestClient

import serving.app as serving

TRIP = {"pickup_lat": 45.8000, "pickup_lng": 15.9450, "dropoff_lat": 45.8085, "dropoff_lng": 15.9775}


@pytest.fixture(scope="module")
def client():
    return TestClient(serving.app)


def quote(client, **overrides):
    return client.post("/predict-price", json={**TRIP, **overrides})


def test_r26_models_load_cleanly_with_the_pinned_versions(client):
    body = client.get("/health").json()
    assert body["models_loaded"] is True and body["load_error"] is None


def test_r24_readme_same_trip_different_price(client):
    # Tresnjevka -> Donji grad: Tue 3 Jun 2025 14:00, clear vs Sat 7 Jun 23:30, raining.
    quiet = quote(client, when="2025-06-03T14:00:00+02:00", weather="clear").json()
    local = quote(client, when="2025-06-07T23:30:00+02:00", weather="rain").json()
    utc = quote(client, when="2025-06-07T21:30:00Z", weather="rain").json()
    assert quiet["total_fare_eur"] == 5.86
    assert local["total_fare_eur"] == utc["total_fare_eur"] == 9.74
    assert utc["request_time"] == "2025-06-07T23:30"
    assert quiet["source"] == utc["source"] == "ml-model"


def test_r06_utc_rush_hour_is_priced_as_rush_hour(client):
    rush = quote(client, when="2025-06-03T06:15:00Z").json()   # 08:15 CEST
    night = quote(client, when="2025-06-03T01:15:00Z").json()  # 03:15 CEST
    assert rush["surge_multiplier"] > night["surge_multiplier"]
    assert rush["request_time"] == "2025-06-03T08:15"


def test_r36_weather_is_case_insensitive(client):
    assert quote(client, weather="Rain").json()["weather_condition"] == "rain"


@pytest.mark.parametrize(
    "overrides",
    [
        {"when": "tomorrow"},
        {"when": "2025-13-01T00:00"},
        {"when": "2025-06-07T23:30:00"},  # no offset: ambiguous across the DST switch
        {"when": "0001-01-01T00:00:00+14:00"},  # before year 1 in Zagreb: astimezone overflows
        {"when": "9999-12-31T23:59:00-14:00"},  # after year 9999 in Zagreb
        {"when": "1999-12-31T22:59:59Z"},  # 23:59:59 in Zagreb, still 1999
        {"when": "2100-12-31T23:00:00Z"},  # 00:00 on 1 Jan 2101 in Zagreb
        {"weather": "storm"},
        {"pickup_lat": 999},
        {"dropoff_lat": 43.508, "dropoff_lng": 16.440},  # Split
    ],
)
def test_r27_r36_bad_input_is_a_422_not_a_500(client, overrides):
    assert quote(client, **overrides).status_code == 422


@pytest.mark.parametrize(
    ("when", "zagreb"),
    [
        ("1999-12-31T23:00:00Z", "2000-01-01T00:00"),  # the first minute priced
        ("2100-12-31T22:59:00Z", "2100-12-31T23:59"),  # the last minute priced
    ],
)
def test_r27_when_is_priced_for_zagreb_years_2000_to_2100(client, when, zagreb):
    res = quote(client, when=when)
    assert res.status_code == 200
    assert res.json()["request_time"] == zagreb


def test_r27_nan_coordinates_are_rejected(client):
    raw = '{"pickup_lat": NaN, "pickup_lng": 15.945, "dropoff_lat": 45.8085, "dropoff_lng": 15.9775}'
    res = client.post("/predict-price", content=raw, headers={"Content-Type": "application/json"})
    assert res.status_code == 422


@pytest.fixture
def reload_with_models_dir(monkeypatch):
    """Re-import serving.app with DJIR_MODELS_DIR pointed elsewhere."""
    def _reload(path):
        monkeypatch.setenv("DJIR_MODELS_DIR", str(path))
        return importlib.reload(serving)

    yield _reload
    monkeypatch.delenv("DJIR_MODELS_DIR", raising=False)
    importlib.reload(serving)


def test_r64_missing_models_fall_back_to_the_heuristic(tmp_path, reload_with_models_dir):
    module = reload_with_models_dir(tmp_path)
    res = TestClient(module.app).post("/predict-price", json=TRIP).json()
    assert res["source"] == "heuristic-fallback"


def test_r64_a_half_missing_pair_is_reported_not_silent(tmp_path, reload_with_models_dir):
    (tmp_path / "eta_model.joblib").write_bytes(b"")
    module = reload_with_models_dir(tmp_path)
    res = TestClient(module.app).get("/health")
    # Still up (the Docker healthcheck passes): the heuristic is quoting.
    assert res.status_code == 200 and res.json()["status"] == "ok"
    health = res.json()
    assert health["models_loaded"] is False
    assert "eta_model.joblib" in health["load_error"]


def test_r64_a_corrupt_artifact_does_not_crash_startup(tmp_path, reload_with_models_dir):
    for name in ("eta_model.joblib", "surge_model.joblib"):
        (tmp_path / name).write_bytes(b"not a pickle")
    module = reload_with_models_dir(tmp_path)
    health = TestClient(module.app).get("/health").json()
    assert health["models_loaded"] is False and health["load_error"]
