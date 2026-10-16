import type { APIRoute } from 'astro';
import { buildPopularRoutes } from '../utils/popularRoutes.js';

export const prerender = true;

const escapeXml = (value: string) =>
	value.replace(/[<>&'"]/g, (char) => {
		switch (char) {
			case '<':
				return '&lt;';
			case '>':
				return '&gt;';
			case '&':
				return '&amp;';
			case "'":
				return '&apos;';
			default:
				return '&quot;';
		}
	});

export const GET: APIRoute = ({ site }) => {
	const base = site ?? new URL('https://railkm.com/');
	const lastmod = new Date().toISOString();

	const urls = [
		{ loc: new URL('/', base).href, lastmod, changefreq: 'weekly', priority: '1.0' },
		...buildPopularRoutes().map((entry) => ({
			loc: new URL(`/distance/${entry.slug}`, base).href,
			lastmod,
			changefreq: 'monthly',
			priority: '0.8',
		})),
		{ loc: new URL('/about', base).href, lastmod, changefreq: 'monthly', priority: '0.5' },
		{ loc: new URL('/contact', base).href, lastmod, changefreq: 'monthly', priority: '0.5' },
		{ loc: new URL('/privacy-policy', base).href, lastmod, changefreq: 'yearly', priority: '0.3' },
		{ loc: new URL('/terms', base).href, lastmod, changefreq: 'yearly', priority: '0.3' },
	];

	const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
	.map(
		(url) =>
			`\t<url>\n\t\t<loc>${escapeXml(url.loc)}</loc>\n\t\t<lastmod>${url.lastmod}</lastmod>\n\t\t<changefreq>${url.changefreq}</changefreq>\n\t\t<priority>${url.priority}</priority>\n\t</url>`
	)
	.join('\n')}
</urlset>
`;

	return new Response(body, {
		headers: {
			'Content-Type': 'application/xml; charset=utf-8',
			'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
		},
	});
};
