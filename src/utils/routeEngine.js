/**
 * RailKM — core routing engine.
 *
 * Graph shape (src/data/railway-graph.json):
 *   stations: { [code]: { name, zone, division, state, isJunction } }
 *   edges:    { [fromCode]: [{ to, km }, ...] }
 *
 * All distances are track kilometres. Uses a binary min-heap Dijkstra so the
 * whole 8,989-station / 17k-segment graph stays searchable in a few ms.
 */

/**
 * Legacy ⇄ current Indian Railways code groups. Every member has, at some
 * point, referred to the same physical station; whichever member the graph
 * actually contains wins. The first member is the code travellers should see.
 */
export const STATION_ALIAS_GROUPS = Object.freeze([
	Object.freeze(['VGLJ', 'JHS']), // Virangana Lakshmibai Jn — formerly Jhansi Jn
	Object.freeze(['PRYJ', 'ALD']), // Prayagraj Jn — formerly Allahabad Jn
	Object.freeze(['DDU', 'MGS']), // Deen Dayal Upadhyaya Jn — formerly Mughalsarai
	Object.freeze(['MMCT', 'BCT']), // Mumbai Central
	Object.freeze(['CSMT', 'CSTM', 'CST']), // Chhatrapati Shivaji Maharaj Terminus
	Object.freeze(['RKMP', 'HBJ']), // Rani Kamlapati — formerly Habibganj
	Object.freeze(['AYC', 'FD']), // Ayodhya Cantt — formerly Faizabad Jn
]);

/**
 * Modern "official" identity for stations the raw dataset still stores under a
 * legacy code (keyed here by that legacy code). `code` is what travellers
 * search for and what the UI shows; the legacy key is used only to reach the
 * graph node and its edges.
 */
export const STATION_IDENTITIES = Object.freeze({
	JHS: Object.freeze({ code: 'VGLJ', name: 'VIRANGANA LAKSHMIBAI JHANSI' }),
	CSTM: Object.freeze({ code: 'CSMT', name: 'CHHATRAPATI SHIVAJI MAHARAJ TERMINUS' }),
	ALD: Object.freeze({ code: 'PRYJ', name: 'PRAYAGRAJ JN' }),
	MGS: Object.freeze({ code: 'DDU', name: 'DEEN DAYAL UPADHYAYA JN' }),
	HBJ: Object.freeze({ code: 'RKMP', name: 'RANI KAMLAPATI' }),
	FD: Object.freeze({ code: 'AYC', name: 'AYODHYA CANTT' }),
	BCT: Object.freeze({ code: 'MMCT', name: 'MUMBAI CENTRAL' }),
	MUV: Object.freeze({ code: 'BSBS', name: 'BANARAS' }),
});

/**
 * Legacy alias map for renamed Indian Railways stations. Keys are the old
 * codes and old names travellers still type; values are the current official
 * code. These outrank every other match so entering a legacy token (even one
 * that collides with an unrelated station code, e.g. `VT`) returns the current
 * official station first.
 */
export const LEGACY_ALIASES = Object.freeze({
	JHS: 'VGLJ', JHANSI: 'VGLJ',
	MGS: 'DDU', MUGHALSARAI: 'DDU',
	ALD: 'PRYJ', ALLAHABAD: 'PRYJ',
	BCT: 'MMCT', BOMBAY: 'MMCT',
	HBJ: 'RKMP', HABIBGANJ: 'RKMP',
	MUV: 'BSBS', MANDUADIH: 'BSBS',
	FD: 'AYC', FAIZABAD: 'AYC',
	CSTM: 'CSMT', VT: 'CSMT',
});

/**
 * Alias dictionary for commonly searched codes, historical spellings and
 * colloquial city names. Keys are upper-cased and matched against raw input;
 * values are the code travellers should see (resolved onto a graph node via
 * STATION_IDENTITIES / STATION_ALIAS_GROUPS when the graph uses a legacy code).
 */
