import pandas as pd

OTTAWA_RAW = "../Traffic_Collision_Data.csv"
HALIFAX_RAW = "../Traffic_Collisions_906585305445347675.csv"

OTTAWA_SEVERITY = {
    "01 - fatal injury":    "fatal",
    "02 - non-fatal injury": "non-fatal injury",
    "03 - p.d. only":       "property damage only",
}

OTTAWA_ROAD = {
    "01 - dry":          "dry",
    "02 - wet":          "wet",
    "03 - loose snow":   "snow",
    "04 - slush":        "slush",
    "05 - packed snow":  "snow",
    "06 - ice":          "ice",
}

OTTAWA_WEATHER = {
    "01 - clear":                    "clear",
    "02 - rain":                     "rain",
    "03 - snow":                     "snow",
    "04 - freezing rain":            "rain",
    "05 - drifting snow":            "snow",
    "06 - strong wind":              "strong wind",
    "07 - fog, mist, smoke, dust":   "fog",
}

OTTAWA_LIGHT = {
    "01 - daylight": "daylight",
    "03 - dawn":     "dawn",
    "05 - dusk":     "dusk",
    "07 - dark":     "dark",
}

HALIFAX_ROAD = {
    "dry - normal":              "dry",
    "wet":                       "wet",
    "icy":                       "ice",
    "snow - wet":                "snow",
    "snow - fresh or loose":     "snow",
    "snow - packed":             "snow",
    "water - standing or moving": "wet",
}

HALIFAX_WEATHER = {
    "clear":              "clear",
    "rain":               "rain",
    "snow":               "snow",
    "overcast or cloudy": "overcast",
    "freezing rain":      "rain",
    "strong wind":        "strong wind",
    "fog, mist or smog":  "fog",
    "dust or smoke":      "fog",
}

HALIFAX_LIGHT = {
    "daylight": "daylight",
    "dawn":     "dawn",
    "dusk":     "dusk",
    "darkness": "dark",
}


def clean_ottawa():
    df = pd.read_csv(OTTAWA_RAW, low_memory=False)

    df = df.rename(columns={
        "Classification_Of_Accident": "severity",
        "Environment_Condition_1":    "weather",
        "Road_1_Surface_Condition":   "road",
        "Light":                      "light",
        "Lat":                        "lat",
        "Long":                       "lon",
    })

    df["severity"] = df["severity"].str.strip().str.lower().map(OTTAWA_SEVERITY)
    df["weather"]  = df["weather"].str.strip().str.lower().map(OTTAWA_WEATHER)
    df["road"]     = df["road"].str.strip().str.lower().map(OTTAWA_ROAD)
    df["light"]    = df["light"].str.strip().str.lower().map(OTTAWA_LIGHT)

    df = df[["severity", "weather", "road", "light", "lat", "lon"]].dropna()

    df.to_csv("../data/ottawa.csv", index=False)
    print(f"ottawa: {len(df)} rows saved")
    print(df["severity"].value_counts())


def clean_halifax():
    df = pd.read_csv(HALIFAX_RAW, low_memory=False)

    df = df.rename(columns={
        "Fatal Injury":       "fatal",
        "Non Fatal Injury":   "nonfatal",
        "Weather Condition":  "weather",
        "Road Surface":       "road",
        "Light Condition":    "light",
        "Latitude WGS84":     "lat",
        "Longitude WGS84":    "lon",
    })

    def severity(row):
        if str(row["fatal"]).strip().lower() == "yes":
            return "fatal"
        if str(row["nonfatal"]).strip().lower() == "yes":
            return "non-fatal injury"
        return "property damage only"

    df["severity"] = df.apply(severity, axis=1)
    df["weather"]  = df["weather"].str.strip().str.lower().map(HALIFAX_WEATHER)
    df["road"]     = df["road"].str.strip().str.lower().map(HALIFAX_ROAD)
    df["light"]    = df["light"].str.strip().str.lower().map(HALIFAX_LIGHT)

    df = df[["severity", "weather", "road", "light", "lat", "lon"]].dropna()

    df.to_csv("../data/halifax.csv", index=False)
    print(f"halifax: {len(df)} rows saved")
    print(df["severity"].value_counts())


if __name__ == "__main__":
    clean_ottawa()
    clean_halifax()
