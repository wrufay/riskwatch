# riskwatch

> interactive traffic collision explorer for Ottawa and Halifax

built by two first-year CS students at the University of Waterloo. uses real open government data to let you explore where crashes happen, what conditions surround them, and where risk is highest across the city.

---

## what it does

- **blue heatmap** — where crashes historically happened. darker = higher density. this is real data.
- **red overlay** — where a Random Forest model predicts elevated fatal risk given your selected conditions. this is the ML layer.
- **click anywhere** — see a breakdown of real crashes within a radius you set: total count, severity split (fatal / non-fatal / property damage), most common conditions at that spot.
- **radius slider** — controls how wide the search area is when you click (100m–1km).
- **condition filters** — weather, road surface, lighting. changing these updates both the blue heatmap and the red risk surface in real time.

blue = what happened. red = what the model predicts could happen under your conditions.

---

## stack

- **model** — Random Forest (scikit-learn), enriched with OSM road type + speed limits
- **backend** — Flask
- **frontend** — HTML + Tailwind CSS + vanilla JS + OpenLayers
- **data** — Ottawa open data (88,615 records, 2017–2024) + Halifax open data (44,161 records)

---

## datasets

- Ottawa: https://open.ottawa.ca/datasets/ottawa::traffic-collision-data/about
- Halifax: https://data-hrm.hub.arcgis.com/datasets/HRM::traffic-collisions/about
- Road geometry + attributes: OpenStreetMap via Overpass API

---

## running locally

```bash
# install dependencies
pip install -r requirements.txt

# download road data + train models (first time only)
cd model
python3 download_roads.py
python3 enrich.py
python3 train.py

# start the API
cd ../api
python3 app.py

# open map.html in a browser
```

---

## todo/ideas

- allow users to see all crash data in a range like acc go indepth, able to scroll, with modals etc like just dive into all the data given

- two different "clickers" which u can toggle in the settings + dif colours, one for seeing historical and one for prediction

- for predictions, should show lots of reasoning behind why the model predicted that, including the enrichments etc

- can allow user to change opacity of the popup, other factors in the display etc.