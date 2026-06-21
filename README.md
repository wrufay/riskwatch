# riskwatch

> learning ML through building a collision risk predictor

a traffic collision severity visualizer built by two first-year CS students at the University of Waterloo. compares Ottawa and Halifax using real open government data and a logistic regression model.

---

## what it does

- predicts collision severity (fatal / non-fatal / property damage only) based on road conditions
- user picks weather, road surface, light conditions, and time of day
- OpenLayers heatmap updates in real time showing risk across the city
- toggle between Ottawa and Halifax

---

## stack

- **model** — logistic regression (scikit-learn)
- **backend** — Flask
- **frontend** — HTML + Tailwind CSS + vanilla JS + OpenLayers
- **data** — Ottawa open data (94,406 records, 2017–2024) + Halifax open data (45,899 records, up to 2020)

---

## datasets

- Ottawa: https://open.ottawa.ca/datasets/ottawa::traffic-collision-data/about
- Halifax: https://data-hrm.hub.arcgis.com/datasets/HRM::traffic-collisions/about

---

## team

- **fay wu** — model, frontend, design
- **justin fang** — data cleaning, Flask API
