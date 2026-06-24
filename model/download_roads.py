import urllib.request, urllib.parse, json, numpy as np, pandas as pd

CITIES = {
    "ottawa": "45.20,-76.00,45.55,-75.25",
    "halifax": "44.55,-63.80,44.85,-63.45",
}

HIGHWAY_MAP = {
    "motorway": "highway", "motorway_link": "highway",
    "trunk": "highway",    "trunk_link": "highway",
    "primary": "primary",  "primary_link": "primary",
    "secondary": "secondary", "secondary_link": "secondary",
    "tertiary": "tertiary",   "tertiary_link": "tertiary",
    "residential": "residential", "unclassified": "residential",
    "service": "residential",     "living_street": "residential",
}

# Canadian default speed limits by highway type (km/h)
SPEED_DEFAULT = {
    "highway": 100,
    "primary": 60,
    "secondary": 50,
    "tertiary": 50,
    "residential": 40,
}

def parse_speed(val):
    if not val:
        return None
    val = str(val).lower().replace("mph", "").replace("km/h", "").replace("kmh", "").strip()
    try:
        return int(float(val))
    except ValueError:
        return None

for city, bbox in CITIES.items():
    query = (
        f'[out:json][timeout:90];'
        f'way["highway"~"motorway|trunk|primary|secondary|tertiary|residential|unclassified|service"]({bbox});'
        f'out geom tags;'
    )
    data = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(
        "https://overpass-api.de/api/interpreter",
        data=data,
        headers={"User-Agent": "riskwatch/1.0", "Accept": "application/json"},
    )
    print(f"downloading {city} roads with tags...")
    with urllib.request.urlopen(req, timeout=90) as r:
        elements = json.loads(r.read())["elements"]

    rows = []
    for way in elements:
        tags = way.get("tags", {})
        hw = HIGHWAY_MAP.get(tags.get("highway", ""), "residential")
        speed = parse_speed(tags.get("maxspeed")) or SPEED_DEFAULT.get(hw, 50)
        for node in way.get("geometry", []):
            rows.append({"lat": node["lat"], "lon": node["lon"], "highway": hw, "speed": speed})

    df = pd.DataFrame(rows)
    df.to_csv(f"../data/{city}_roads_tagged.csv", index=False)
    np.save(f"../data/{city}_roads.npy", df[["lat", "lon"]].values)
    print(f"{city}: {len(df)} road nodes")
    print("highway:", df["highway"].value_counts().to_dict())
    print("speed (sample):", df["speed"].value_counts().head(5).to_dict())
