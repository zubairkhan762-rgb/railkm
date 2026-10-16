// scripts/build-railway-graph.mjs
//
// Builds src/data/railway-graph.json — the RailKM routing graph.
//
// DATA SCHEMA NOTE (why per-segment km is reconstructed, not read):
// DataMeet's schedules.json is a flat list of stop records
// ({train_number, station_code, arrival, departure, day, ...}) and carries NO
// distance field at all — there is no cumulative `km` per stop to diff. The
// only distance signal in the whole dataset is trains.json:
//   • properties.distance  → published total route length (one number/train)
//   • geometry.coordinates → the FULL station chain of the route (every vertex
//                            matches a station coordinate in stations.json)
//
// Segment kilometres are therefore reconstructed per train as:
//   segmentKm = chordLength(a, b) * scale
//   scale     = publishedTotalDistance / totalChordLength   (per train)
// and then, for each physical segment, combined across every train that runs
// over it using the CONSENSUS MEDIAN (not min) so a single corrupt timetable
// row cannot drag the distance down.
//
// Physical guards (a rail track can never be shorter than the straight line
// between its endpoints and never curve wildly):
//   • trains whose scale falls outside [MIN_SCALE, MAX_SCALE] are discarded
//     outright — no more sub-chord "impossible" estimates from bad totals.
//   • every consensus segment is floored at its straight-line distance and
//     rejected if it exceeds straightLine × MAX_SCALE.
//   • single hops longer than LONG_HOP_KM are treated as non-stop express
//     jumps with missing intermediate vertices and dropped unless they are the
//     only connection for an endpoint.

import fs from 'fs';
import path from 'path';

const STATIONS_URL = 'https://raw.githubusercontent.com/datameet/railways/master/stations.json';
const TRAINS_URL = 'https://raw.githubusercontent.com/datameet/railways/master/trains.json';

const OUTPUT_PATH = path.resolve('./src/data/railway-graph.json');

const COORD_PRECISION_HI = 5;
const COORD_PRECISION_LO = 4;

// Curvature factor bounds (track length ÷ straight-line distance).
const MIN_SCALE = 0.98;
const MAX_SCALE = 2.8;

// A single hop beyond this is treated as a non-stop jump over missing vertices.
const LONG_HOP_KM = 120;
const MAX_EDGE_KM = 250;
const PRUNE_TOLERANCE_KM = -1;

// International trains (e.g. Maitree Express) carry foreign stations from the
// source data; they must never be matched into Indian track segments.
const FOREIGN_STATES = new Set(['bangladesh', 'pakistan', 'nepal', 'sri lanka', 'myanmar', 'bhutan', 'china']);

async function fetchJson(url, label) {
    console.log(`⏳ Downloading ${label}...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${label}: ${res.statusText}`);
    return await res.json();
}

