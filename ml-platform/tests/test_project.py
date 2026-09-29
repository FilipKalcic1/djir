"""Repository-level promises: packaging, notebooks, reported metrics, test clock."""

import contextlib
import json
import os
import re
import subprocess
import sys
import time
import types
from pathlib import Path

import joblib
import pytest

from djir_ml.geo import haversine_km

ML_ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = ML_ROOT.parent


def test_r30_config_imports_without_xgboost():
    # A notebook that only needs the constants must not need XGBoost installed.
    code = "import sys; sys.modules['xgboost'] = None; import djir_ml.config, djir_ml.pricing"
    subprocess.run([sys.executable, "-c", code], cwd=ML_ROOT, check=True)


def test_r11_notebook_04_keeps_payment_status_for_training():
    source = (ML_ROOT / "notebooks" / "04_feature_engineering.py").read_text(encoding="utf-8")
    keep = re.search(r"keep = \((.*?)\n\)", source, re.S)
    assert keep and '"payment_status"' in keep.group(1)


def _script(name):
    import importlib.util

    spec = importlib.util.spec_from_file_location(name, ML_ROOT / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_readme_chart_is_what_the_committed_models_give():
    # docs/images/price-by-pickup-time.svg — regenerate with scripts/plot_price_by_time.py
    plot = _script("plot_price_by_time")
    assert plot.CHART_PATH.read_text(encoding="utf-8") == plot.render(plot.fares())


def test_readme_chart_text_is_computed_from_its_data(monkeypatch):
    # The <desc> and the distance must move with the models and the route, or the
    # freshness test above would compare one hard-coded sentence with itself.
    plot = _script("plot_price_by_time")
    monkeypatch.setattr(plot, "DROPOFF", (45.8310, 16.1100))  # Sesvete
    rows = [[7.0] * 95 + [12.6], [5.61] * 96, [5.65, 7.7] + [6.0] * 94]

    svg = plot.render(rows)

    assert haversine_km(*plot.PICKUP, *plot.DROPOFF) == pytest.approx(13.2, abs=0.05)
    assert "Tresnjevka → Donji grad (13.2 km), quoted by" in svg
    assert (
        '<desc id="desc">Fare for Tresnjevka to Donji grad (13.2 km) by pickup time: '
        "Saturday, rain: €7.00 to €12.60; Saturday, clear: €5.61 to €5.61; "
        "Tuesday, clear: €5.65 to €7.70.</desc>"
    ) in svg


def _metrics():
    return json.loads((ML_ROOT / "models" / "metrics.json").read_text(encoding="utf-8"))


def test_r28_metrics_report_both_eta_baselines():
    eta = _metrics()["eta"]
    assert eta["baseline_informed_heuristic"]["mae"] == pytest.approx(3.12, abs=0.005)
    assert eta["model"]["mae"] == pytest.approx(3.18, abs=0.005)
    # The honest reading: the ETA model does not beat the informed heuristic.
    assert eta["mae_improvement_vs_informed_pct"] < 0


def _change(improvement_pct):
    """metrics.json stores the MAE improvement (58.0 = 58% lower); tables show the change."""
    return f"{-improvement_pct:+.0f}%".replace("-", "−")


def _table_row(markdown, model):
    """The metrics-table row for `model` ('ETA' or 'Surge'), without bold markers."""
    rows = [
        line.replace("**", "")
        for line in markdown.splitlines()
        if line.startswith("|") and line.split("|")[1].strip(" *") == model
    ]
    assert len(rows) == 1, f"expected one {model} row in the metrics table"
    return rows[0]


@pytest.mark.parametrize("readme", ["README.md", "ml-platform/README.md"])
def test_r28_readme_numbers_match_metrics_json(readme):
    # Every MAE cell and every improvement cell, in table order.
    text = (APP_ROOT / readme).read_text(encoding="utf-8")
    eta, surge = _metrics()["eta"], _metrics()["surge"]
    cells = re.compile(r"\d+\.\d+ min|\d+\.\d+×|[−+]\d+%")

    assert cells.findall(_table_row(text, "ETA")) == [
        f"{eta['model']['mae']:.2f} min",
        f"{eta['baseline_naive_flat_speed']['mae']:.2f} min",
        _change(eta["mae_improvement_pct"]),
        f"{eta['baseline_informed_heuristic']['mae']:.2f} min",
        _change(eta["mae_improvement_vs_informed_pct"]),
    ]
    assert cells.findall(_table_row(text, "Surge")) == [
        f"{surge['model']['mae']:.3f}×",
        f"{surge['baseline_mean']['mae']:.3f}×",
        _change(surge["mae_improvement_pct"]),
        f"{surge['baseline_informed_heuristic']['mae']:.3f}×",
        _change(surge["mae_improvement_vs_informed_pct"]),
    ]


def test_r28_ml_readme_r2_and_training_rows_match_metrics_json():
    text = (ML_ROOT / "README.md").read_text(encoding="utf-8")
    m = _metrics()
    for model, key in (("ETA", "eta"), ("Surge", "surge")):
        last_cell = _table_row(text, model).strip().strip("|").split("|")[-1].strip()
        assert last_cell == f"{m[key]['model']['r2']:.3f}"
    assert f"trained on {m['eta']['n_train']:,} of" in text


def test_r66_run_local_keeps_the_committed_models_unless_promoted(tmp_path):
    # Retraining is not bit-for-bit reproducible: writing to models/ by default
    # would silently change what serving, the pinned tests and the READMEs use.
    run_local = _script("run_local")

    assert run_local.artifacts_dir(run_local.parse_args(["--fresh"]).promote) == ML_ROOT / "data" / "models"
    assert run_local.artifacts_dir(run_local.parse_args(["--fresh", "--promote"]).promote) == ML_ROOT / "models"

    out = tmp_path / "data" / "models"
    run_local.save_artifacts({"eta": 1}, {"surge": 2}, {"eta": {"n_train": 3}}, out)
    assert sorted(p.name for p in out.iterdir()) == ["eta_model.joblib", "metrics.json", "surge_model.joblib"]
    assert json.loads((out / "metrics.json").read_text(encoding="utf-8")) == {"eta": {"n_train": 3}}


def _notebook_cell(notebook, heading):
    """The code cell that follows the markdown cell containing `heading`."""
    cells = (ML_ROOT / "notebooks" / notebook).read_text(encoding="utf-8").split("# COMMAND ----------")
    at = next(i for i, cell in enumerate(cells) if heading in cell)
    return cells[at + 1]


@pytest.mark.parametrize(("promote", "folder"), [("false", ("data", "models")), ("true", ("models",))])
def test_r66_notebook_07_exports_like_run_local_with_the_champions_metrics(monkeypatch, tmp_path, promote, folder):
    # The other writer of models/ follows run_local.py's rule (data/models/ unless
    # promoted), and the metrics.json that notebooks 05 and 06 logged with each
    # @champion travels with it, so /metrics describes the models it serves.
    class Registry:
        def get_model_version_by_alias(self, model, alias):
            return types.SimpleNamespace(run_id=f"run-of-{model}@{alias}")

    class Widgets:
        def dropdown(self, name, default, choices):
            assert (name, default, choices) == ("promote", "false", ["false", "true"])

        def get(self, name):
            return promote

    mlflow = types.ModuleType("mlflow")
    mlflow.MlflowClient = lambda registry_uri: Registry()
    mlflow.artifacts = types.ModuleType("mlflow.artifacts")
    mlflow.artifacts.load_dict = lambda uri: {"logged_at": uri}
    monkeypatch.setitem(sys.modules, "mlflow", mlflow)
    monkeypatch.setitem(sys.modules, "mlflow.artifacts", mlflow.artifacts)
    cell = _notebook_cell("07_register_and_serve.py", "### Path 1")

    exec(cell, {  # noqa: S102 - the notebook's own cell, with Databricks stubbed out
        "dbutils": types.SimpleNamespace(widgets=Widgets()),
        "ML_PLATFORM": str(tmp_path),
        "ETA_MODEL": "djir.ml.eta",
        "SURGE_MODEL": "djir.ml.surge",
        "eta": {"model": "eta"},
        "surge": {"model": "surge"},
    })

    out = tmp_path.joinpath(*folder)
    assert sorted(p.name for p in tmp_path.rglob("*") if p.is_file()) == [
        "eta_model.joblib", "metrics.json", "surge_model.joblib"]
    assert json.loads((out / "metrics.json").read_text(encoding="utf-8")) == {
        "eta": {"logged_at": "runs:/run-of-djir.ml.eta@champion/metrics.json"},
        "surge": {"logged_at": "runs:/run-of-djir.ml.surge@champion/metrics.json"},
    }
    assert joblib.load(out / "surge_model.joblib") == {"model": "surge"}


@pytest.mark.parametrize("notebook", ["05_train_eta.py", "06_train_surge.py"])
def test_r66_training_notebooks_log_the_metrics_json_notebook_07_exports(notebook):
    source = (ML_ROOT / "notebooks" / notebook).read_text(encoding="utf-8")
    run = source[source.index("with mlflow.start_run("):source.index("mlflow.sklearn.log_model(")]
    assert 'mlflow.log_dict(metrics, "metrics.json")' in run


def test_r66_generate_data_writes_under_ml_platform_whatever_the_working_directory(monkeypatch, tmp_path):
    # Started from the repo root, a relative default would drop a 64k-row
    # dataset into <repo>/data/, which no .gitignore covers.
    monkeypatch.chdir(tmp_path)
    generate_data = _script("generate_data")

    assert generate_data.parse_args([]).out == str(ML_ROOT / "data")
    assert generate_data.parse_args(["--out", "elsewhere"]).out == "elsewhere"


@contextlib.contextmanager
def _machine_timezone(zone):
    """Run the block with the process in `zone`, then restore TZ AND the C
    library's copy of it: tzset() only re-reads TZ when called, so it has to
    run again after TZ is put back, or later tests run in the wrong zone."""
    try:
        with pytest.MonkeyPatch.context() as mp:
            mp.setenv("TZ", zone)
            time.tzset()
            yield
    finally:
        time.tzset()


@pytest.fixture
def los_angeles_machine():
    with _machine_timezone("America/Los_Angeles"):
        yield


@pytest.mark.skipif(sys.platform == "win32", reason="time.tzset is POSIX-only")
def test_the_suite_does_not_depend_on_the_machine_timezone(los_angeles_machine):
    # CI runs pytest under TZ=America/Los_Angeles; prove the pricing clock ignores it.
    from djir_ml import features
    import datetime as dt

    f = features.request_features(45.80, 15.945, 45.8085, 15.9775,
                                  dt.datetime(2025, 6, 3, 6, 15, tzinfo=dt.timezone.utc), "clear")
    assert f["hour_of_day"] == 8


def test_the_tz_sentinel_restores_the_process_timezone(monkeypatch):
    # Runs on every platform: a stand-in tzset records the TZ it would read.
    read = []
    monkeypatch.setattr(time, "tzset", lambda: read.append(os.environ.get("TZ")), raising=False)
    monkeypatch.setenv("TZ", "Europe/Lisbon")  # a zone set for the whole run, as CI sets one

    with _machine_timezone("Asia/Tokyo"):
        assert os.environ["TZ"] == "Asia/Tokyo"

    assert read == ["Asia/Tokyo", "Europe/Lisbon"]
    assert os.environ["TZ"] == "Europe/Lisbon"
