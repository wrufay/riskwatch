import joblib
import numpy as np
import pandas as pd
from flask import Flask, request, jsonify
from flask_cors import CORS
from scipy.spatial import KDTree
import os

SEVERITY_WEIGHT = {
    "fatal":                1.0,
    "non-fatal injury":     0.5,
    "property damage only": 0.2,
}

app = Flask(__name__)
CORS(app)

models = {}
city_dfs = {}

for city in ("ottawa", "halifax"):
    try:
        models[city] = joblib.load(f"../model/{city}_model.pkl")
        city_dfs[city] = pd.read_csv(f"../data/{city}.csv").dropna(subset=["lat", "lon"])
        print(f"loaded {city} model + data")
    except FileNotFoundError:
        print(f"warning: {city} files not found")


DEFAULT_RADIUS_M = 500

crash_trees = {}

def get_crash_tree(city):
    if city not in crash_trees:
        df = city_dfs[city]
        crash_trees[city] = KDTree(df[["lat", "lon"]].values)
    return crash_trees[city]


@app.route("/predict", methods=["POST"])
def predict():
    data = request.get_json()
    city = data.get("city", "ottawa")
    if city not in models:
        return jsonify({"error": "model not loaded"}), 503

    artifact = models[city]
    model    = artifact["model"]
    trained_cols = artifact["columns"]

    lat = float(data.get("lat", 0))
    lon = float(data.get("lon", 0))
    _, highways, speeds = snap_road(city, [lat], [lon])
    highway = highways[0]
    speed   = int(speeds[0])

    row = {
        "weather": data.get("weather", "clear"),
        "road":    data.get("road_surface", "dry"),
        "light":   data.get("light", "daylight"),
        "highway": highway,
        "lat": lat, "lon": lon, "speed": float(speed),
    }
    X = pd.get_dummies(pd.DataFrame([row]))
    X = X.reindex(columns=trained_cols, fill_value=0)
    proba   = model.predict_proba(X)[0]
    classes = model.classes_
    probabilities = {cls: round(float(p), 3) for cls, p in zip(classes, proba)}
    severity = classes[proba.argmax()]

    # top active features by importance
    importances = dict(zip(trained_cols, model.feature_importances_))
    weather = data.get("weather", "clear")
    road    = data.get("road_surface", "dry")
    light   = data.get("light", "daylight")
    active = {
        f"weather_{weather}": importances.get(f"weather_{weather}", 0),
        f"road_{road}":       importances.get(f"road_{road}", 0),
        f"light_{light}":     importances.get(f"light_{light}", 0),
        f"highway_{highway}": importances.get(f"highway_{highway}", 0),
        "speed":              importances.get("speed", 0),
        "location":           max(importances.get("lat", 0), importances.get("lon", 0)),
    }

    factors = [factor_label(k) for k, _ in sorted(active.items(), key=lambda x: -x[1])[:3]]

    return jsonify({
        "severity":      severity,
        "probabilities": probabilities,
        "highway":       highway,
        "speed":         speed,
        "conditions":    {"weather": weather, "road": road, "light": light},
        "factors":       factors,
    })


@app.route("/local-records", methods=["POST"])
def local_records():
    data = request.get_json()
    city = data.get("city", "ottawa")
    lat  = float(data.get("lat", 0))
    lon  = float(data.get("lon", 0))

    if city not in city_dfs:
        return jsonify({"error": "unknown city"}), 400

    radius_m   = float(data.get("radius", DEFAULT_RADIUS_M))
    radius_deg = radius_m / 111_000

    df   = city_dfs[city]
    tree = get_crash_tree(city)
    idxs = tree.query_ball_point([lat, lon], radius_deg)
    nearby = df.iloc[idxs]

    SEV_ORDER = {"fatal": 0, "non-fatal injury": 1, "property damage only": 2}
    nearby = nearby.sort_values("severity", key=lambda s: s.map(SEV_ORDER))

    cols = ["severity", "weather", "road", "light", "highway", "speed"]
    available = [c for c in cols if c in nearby.columns]
    records = nearby[available].head(200).to_dict(orient="records")

    return jsonify({"total": len(idxs), "records": records})