function haversineKm(a, b) {
    const R = 6371;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLon = (b.lon - a.lon) * Math.PI / 180;
    const s = Math.sin(dLat / 2) ** 2 +
        Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function generateRailwayGraph() {
    try {
        const [stationsRaw, trainsRaw] = await Promise.all([
            fetchJson(STATIONS_URL, 'Stations Metadata'),
            fetchJson(TRAINS_URL, 'Train Routes (with distances)')
        ]);

        // 1. Parse All Stations (GeoJSON from DataMeet) + keep coordinates
        console.log('🚉 Parsing Stations...');
        const stations = {};
        const coords = {};
        const byCoordHi = new Map();
        const byCoordLo = new Map();

        for (const feature of stationsRaw.features || []) {
            const props = feature.properties || {};
            const code = (props.code || '').trim().toUpperCase();
            const name = (props.name || '').trim();
            if (!code || !name || stations[code]) continue;

            stations[code] = {
                name,
                zone: props.zone || 'IR',
                division: props.division || 'IR',
                state: props.state || '',
                isJunction: /(^|\s)(JN|JUNCTION)\b/i.test(name)
            };

            const c = feature.geometry?.coordinates;
            if (!c || FOREIGN_STATES.has((props.state || '').trim().toLowerCase())) continue;
            coords[code] = { lon: c[0], lat: c[1] };
            const kHi = `${c[0].toFixed(COORD_PRECISION_HI)},${c[1].toFixed(COORD_PRECISION_HI)}`;
            const kLo = `${c[0].toFixed(COORD_PRECISION_LO)},${c[1].toFixed(COORD_PRECISION_LO)}`;
            if (!byCoordHi.has(kHi)) byCoordHi.set(kHi, code);
            if (!byCoordLo.has(kLo)) byCoordLo.set(kLo, code);
        }
        console.log(`   → ${Object.keys(stations).length} stations parsed`);

        // 2. Walk every train's station chain and sample per-segment kilometres
        console.log('🛤️  Sampling track segments from train geometries...');
        const samples = new Map(); // "A|B" (sorted) -> [segmentKm, ...]
        let trainsUsed = 0;
        let trainsSkipped = 0;
        let samplesTotal = 0;

        for (const feature of trainsRaw.features || []) {
            const props = feature.properties || {};
            const geom = feature.geometry?.coordinates || [];
            const publishedKm = Number(props.distance);

            if (geom.length < 2 || !Number.isFinite(publishedKm) || publishedKm <= 0) {
                trainsSkipped++;
                continue;
            }

            // Map each vertex to a station code + chord length to previous vertex
            const chain = [];
            const hopKm = [];
            for (let i = 0; i < geom.length; i++) {
                const [lon, lat] = geom[i];
                const kHi = `${lon.toFixed(COORD_PRECISION_HI)},${lat.toFixed(COORD_PRECISION_HI)}`;
                const kLo = `${lon.toFixed(COORD_PRECISION_LO)},${lat.toFixed(COORD_PRECISION_LO)}`;
                const code = byCoordHi.get(kHi) || byCoordLo.get(kLo);

                if (i > 0) {
                    hopKm.push(haversineKm(
                        { lon: geom[i - 1][0], lat: geom[i - 1][1] },
                        { lon, lat }
                    ));
                }
                if (!code) continue;

                const arcSinceLast = hopKm.reduce((sum, km) => sum + km, 0);
                hopKm.length = 0;

                if (chain.length && chain[chain.length - 1].code === code) {
                    // Consecutive duplicate (station repeated in polyline): merge arcs
                    chain[chain.length - 1].arc += arcSinceLast;
                    continue;
                }
                chain.push({ code, arc: arcSinceLast });
            }

            if (chain.length < 2) {
                trainsSkipped++;
                continue;
            }

            let totalArc = 0;
            for (let i = 1; i < chain.length; i++) totalArc += chain[i].arc;
            if (totalArc <= 0) {
                trainsSkipped++;
                continue;
            }

            // PHYSICAL GUARD: a published total that implies the track is
            // shorter than the straight-line chain (scale < ~1) or wildly
            // longer is corrupt — discard the whole train rather than let it
            // poison the consensus with impossible estimates.
            const scale = publishedKm / totalArc;
            if (!Number.isFinite(scale) || scale < MIN_SCALE || scale > MAX_SCALE) {
                trainsSkipped++;
                continue;
            }

            for (let i = 1; i < chain.length; i++) {
                const arc = chain[i].arc;
                if (arc <= 1e-9) continue;
                const estimate = arc * scale;
                if (estimate > arc * MAX_SCALE) continue;

                const from = chain[i - 1].code;
                const to = chain[i].code;
                const key = from < to ? `${from}|${to}` : `${to}|${from}`;
                let bucket = samples.get(key);
                if (!bucket) {
                    bucket = [];
                    samples.set(key, bucket);
                }
                bucket.push(estimate);
                samplesTotal++;
            }
            trainsUsed++;
        }
        console.log(`   → ${trainsUsed} trains used (${trainsSkipped} skipped), ${samplesTotal} samples across ${samples.size} unique segments`);

        // 3. Consensus (median) segment distances with the straight-line floor
        console.log('📐 Computing consensus segment distances...');
        const undirected = [];
        let rejectedByShape = 0;
        for (const [key, bucket] of samples.entries()) {
            const [a, b] = key.split('|');
            const midpoint = median(bucket);
            const straight = coords[a] && coords[b] ? haversineKm(coords[a], coords[b]) : 0;

            let km = Math.round(midpoint);
            if (straight > 0) {
                if (km > straight * MAX_SCALE) {
                    rejectedByShape++;
                    continue;
                }
                // PHYSICAL FLOOR: rail track is never shorter than the chord.
                km = Math.max(km, Math.round(straight));
            }
            if (km < 1) km = 1;
            if (km > MAX_EDGE_KM) continue;

            undirected.push({ a, b, km });
        }
        console.log(`   → ${undirected.length} consensus segments (${rejectedByShape} rejected as implausible)`);

        // 3b. Drop non-stop express jumps unless they are the sole connection.
        // A hop is only removed when its endpoints remain reachable without it,
        // so a long edge that happens to be a bridge never orphans a station.
        const degree = new Map();
        const undirectedAdj = new Map();
        const linkUndirected = (x, y) => {
            if (!undirectedAdj.has(x)) undirectedAdj.set(x, new Set());
            undirectedAdj.get(x).add(y);
        };
        for (const { a, b } of undirected) {
            degree.set(a, (degree.get(a) || 0) + 1);
            degree.set(b, (degree.get(b) || 0) + 1);
            linkUndirected(a, b);
            linkUndirected(b, a);
        }
        const reachesWithout = (a, b) => {
            const seen = new Set([a]);
            const queue = [a];
            while (queue.length) {
                const u = queue.pop();
                for (const v of undirectedAdj.get(u) || []) {
                    if ((u === a && v === b) || (u === b && v === a)) continue;
                    if (!seen.has(v)) {
                        seen.add(v);
                        queue.push(v);
                    }
                }
            }
            return seen.has(b);
        };
        const keptEdges = [];
        let longHopsDropped = 0;
        for (const edge of undirected) {
            if (
                edge.km > LONG_HOP_KM &&
                (degree.get(edge.a) || 0) > 1 &&
                (degree.get(edge.b) || 0) > 1 &&
                reachesWithout(edge.a, edge.b)
            ) {
                longHopsDropped++;
                continue;
            }
            keptEdges.push(edge);
        }
        console.log(`   → ${longHopsDropped} long non-stop hops dropped`);

        // 4. Build adjacency list & (optional) prune shortcut edges
        console.log('🧹 Building graph...');
        const rawEdges = {};
        const addEdge = (from, to, km) => {
            if (!rawEdges[from]) rawEdges[from] = [];
            rawEdges[from].push({ to, km });
        };
        for (const { a, b, km } of keptEdges) {
            addEdge(a, b, km);
            addEdge(b, a, km);
        }

        const cleanEdges = {};
        let pruned = 0;
        for (const from of Object.keys(rawEdges)) {
            cleanEdges[from] = [];
            const neighbors = rawEdges[from];

            for (const edge of neighbors) {
                const { to, km } = edge;
                let isExpressJump = false;

                for (const midEdge of neighbors) {
                    const mid = midEdge.to;
                    if (mid === to) continue;
                    const midToTarget = rawEdges[mid]?.find((candidate) => candidate.to === to)?.km;
                    if (midToTarget !== undefined) {
                        if (Math.abs(midEdge.km + midToTarget - km) <= PRUNE_TOLERANCE_KM) {
                            isExpressJump = true;
                            break;
                        }
                    }
                }

                if (!isExpressJump) {
                    cleanEdges[from].push({ to, km });
                } else {
                    pruned++;
                }
            }

            // Auto-detect Junctions (3+ track branches)
            if (cleanEdges[from].length >= 3 && stations[from]) {
                stations[from].isJunction = true;
            }
        }
        console.log(`   → ${pruned} shortcut edges pruned`);

        // 5. Save Final Minified JSON
        const finalGraph = {
            metadata: {
                totalStations: Object.keys(stations).length,
                generatedAt: new Date().toISOString()
            },
            stations,
            edges: cleanEdges
        };

        fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
        fs.writeFileSync(OUTPUT_PATH, JSON.stringify(finalGraph));

        const fileSizeMB = (fs.statSync(OUTPUT_PATH).size / (1024 * 1024)).toFixed(2);
        const junctions = Object.values(stations).filter(s => s.isJunction).length;
        console.log(`✅ SUCCESS! railway-graph.json generated at: ${OUTPUT_PATH}`);
        console.log(`📊 Stations: ${Object.keys(stations).length} | Junctions: ${junctions} | Edges: ${Object.values(cleanEdges).reduce((n, e) => n + e.length, 0)} | Size: ${fileSizeMB} MB`);

    } catch (error) {
        console.error('❌ Error generating railway graph:', error);
        process.exit(1);
    }
}

generateRailwayGraph();
