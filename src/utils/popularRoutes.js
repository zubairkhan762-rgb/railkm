// src/utils/popularRoutes.js
//
// Source of truth for the programmatic SEO route directory. Each pair uses the
// station code travellers actually search for (e.g. MMCT rather than the
// legacy BCT in the raw dataset); resolveStation() maps it onto the code that
// exists in the railway graph.
//
// resolvePopularRoutePairs() is cheap (no routing) and feeds the sitemap and
// the homepage directory. buildPopularRoutes() additionally runs the routing
// engine and feeds the pre-rendered /distance/[slug] pages.

import graph from '../data/railway-graph.json';
import { calculateMultiViaRoute, resolveStation } from './routeEngine.js';

export const POPULAR_ROUTE_PAIRS = Object.freeze([
	// — From Delhi —
	['NDLS', 'MMCT'], ['NDLS', 'HWH'], ['NDLS', 'MAS'], ['NDLS', 'SBC'], ['NDLS', 'BPL'],
	['NDLS', 'PUNE'], ['NDLS', 'ADI'], ['NDLS', 'JP'], ['NDLS', 'LKO'], ['NDLS', 'PNBE'],
	['NDLS', 'BZA'], ['NDLS', 'SC'], ['NDLS', 'CBE'], ['NDLS', 'ERS'], ['NDLS', 'TVC'],
	['NDLS', 'GHY'], ['NDLS', 'BBS'], ['NDLS', 'RNC'], ['NDLS', 'JAT'], ['NDLS', 'ASR'],
	['NDLS', 'CDG'], ['NDLS', 'DDN'], ['NDLS', 'GWL'], ['NDLS', 'VGLJ'], ['NDLS', 'AGC'],
	['NDLS', 'JBP'], ['NDLS', 'NGP'], ['NDLS', 'BSB'], ['NDLS', 'AYC'], ['NDLS', 'KOTA'],
	['NDLS', 'RTM'], ['NDLS', 'UDZ'], ['NDLS', 'CNB'], ['NDLS', 'GKP'],
	// — From Hazrat Nizamuddin —
	['NZM', 'RTM'], ['NZM', 'BPL'], ['NZM', 'AGC'], ['NZM', 'KOTA'], ['NZM', 'JP'],
	['NZM', 'ADI'], ['NZM', 'MMCT'],
	// — From Mumbai Central —
	['MMCT', 'ADI'], ['MMCT', 'PUNE'], ['MMCT', 'SC'], ['MMCT', 'MAS'], ['MMCT', 'CBE'],
	['MMCT', 'ERS'], ['MMCT', 'HWH'], ['MMCT', 'JP'], ['MMCT', 'BRC'], ['MMCT', 'NDLS'],
	['MMCT', 'NGP'], ['MMCT', 'ST'], ['MMCT', 'BPL'],
	// — From CSMT —
	['CSMT', 'PUNE'], ['CSMT', 'NDLS'], ['CSMT', 'NGP'],
	// — From Chennai —
	['MAS', 'SBC'], ['MAS', 'CBE'], ['MAS', 'TVC'], ['MAS', 'ERS'], ['MAS', 'SC'],
	['MAS', 'BZA'], ['MAS', 'NDLS'], ['MAS', 'HWH'], ['MAS', 'PUNE'],
	// — From Howrah —
	['HWH', 'PNBE'], ['HWH', 'GHY'], ['HWH', 'BBS'], ['HWH', 'NDLS'], ['HWH', 'MAS'],
	['HWH', 'RNC'], ['HWH', 'BPL'],
	// — Cross-country —
	['JP', 'NDLS'], ['LKO', 'NDLS'], ['PNBE', 'NDLS'], ['SC', 'BZA'], ['VGLJ', 'BPL'],
	['RTM', 'JAO'], ['GKP', 'NDLS'], ['BPL', 'NGP'], ['AGC', 'GWL'], ['GWL', 'BPL'],
	['SUR', 'PUNE'], ['ADI', 'BRC'], ['PNBE', 'HWH'], ['BBS', 'HWH'], ['CNB', 'LKO'],
	['BPL', 'NDLS'], ['ADI', 'MMCT'], ['PUNE', 'CSMT'],
]);

const slugFor = (from, to) => `${from.toLowerCase()}-to-${to.toLowerCase()}`;

/** Resolve every pair to graph stations; no routing, so it stays cheap. */
export function resolvePopularRoutePairs() {
	const seen = new Set();
	const entries = [];

	for (const [from, to] of POPULAR_ROUTE_PAIRS) {
		const origin = resolveStation(graph, from);
		const destination = resolveStation(graph, to);
		if (!origin || !destination || origin.code === destination.code) continue;

		const slug = slugFor(from, to);
		if (seen.has(slug)) continue;
		seen.add(slug);

		entries.push({
			slug,
			from,
			to,
			fromCode: origin.code,
			toCode: destination.code,
			fromName: origin.name,
			toName: destination.name,
		});
	}

	return entries;
}

/** Resolved pairs plus the fully computed shortest-track route. */
export function buildPopularRoutes() {
	const routes = [];

	for (const pair of resolvePopularRoutePairs()) {
		const route = calculateMultiViaRoute(graph, [pair.fromCode, pair.toCode]);
		if (!route.ok) continue;
		routes.push({ ...pair, route });
	}

	return routes;
}