export const STATION_ALIASES = Object.freeze({
	// — renamed / re-coded stations (old code or old name → official code) —
	...LEGACY_ALIASES,
	VGLJ: 'VGLJ', CSMT: 'CSMT', CST: 'CSMT', PRYJ: 'PRYJ', DDU: 'DDU',
	RKMP: 'RKMP', AYC: 'AYC', MMCT: 'MMCT',
	// — historical city names & spellings → station code —
	CAWNPORE: 'CNB',
	KANPUR: 'CNB',
	BENARES: 'BSB',
	BANARAS: 'BSB',
	VARANASI: 'BSB',
	POONA: 'PUNE',
	NASIK: 'NK',
	MADRAS: 'MAS',
	BANGALORE: 'SBC',
	BANGLORE: 'SBC',
	BENGALURU: 'SBC',
	MYSORE: 'MYS',
	MYSURU: 'MYS',
	MANGALORE: 'MAQ',
	MANGALURU: 'MAQ',
	BELGAUM: 'BGM',
	BELAGAVI: 'BGM',
	HUBLI: 'UBL',
	HUBBALLI: 'UBL',
	GULBARGA: 'GR',
	KALABURAGI: 'GR',
	SHIMOGA: 'SME',
	SHIVAMOGGA: 'SME',
	ERNAKULAM: 'ERS',
	TRICHUR: 'TCR',
	THRISSUR: 'TCR',
	QUILON: 'QLN',
	KOLLAM: 'QLN',
	ALLEPPEY: 'ALLP',
	ALAPPUZHA: 'ALLP',
	TRIVANDRUM: 'TVC',
	THIRUVANANTHAPURAM: 'TVC',
	CANNANORE: 'CAN',
	KANNUR: 'CAN',
	CALICUT: 'CLT',
	KOZHIKODE: 'CLT',
	TRICHY: 'TPJ',
	TIRUCHIRAPALLI: 'TPJ',
	TUTICORIN: 'TN',
	THOOTHUKUDI: 'TN',
	PONDICHERRY: 'PDY',
	PUDUCHERRY: 'PDY',
	WALTAIR: 'VSKP',
	VISAKHAPATNAM: 'VSKP',
	BEZWADA: 'BZA',
	VIJAYAWADA: 'BZA',
	CUDDAPAH: 'HX',
	BELLARY: 'BAY',
	BALLARI: 'BAY',
	SIMLA: 'SML',
	BARODA: 'BRC',
	VADODARA: 'BRC',
	SECUNDERABAD: 'SC',
	GORAKHPUR: 'GKP',
	ITARSI: 'ET',
	BHUSAVAL: 'BSL',
	BHUSAWAL: 'BSL',
	SHOLAPUR: 'SUR',
	SOLAPUR: 'SUR',
	KOLHAPUR: 'KOP',
	JUBBULPORE: 'JBP',
	JABALPUR: 'JBP',
});

const ALIAS_GROUPS_BY_CODE = new Map();
for (const group of STATION_ALIAS_GROUPS) {
	for (const code of group) ALIAS_GROUPS_BY_CODE.set(code, group);
}

// graph storage code → official identity, and the reverse official code → key.
const IDENTITY_BY_GRAPH = new Map(Object.entries(STATION_IDENTITIES));
const IDENTITY_BY_OFFICIAL = new Map();
for (const [graphKey, identity] of IDENTITY_BY_GRAPH) {
	IDENTITY_BY_OFFICIAL.set(identity.code, graphKey);
}

// official code → every alias token that should surface that station.
const ALIAS_TOKENS_BY_OFFICIAL = new Map();
const registerAliasToken = (token, official) => {
	const key = String(token).toUpperCase();
	const set = ALIAS_TOKENS_BY_OFFICIAL.get(official) || new Set();
	set.add(key);
	ALIAS_TOKENS_BY_OFFICIAL.set(official, set);
};
for (const group of STATION_ALIAS_GROUPS) {
	for (const member of group) registerAliasToken(member, group[0]);
}
for (const [token, official] of Object.entries(STATION_ALIASES)) {
	registerAliasToken(token, official);
}

const MATCH_TYPES = [
	'legacy-alias',
	'exact-code',
	'alias-code',
	'prefix-code',
	'exact-name',
	'prefix-name',
	'contains-name',
];

/** Operational/non-passenger halts that must never outrank a real station. */
const OPERATIONAL_HALT_RE = /\b(?:CABIN|BLOCK|YARD|SIDING|HUT|OUTER)\b/i;

