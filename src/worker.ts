/**
 * Cloudflare Workers entry point for the Xero MCP Server.
 *
 * Serves the full MCP server over the Streamable HTTP transport using the SDK's
 * Web Standard transport (Request/Response), which runs natively on Workers.
 * It reuses the exact same `createMcpServer()` factory as the stdio / Node HTTP
 * entrypoints (see `mcp-server.ts`), so there is no second tool implementation
 * to maintain.
 *
 * Credentials are resolved per request and injected through the
 * `credentialStore` AsyncLocalStorage (supported on workerd with
 * `nodejs_compat`), so a fresh server per request can serve concurrent
 * requests with different credentials.
 *
 * 1. Gateway headers (when AUTH_MODE=gateway):
 *    - X-Xero-Access-Token
 *    - X-Xero-Tenant-Id
 * 2. Worker secrets / vars (env mode):
 *    - XERO_ACCESS_TOKEN
 *    - XERO_TENANT_ID
 *
 * `tools/list` and `initialize` work without credentials; only `tools/call`
 * requires them.
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  createMcpServer,
  resolveGatewayCredentials,
  credentialStore,
  type XeroCredentials,
} from "./mcp-server.js";

export interface Env {
  XERO_ACCESS_TOKEN?: string;
  XERO_TENANT_ID?: string;
  AUTH_MODE?: string;
  LOG_LEVEL?: string;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version, X-Xero-Access-Token, X-Xero-Tenant-Id",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Shallow, unauthenticated liveness probe.
    if (url.pathname === "/health" || url.pathname === "/healthz") {
      return json({ status: "ok" });
    }

    if (url.pathname === "/mcp") {
      const isGatewayMode = (env.AUTH_MODE ?? "env") === "gateway";

      let creds: XeroCredentials | undefined;
      if (isGatewayMode) {
        const { creds: gwCreds, error } = resolveGatewayCredentials(
          (name) => request.headers.get(name) ?? undefined,
        );
        if (error || !gwCreds) {
          return json(
            {
              error: "Missing credentials",
              message: error,
              required: ["X-Xero-Access-Token", "X-Xero-Tenant-Id"],
            },
            401,
          );
        }
        creds = gwCreds;
      } else if (env.XERO_ACCESS_TOKEN && env.XERO_TENANT_ID) {
        // env mode: build credentials from Worker secrets/vars if present.
        // (Absent creds are fine — tools/list still works, tools/call errors.)
        creds = {
          accessToken: env.XERO_ACCESS_TOKEN,
          tenantId: env.XERO_TENANT_ID,
        };
      }

      // Fresh server + transport per request (stateless).
      const server = createMcpServer();
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);

      const run = async (): Promise<Response> => {
        try {
          const response = await transport.handleRequest(request);
          return withCors(response);
        } finally {
          await transport.close();
          await server.close();
        }
      };

      // Inject per-request credentials via AsyncLocalStorage so getClient()
      // resolves them without mutating any global state.
      if (creds) {
        return credentialStore.run(creds, run);
      }
      return run();
    }

    return json({ error: "Not found", endpoints: ["/mcp", "/health"] }, 404);
  },
};