@app.route("/local-stats", methods=["POST"])
def local_stats():
    data = request.get_json()
    city = data.get("city", "ottawa")
    lat  = float(data.get("lat", 0))
    lon  = float(data.get("lon", 0))

    if city not in city_dfs:
        return jsonify({"error": "unknown city"}), 400

    radius_m   = float(data.get("radius", DEFAULT_RADIUS_M))
    radius_deg = radius_m / 111_000  # 1 degree ≈ 111km

    df   = city_dfs[city]
    tree = get_crash_tree(city)
    idxs = tree.query_ball_point([lat, lon], radius_deg)
    nearby = df.iloc[idxs]
    total  = len(nearby)

    if total == 0:
        return jsonify({"total": 0})

    sev = nearby["severity"].value_counts(normalize=True).to_dict()
    top_weather = nearby["weather"].mode()[0]
    top_road    = nearby["road"].mode()[0]
    top_light   = nearby["light"].mode()[0]

    city_avg_radius = len(df) * (np.pi * radius_deg ** 2) / 0.26
    density_vs_avg = round(total / max(city_avg_radius, 1), 1)

    return jsonify({
        "total":          total,
        "severity":       {k: round(v, 3) for k, v in sev.items()},
        "top_weather":    top_weather,
        "top_road":       top_road,
        "top_light":      top_light,
        "density_vs_avg": density_vs_avg,
    })


@app.route("/points/<city>")
def points(city):
    if city not in city_dfs:
        return jsonify({"error": "unknown city"}), 400

    df = city_dfs[city]

    weather = request.args.get("weather")
    road    = request.args.get("road")
    light   = request.args.get("light")

    if weather: df = df[df["weather"] == weather]
    if road:    df = df[df["road"] == road]
    if light:   df = df[df["light"] == light]

    sample = df.sample(min(8000, len(df)), random_state=42) if len(df) > 0 else df

    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [row.lon, row.lat]},
            "properties": {"weight": SEVERITY_WEIGHT.get(row.severity, 0.2)},
        }
        for row in sample.itertuples()
    ]

    return jsonify({"type": "FeatureCollection", "features": features})


road_data = {}

def load_road(city):
    if city in road_data:
        return road_data[city]
    df = pd.read_csv(f"../data/{city}_roads_tagged.csv")
    tree = KDTree(df[["lat", "lon"]].values)
    road_data[city] = {
        "tree":   tree,
        "labels": df["highway"].values,
        "speeds": df["speed"].values,
    }
    print(f"{city}: {len(df)} road nodes loaded")
    return road_data[city]

def snap_road(city, lats, lons):
    rd = load_road(city)
    coords = np.column_stack([lats, lons])
    distances, indices = rd["tree"].query(coords)
    return distances, rd["labels"][indices], rd["speeds"][indices]


CITY_BOUNDS = {
    "ottawa": {"lat": (45.20, 45.55), "lon": (-76.00, -75.25), "step": 0.015, "road_thresh": 0.006},
    "halifax": {"lat": (44.55, 44.85), "lon": (-63.80, -63.45), "step": 0.012, "road_thresh": 0.005},
}

WEATHER_OPTS = ["clear", "rain", "snow", "fog", "strong wind"]
ROAD_OPTS    = ["dry", "wet", "ice", "snow", "slush"]
LIGHT_OPTS   = ["daylight", "dawn", "dusk", "dark"]


def factor_label(name):
    if name.startswith("weather_"): return name[8:] + " weather"
    if name.startswith("road_"):    return name[5:] + " surface"
    if name.startswith("light_"):   return name[6:] + " light"
    if name.startswith("highway_"): return name[8:] + " road"
    if name == "speed":    return "speed limit"
    if name == "location": return "location"
    return name


def _batch_alternatives(city, weather, road, light, lat, lon):
    """Snap road once, run base + all condition variants in one model.predict_proba call."""
    artifact     = models[city]
    model        = artifact["model"]
    trained_cols = artifact["columns"]
    classes      = list(model.classes_)

    _, highways, speeds = snap_road(city, [lat], [lon])
    highway = highways[0]
    speed   = float(speeds[0])

    base = {"weather": weather, "road": road, "light": light,
            "highway": highway, "lat": lat, "lon": lon, "speed": speed}

    alt_specs = []
    for field, opts in [("weather", WEATHER_OPTS), ("road", ROAD_OPTS), ("light", LIGHT_OPTS)]:
        cur = {"weather": weather, "road": road, "light": light}[field]
        for val in opts:
            if val != cur:
                alt_specs.append((field, cur, val, {**base, field: val}))

    all_rows = [base] + [s[3] for s in alt_specs]
    df       = pd.DataFrame(all_rows)
    X        = pd.get_dummies(df[["weather", "road", "light", "highway"]])
    X["lat"]   = df["lat"].values
    X["lon"]   = df["lon"].values
    X["speed"] = df["speed"].values
    X = X.reindex(columns=trained_cols, fill_value=0)

    all_proba  = model.predict_proba(X)
    fatal_idx  = classes.index("fatal")
    base_proba = all_proba[0]
    base_fatal = float(base_proba[fatal_idx])

    alternatives = sorted([
        {
            "field":      field,
            "from":       frm,
            "to":         to,
            "fatal_prob": round(float(p[fatal_idx]), 4),
            "delta":      round(float(p[fatal_idx]) - base_fatal, 4),
        }
        for (field, frm, to, _), p in zip(alt_specs, all_proba[1:])
    ], key=lambda x: x["delta"])

    return highway, int(speed), base_proba, classes, base_fatal, alternatives