/** Major junction markers that lift a station above comparable matches. */
const MAJOR_JUNCTION_RE = /\b(?:JN|TERMINUS|CENTRAL|CANTT)\b/i;

/** Binary min-heap with flat typed-array storage; pop() exposes the popped
 *  pair through `poppedNode` / `poppedDist` to avoid allocating result objects. */
export class MinHeap {
	constructor(capacity = 1024) {
		this._dist = new Float64Array(capacity);
		this._node = new Array(capacity);
		this._size = 0;
		this.poppedNode = null;
		this.poppedDist = 0;
	}

	get size() {
		return this._size;
	}

	push(node, dist) {
		if (this._size === this._node.length) this._grow();
		let i = this._size++;
		this._node[i] = node;
		this._dist[i] = dist;
		while (i > 0) {
			const parent = (i - 1) >> 1;
			if (this._dist[parent] <= this._dist[i]) break;
			this._swap(i, parent);
			i = parent;
		}
	}

	pop() {
		if (this._size === 0) {
			this.poppedNode = null;
			this.poppedDist = 0;
			return null;
		}
		const node = this._node[0];
		const dist = this._dist[0];
		const last = --this._size;
		this._node[0] = this._node[last];
		this._dist[0] = this._dist[last];
		let i = 0;
		while (true) {
			const left = i * 2 + 1;
			if (left >= this._size) break;
			const right = left + 1;
			const smallest =
				right < this._size && this._dist[right] < this._dist[left] ? right : left;
			if (this._dist[i] <= this._dist[smallest]) break;
			this._swap(i, smallest);
			i = smallest;
		}
		this.poppedNode = node;
		this.poppedDist = dist;
		return node;
	}

	_swap(a, b) {
		const n = this._node[a];
		this._node[a] = this._node[b];
		this._node[b] = n;
		const d = this._dist[a];
		this._dist[a] = this._dist[b];
		this._dist[b] = d;
	}

	_grow() {
		const nextDist = new Float64Array(this._dist.length * 2);
		nextDist.set(this._dist);
		this._dist = nextDist;
		this._node.length *= 2;
	}
}

/** Graph storage key for a code, tolerating official ⇄ legacy differences. */
function graphKeyFor(graph, code) {
	if (!graph?.stations || !code) return null;
	const upper = String(code).toUpperCase();
	if (graph.stations[upper]) return upper;
	const graphKey = IDENTITY_BY_OFFICIAL.get(upper);
	if (graphKey && graph.stations[graphKey]) return graphKey;
	return null;
}

const officialCodeForGraphKey = (graphKey) => IDENTITY_BY_GRAPH.get(graphKey)?.code || graphKey;

const officialNameForGraphKey = (graphKey, node) =>
	IDENTITY_BY_GRAPH.get(graphKey)?.name || node?.name || graphKey;

const nameOf = (graph, code) => {
	const key = graphKeyFor(graph, code);
	return key ? officialNameForGraphKey(key, graph.stations[key]) : code;
};

const isJunctionOf = (graph, code) => {
	const key = graphKeyFor(graph, code);
	return !!(key && graph.stations[key]?.isJunction);
};

/** Public, display-ready view of a station (official code + name + metadata). */
export function stationInfo(graph, code) {
	const key = graphKeyFor(graph, code);
	if (!key) return null;
	const node = graph.stations[key];
	const identity = IDENTITY_BY_GRAPH.get(key);
	return {
		code: identity ? identity.code : key,
		name: identity ? identity.name : node.name || key,
		zone: node.zone,
		division: node.division,
		state: node.state,
		isJunction: !!node.isJunction,
		legacyCode: identity ? key : undefined,
	};
}

function officialStation(graph, graphKey, matchedVia, matchedInput) {
	const node = graph.stations[graphKey];
	const identity = IDENTITY_BY_GRAPH.get(graphKey);
	return {
		code: identity ? identity.code : graphKey,
		graphCode: graphKey,
		name: identity ? identity.name : node.name || graphKey,
		matchedVia,
		...(matchedInput ? { matchedInput } : {}),
	};
}

/**
 * Shortest track path between two station codes.
 * Returns { path: [code], links: [{ from, to, km }], distanceKm } or null.
 */
