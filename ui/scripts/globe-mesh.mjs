import { readFileSync, writeFileSync } from "node:fs";
import { geoContains, geoDistance, geoInterpolate } from "d3-geo";
import { feature } from "topojson-client";

const topo = JSON.parse(readFileSync(new URL("../node_modules/world-atlas/countries-110m.json", import.meta.url), "utf8"));
const land = feature(topo, topo.objects.land);
const shapes = land.type === "FeatureCollection" ? land.features : [land];

let seed = 20261102;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

const points = [];
const coast = new Set();
const N = Number(process.argv[2] ?? 2600);
const golden = Math.PI * (3 - Math.sqrt(5));
for (let i = 0; i < N; i++) {
  const y = 1 - (2 * (i + 0.5)) / N;
  const r = Math.sqrt(1 - y * y);
  const a = golden * i;
  const lon = (Math.atan2(r * Math.sin(a), r * Math.cos(a)) * 180) / Math.PI + (rnd() - 0.5) * 2.4;
  const lat = (Math.asin(y) * 180) / Math.PI + (rnd() - 0.5) * 2.4;
  if (lat < -62 && rnd() < 0.6) continue;
  if (shapes.some((f) => geoContains(f, [lon, lat]))) points.push([lon, lat]);
}
const STEP = Number(process.argv[3] ?? 4);
for (const f of shapes) {
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) {
    const ring = poly[0];
    if (ring.length < 12 && rnd() < 0.5) continue;
    for (let j = 0; j < ring.length - 1; j += STEP) {
      coast.add(points.length);
      points.push(ring[j]);
    }
  }
}

const onLand = (p) => shapes.some((f) => geoContains(f, p));
const K = 4;
const MAX = (7 * Math.PI) / 180;
const edges = new Set();
for (let i = 0; i < points.length; i++) {
  const near = [];
  for (let j = 0; j < points.length; j++) {
    if (i === j) continue;
    const d = geoDistance(points[i], points[j]);
    if (d < MAX) near.push([d, j]);
  }
  near.sort((a, b) => a[0] - b[0]);
  for (const [d, j] of near.slice(0, K)) {
    const key = i < j ? `${i},${j}` : `${j},${i}`;
    if (edges.has(key)) continue;
    const hugsCoast = coast.has(i) && coast.has(j) && d < (2.5 * Math.PI) / 180;
    if (!hugsCoast && !onLand(geoInterpolate(points[i], points[j])(0.5))) continue;
    edges.add(key);
  }
}

const round = (v) => Math.round(v * 100) / 100;
const out = {
  points: points.flatMap(([lon, lat]) => [round(lon), round(lat)]),
  edges: [...edges].flatMap((k) => k.split(",").map(Number)),
};
const file = new URL("../src/components/globe/mesh.json", import.meta.url);
writeFileSync(file, JSON.stringify(out));
console.log(`points ${points.length} (coast ${coast.size}), edges ${edges.size}, ${(JSON.stringify(out).length / 1024).toFixed(1)} KB`);
