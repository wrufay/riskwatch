const map = new ol.Map({
  target: 'map',
  layers: [
    new ol.layer.Tile({
      source: new ol.source.XYZ({
        url: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
        attributions: '© CartoDB',
      }),
    }),
  ],
  view: new ol.View({
    center: ol.proj.fromLonLat([-75.6972, 45.4215]),
    zoom: 12,
  }),
});