export function shortestPath(graph, from, to) {
	const start = graphKeyFor(graph, from);
	const goal = graphKeyFor(graph, to);
	if (!start || !goal) return null;
	if (start === goal) {
		return { path: [officialCodeForGraphKey(start)], links: [], distanceKm: 0 };
	}

	const edges = graph.edges;
	const dist = new Map();
	const prev = new Map();
	const settled = new Set();
	const heap = new MinHeap(1024);

	dist.set(start, 0);
	heap.push(start, 0);

	while (heap.size > 0) {
		heap.pop();
		const u = heap.poppedNode;
		const d = heap.poppedDist;
		if (settled.has(u)) continue;
		settled.add(u);
		if (u === goal) break;

		const neighbors = edges[u];
		if (!neighbors) continue;
		for (let i = 0; i < neighbors.length; i++) {
			const edge = neighbors[i];
			if (settled.has(edge.to)) continue;
			const nextDist = d + edge.km;
			const known = dist.get(edge.to);
			if (known === undefined || nextDist < known) {
				dist.set(edge.to, nextDist);
				prev.set(edge.to, { from: u, to: edge.to, km: edge.km });
				heap.push(edge.to, nextDist);
			}
		}
	}

	if (!dist.has(goal)) return null;

	const path = [];
	const links = [];
	let cursor = goal;
	while (cursor !== start) {
		const link = prev.get(cursor);
		links.push({
			from: officialCodeForGraphKey(link.from),
			to: officialCodeForGraphKey(link.to),
			km: link.km,
		});
		path.push(officialCodeForGraphKey(cursor));
		cursor = link.from;
	}
	path.push(officialCodeForGraphKey(start));
	path.reverse();
	links.reverse();

	return { path, links, distanceKm: dist.get(goal) };
}

/** Resolve user input (code, alias or exact name) to a graph station. */
export function resolveStation(graph, input) {
	if (!input || typeof input !== 'string' || !graph?.stations) return null;
	const raw = input.trim();
	if (!raw) return null;

	const upper = raw.toUpperCase();
	const lower = raw.toLowerCase();

	// 1. direct hit on a graph code (legacy codes still stored in the data).
	if (graph.stations[upper]) return officialStation(graph, upper, 'code');

	// 2. alias dictionary → official code → graph node.
	const aliasTarget = STATION_ALIASES[upper];
	if (aliasTarget) {
		const key = graphKeyFor(graph, aliasTarget);
		if (key) return officialStation(graph, key, 'alias', upper);
	}

	// 3. legacy ⇄ current alias group membership.
	const group = ALIAS_GROUPS_BY_CODE.get(upper);
	if (group) {
		for (const member of group) {
			if (graph.stations[member]) return officialStation(graph, member, 'alias', upper);
		}
	}

	// 4. exact station name (official or raw), which must be unambiguous.
	let foundKey = null;
	for (const key of Object.keys(graph.stations)) {
		const identity = IDENTITY_BY_GRAPH.get(key);
		const candidateNames = [graph.stations[key].name, identity && identity.name];
		if (!candidateNames.some((name) => (name || '').toLowerCase() === lower)) continue;
		if (foundKey && officialCodeForGraphKey(foundKey) !== officialCodeForGraphKey(key)) {
			return null; // ambiguous name
		}
		foundKey = key;
	}
	if (foundKey) return officialStation(graph, foundKey, 'name');
	return null;
}

const SEARCH_INDEX = new WeakMap();

function getSearchIndex(graph) {
	let index = SEARCH_INDEX.get(graph);
	if (index) return index;

	index = [];
	const stations = graph.stations || {};
	for (const graphKey of Object.keys(stations)) {
		const node = stations[graphKey];
		const code = officialCodeForGraphKey(graphKey);
		const name = officialNameForGraphKey(graphKey, node);
		index.push({
			code,
			graphCode: graphKey,
			name,
			nameLower: name.toLowerCase(),
			zone: node.zone || 'IR',
			state: node.state || '',
			isJunction: !!node.isJunction,
			aliasTokens: Array.from(ALIAS_TOKENS_BY_OFFICIAL.get(code) || []),
		});
	}
	SEARCH_INDEX.set(graph, index);
	return index;
}