def predict_batch(city, rows_df, return_distances=False):
    artifact = models[city]
    model = artifact["model"]
    trained_cols = artifact["columns"]
    distances, highways, speeds = snap_road(city, rows_df["lat"].values, rows_df["lon"].values)
    df = rows_df.copy()
    df["highway"] = highways
    df["speed"]   = speeds.astype(float)
    X = pd.get_dummies(df[["weather", "road", "light", "highway"]])
    X["lat"]   = df["lat"].values
    X["lon"]   = df["lon"].values
    X["speed"] = df["speed"].values
    X = X.reindex(columns=trained_cols, fill_value=0)
    proba = model.predict_proba(X)
    fatal_idx = list(model.classes_).index("fatal")
    fatal_probs = proba[:, fatal_idx]
    return (fatal_probs, distances) if return_distances else fatal_probs



@app.route("/risk-surface", methods=["POST"])
def risk_surface():
    data = request.get_json()
    city = data.get("city", "ottawa")
    if city not in models:
        return jsonify({"error": "model not loaded"}), 503

    b = CITY_BOUNDS[city]
    lats = np.arange(b["lat"][0], b["lat"][1], b["step"])
    lons = np.arange(b["lon"][0], b["lon"][1], b["step"])

    rows = [
        {"weather": data.get("weather", "clear"),
         "road":    data.get("road_surface", "dry"),
         "light":   data.get("light", "daylight"),
         "lat": float(lat), "lon": float(lon)}
        for lat in lats for lon in lons
    ]
    df = pd.DataFrame(rows)
    fatal_probs, distances = predict_batch(city, df, return_distances=True)

    step = b["step"]
    p25 = float(np.percentile(fatal_probs, 75))

    features = [
        {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [row["lon"] + step / 2, row["lat"] + step / 2],
            },
            "properties": {"p": round(float(p), 4)},
        }
        for row, p, dist in zip(rows, fatal_probs, distances)
        if p >= p25 and dist <= b["road_thresh"]
    ]
    return jsonify({"type": "FeatureCollection", "features": features})


@app.route("/counterfactual", methods=["POST"])
def counterfactual():
    data = request.get_json()
    city = data.get("city", "ottawa")
    if city not in models:
        return jsonify({"error": "model not loaded"}), 503

    _, _, _, _, _, alternatives = _batch_alternatives(
        city,
        data.get("weather", "clear"),
        data.get("road_surface", "dry"),
        data.get("light", "daylight"),
        float(data.get("lat", 0)),
        float(data.get("lon", 0)),
    )
    best = next((a for a in alternatives if a["delta"] < 0), None)
    if best:
        return jsonify({"field": best["field"], "from": best["from"], "to": best["to"],
                        "reduction": round(-best["delta"], 3)})
    return jsonify({})


@app.route("/predict-detail", methods=["POST"])
def predict_detail():
    data    = request.get_json()
    city    = data.get("city", "ottawa")
    weather = data.get("weather", "clear")
    road    = data.get("road_surface", "dry")
    light   = data.get("light", "daylight")
    lat     = float(data.get("lat", 0))
    lon     = float(data.get("lon", 0))

    if city not in models:
        return jsonify({"error": "model not loaded"}), 503

    highway, speed, base_proba, classes, base_fatal, alternatives = _batch_alternatives(
        city, weather, road, light, lat, lon
    )

    probabilities = {cls: round(float(p), 3) for cls, p in zip(classes, base_proba)}
    severity      = classes[int(base_proba.argmax())]

    trained_cols = models[city]["columns"]
    model        = models[city]["model"]
    importances  = dict(zip(trained_cols, model.feature_importances_))
    active = {
        f"weather_{weather}": importances.get(f"weather_{weather}", 0),
        f"road_{road}":       importances.get(f"road_{road}", 0),
        f"light_{light}":     importances.get(f"light_{light}", 0),
        f"highway_{highway}": importances.get(f"highway_{highway}", 0),
        "speed":              importances.get("speed", 0),
        "location":           max(importances.get("lat", 0), importances.get("lon", 0)),
    }
    all_factors = [
        {"label": factor_label(k), "importance": round(v, 4)}
        for k, v in sorted(active.items(), key=lambda x: -x[1])
    ]

    return jsonify({
        "severity":      severity,
        "probabilities": probabilities,
        "highway":       highway,
        "speed":         speed,
        "conditions":    {"weather": weather, "road": road, "light": light},
        "factors":       all_factors,
        "alternatives":  alternatives,
        "base_fatal":    round(base_fatal, 4),
    })


import os
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)

