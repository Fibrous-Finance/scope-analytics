import type { IncomingMessage, ServerResponse } from "node:http";

export type RouteHandler = (
	req: IncomingMessage,
	res: ServerResponse,
	params: Record<string, string>,
	query: Record<string, string>
) => void | Promise<void>;

interface Route {
	segments: string[];
	handler: RouteHandler;
}

export class Router {
	private routes: Route[] = [];

	// Register a GET route with optional :param segments
	get(pattern: string, handler: RouteHandler): void {
		const segments = pattern.split("/").filter((s) => s.length > 0);
		this.routes.push({ segments, handler });
	}

	// Attempt to handle an incoming request
	async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
		// Handle CORS preflight
		if (req.method === "OPTIONS") {
			setCorsHeaders(res);
			res.writeHead(204);
			res.end();
			return true;
		}

		if (req.method !== "GET") {
			return false;
		}

		const urlObj = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
		const pathname = urlObj.pathname;
		const query = parseQuery(urlObj.searchParams);
		const pathSegments = pathname.split("/").filter((s) => s.length > 0);

		for (const route of this.routes) {
			const params = matchRoute(route.segments, pathSegments);
			if (params !== null) {
				try {
					await route.handler(req, res, params, query);
				} catch (error) {
					console.error("[Router] Handler error:", error);
					sendJson(res, { error: "Internal Server Error" }, 500);
				}
				return true;
			}
		}

		return false;
	}
}

// Match route pattern against actual path segments
function matchRoute(pattern: string[], actual: string[]): Record<string, string> | null {
	if (pattern.length !== actual.length) return null;

	const params: Record<string, string> = {};

	for (let i = 0; i < pattern.length; i++) {
		const seg = pattern[i];
		const act = actual[i];
		if (!seg || !act) return null;
		if (seg.startsWith(":")) {
			params[seg.slice(1)] = act;
		} else if (seg !== act) {
			return null;
		}
	}

	return params;
}

function parseQuery(searchParams: URLSearchParams): Record<string, string> {
	const query: Record<string, string> = {};
	for (const [key, value] of searchParams.entries()) {
		query[key] = value;
	}
	return query;
}

export function setCorsHeaders(res: ServerResponse): void {
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export function sendJson(res: ServerResponse, data: unknown, status = 200): void {
	setCorsHeaders(res);
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(data, null, 2));
}