/**
 * Fast station search. Priority: legacy alias (old code/name) → exact code →
 * alias code → code prefix → exact name → name prefix → name contains.
 * Ties break by a score that boosts major junctions (JN/TERMINUS/CENTRAL/CANTT)
 * and sinks operational halts (CABIN/BLOCK/YARD/SIDING/HUT/OUTER).
 * Returns up to `limit` matches.
 */
export function searchStations(graph, query, limit = 8) {
	const trimmed = (query || '').trim();
	if (!trimmed || !graph?.stations) return [];

	const upper = trimmed.toUpperCase();
	const lower = trimmed.toLowerCase();

	const legacyTarget = LEGACY_ALIASES[upper];

	const results = [];
	for (const entry of getSearchIndex(graph)) {
		let category = -1;
		let matchedAlias;
		if (legacyTarget && entry.code === legacyTarget) {
			category = 0;
			matchedAlias = upper;
		} else if (entry.code === upper) {
			category = 1;
		} else if (entry.aliasTokens.includes(upper)) {
			category = 2;
			matchedAlias = upper;
		} else if (entry.code.startsWith(upper)) {
			category = 3;
		} else if (entry.nameLower === lower) {
			category = 4;
		} else if (entry.nameLower.startsWith(lower)) {
			category = 5;
		} else if (entry.nameLower.includes(lower)) {
			category = 6;
		}
		if (category === -1) continue;

		const upperName = entry.name.toUpperCase();
		const operational = OPERATIONAL_HALT_RE.test(upperName);
		let score = operational ? -100 : 0;
		if (MAJOR_JUNCTION_RE.test(upperName)) score += 10;
		if (entry.isJunction) score += 5;

		results.push({
			code: entry.code,
			graphCode: entry.graphCode,
			name: entry.name,
			zone: entry.zone,
			state: entry.state,
			isJunction: entry.isJunction,
			aliases: entry.aliasTokens.filter((token) => token !== entry.code),
			matchedAlias,
			matchType: MATCH_TYPES[category],
			category,
			score,
		});
	}

	results.sort(
		(a, b) =>
			a.category - b.category ||
			b.score - a.score ||
			a.code.length - b.code.length ||
			(a.code < b.code ? -1 : a.code > b.code ? 1 : 0)
	);

	return results.slice(0, limit).map(({ category, score, ...rest }) => rest);
}

/**
 * Multi-via journey planner. `stationChain` is an ordered list of station
 * codes, e.g. ["NZM", "VGLJ", "BPL", "RTM", "JAO"]. Computes the shortest
 * track distance for every consecutive pair, the full intermediate station
 * list with cumulative kilometres, and flags any station visited more than
 * once across the whole journey (a double-back).
 */
