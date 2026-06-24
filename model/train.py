import pandas as pd
import joblib
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report

CAT_FEATURES = ["weather", "road", "light", "highway"]
NUM_FEATURES = ["lat", "lon", "speed"]


def train(city):
    df = pd.read_csv(f"../data/{city}.csv")

    X_cat = pd.get_dummies(df[CAT_FEATURES])
    X_num = df[NUM_FEATURES].reset_index(drop=True)
    X = pd.concat([X_cat, X_num], axis=1)
    y = df["severity"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    model = RandomForestClassifier(n_estimators=100, class_weight="balanced", random_state=42, n_jobs=-1)
    model.fit(X_train, y_train)

    print(f"\n── {city} ──")
    print(classification_report(y_test, model.predict(X_test)))

    joblib.dump({"model": model, "columns": list(X.columns)}, f"{city}_model.pkl")
    print(f"saved {city}_model.pkl")


if __name__ == "__main__":
    train("ottawa")
    train("halifax")
