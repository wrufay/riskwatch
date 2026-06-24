import pandas as pd
from scipy.spatial import KDTree

for city in ("ottawa", "halifax"):
    crashes = pd.read_csv(f"../data/{city}.csv")
    roads = pd.read_csv(f"../data/{city}_roads_tagged.csv")

    tree = KDTree(roads[["lat", "lon"]].values)
    _, indices = tree.query(crashes[["lat", "lon"]].values)

    crashes["highway"] = roads["highway"].iloc[indices].values
    crashes["speed"]   = roads["speed"].iloc[indices].values
    crashes.to_csv(f"../data/{city}.csv", index=False)

    print(f"{city}: highway + speed added")
    print(crashes["highway"].value_counts().to_string())
    print(crashes["speed"].value_counts().head(6).to_string())
    print()