export function calculateMultiViaRoute(graph, stationChain) {
	if (!graph?.stations || !graph?.edges) {
		return { ok: false, error: 'Invalid railway graph.' };
	}
	if (!Array.isArray(stationChain) || stationChain.length < 2) {
		return { ok: false, error: 'Provide at least two stations to map a route.' };
	}

	const resolvedChain = [];
	const warnings = [];
	for (const input of stationChain) {
		const resolved = resolveStation(graph, input);
		if (!resolved) {
			return {
				ok: false,
				error: `Station "${input}" was not found in the railway graph.`,
				unknownStation: input,
			};
		}
		if (resolved.matchedVia === 'alias') {
			warnings.push(
				`"${resolved.matchedInput}" resolved to ${resolved.code} (${resolved.name}) via a legacy/new code alias.`
			);
		} else if (resolved.matchedVia === 'name') {
			warnings.push(`"${input}" resolved to ${resolved.code} (${resolved.name}) by station name.`);
		}
		resolvedChain.push({ supplied: input, ...resolved });
	}

	const legs = [];
	for (let i = 0; i < resolvedChain.length - 1; i++) {
		const from = resolvedChain[i].code;
		const to = resolvedChain[i + 1].code;

		const result = shortestPath(graph, from, to);
		if (!result) {
			return {
				ok: false,
				error: `No continuous track route is available between ${from} (${nameOf(graph, from)}) and ${to} (${nameOf(graph, to)}).`,
				failedLeg: { from, to },
			};
		}
		if (from === to) {
			warnings.push(`Leg ${i + 1} starts and ends at ${from}; counted as a zero-distance halt.`);
		}

		const stations = [
			{ code: from, name: nameOf(graph, from), km: 0, isJunction: isJunctionOf(graph, from) },
		];
		let cumulative = 0;
		for (const link of result.links) {
			cumulative += link.km;
			stations.push({
				code: link.to,
				name: nameOf(graph, link.to),
				km: cumulative,
				isJunction: isJunctionOf(graph, link.to),
			});
		}

		legs.push({
			index: i,
			from,
			to,
			fromName: nameOf(graph, from),
			toName: nameOf(graph, to),
			distanceKm: result.distanceKm,
			stationCount: stations.length,
			stations,
		});
	}

	const stops = [];
	const visits = new Map();
	let offset = 0;
	legs.forEach((leg, legIndex) => {
		const points = leg.stations;
		const startAt = legIndex === 0 ? 0 : 1; // shared junction already reported by previous leg
		for (let j = startAt; j < points.length; j++) {
			const point = points[j];
			const km = offset + point.km;
			const isVia = j === 0 || j === points.length - 1;
			stops.push({
				code: point.code,
				name: point.name,
				km,
				isJunction: point.isJunction,
				legIndex,
				isVia,
			});

			const visit = visits.get(point.code);
			if (visit) {
				visit.visits += 1;
				visit.lastKm = km;
			} else {
				visits.set(point.code, {
					code: point.code,
					name: point.name,
					visits: 1,
					firstKm: km,
					lastKm: km,
				});
			}
		}
		offset += leg.distanceKm;
	});

	const doubleBackStations = [...visits.values()].filter((visit) => visit.visits > 1);

	return {
		ok: true,
		chain: resolvedChain.map((entry) => entry.code),
		resolvedChain,
		legs,
		legCount: legs.length,
		stops,
		stopCount: stops.length,
		uniqueStationCount: visits.size,
		totalDistanceKm: offset,
		doubleBack: doubleBackStations.length > 0,
		doubleBackStations,
		warnings,
	};
}

/* ------------------------------------------------------------------ Fares */

/**
 * Approximate standard Indian Railways passenger fares, by class.
 *
 * Modelled on the ordinary Express/Mail fare structure — a fixed base-fare
 * component plus a per-kilometre charge, with the standard reservation fee and
 * superfast surcharge folded into those two components. The result is rounded
 * to the nearest ₹5 (IR fares conventionally end in 0 or 5).
 *
 * Calibration check — a 278 km run (e.g. NDLS → JP):
 *   Sleeper ₹30 + 278×₹0.85 ≈ ₹265   ·   AC 3-Tier ₹250 + 278×₹2.20 ≈ ₹860
 *
 * These remain planning estimates only — real fares vary by train type,
 * distance slab, dynamic pricing and GST.
 */
const FARE_CLASSES = Object.freeze([
	Object.freeze({ code: 'SL', short: 'Sleeper', label: 'Sleeper (SL)', base: 30, rate: 0.85 }),
	Object.freeze({ code: '3AC', short: '3AC', label: 'AC 3-Tier (3AC)', base: 250, rate: 2.2 }),
	Object.freeze({ code: '2AC', short: '2AC', label: 'AC 2-Tier (2AC)', base: 350, rate: 3.2 }),
	Object.freeze({ code: '1AC', short: '1AC', label: 'AC First Class (1AC)', base: 600, rate: 5.5 }),
]);

const roundFare = (value) => Math.max(0, Math.round(value / 5) * 5);

/**
 * Estimate standard-class fares for a total track distance.
 * Returns [{ code, short, label, fare }] in ascending class order; every fare
 * is 0 when the distance is unknown or non-positive.
 */
export function estimateFares(totalKm) {
	const km = Number(totalKm);
	const distanceKm = Number.isFinite(km) && km > 0 ? km : 0;
	return FARE_CLASSES.map((cls) => {
		const fare = distanceKm > 0 ? roundFare(cls.base + distanceKm * cls.rate) : 0;
		return { code: cls.code, short: cls.short, label: cls.label, fare };
	});
}
