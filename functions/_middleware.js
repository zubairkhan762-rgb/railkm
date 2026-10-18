// Cloudflare Pages Function: permanently redirect the Pages preview host
// (railkm.pages.dev and any <hash>.railkm.pages.dev deployment) to the
// canonical custom domain, preserving path and query string.
//
// `_redirects` cannot match hostnames (Cloudflare lists domain-level redirects
// as unsupported), so this middleware is the supported way to do it in-repo.
export async function onRequest(context) {
	const url = new URL(context.request.url);
	const isPagesHost =
		url.hostname === 'railkm.pages.dev' || url.hostname.endsWith('.railkm.pages.dev');

	if (!isPagesHost) {
		return context.next();
	}

	url.protocol = 'https:';
	url.hostname = 'railkm.com';
	url.port = '';
	return Response.redirect(url.toString(), 301);
}
