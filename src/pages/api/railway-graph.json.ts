import type { APIRoute } from 'astro';
import graph from '../../data/railway-graph.json';

export const prerender = true;

// Prerendered at build time from the same JSON the SSG pages import, so the
// client always fetches one cached copy of the railway graph.
export const GET: APIRoute = () => {
	return new Response(JSON.stringify(graph), {
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
		},
	});
};
