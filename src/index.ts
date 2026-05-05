#!/usr/bin/env node
/**
 * Xero MCP Server
 *
 * This MCP server provides tools for interacting with the Xero Accounting API.
 * All tools are listed upfront so they work with every MCP client, including
 * remote connectors (claude.ai, mcp-remote) that do not support dynamic
 * tool-list changes. A helper `xero_navigate` tool provides domain
 * discovery and guidance.
 *
 * Supports both stdio and HTTP (StreamableHTTP) transports.
 * Authentication:
 *   - Gateway mode: Read X-Xero-Access-Token and X-Xero-Tenant-Id headers
 *   - Env mode: Read XERO_ACCESS_TOKEN and XERO_TENANT_ID environment variables
 * Rate Limit: 60 requests/minute, 5000/day
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

// Domain imports
import { contactTools, handleContactTool } from "./domains/contacts.js";
import { invoiceTools, handleInvoiceTool } from "./domains/invoices.js";
import { paymentTools, handlePaymentTool } from "./domains/payments.js";
import { accountTools, handleAccountTool } from "./domains/accounts.js";
import { reportTools, handleReportTool } from "./domains/reports.js";
import { credentialStore } from "./utils/client.js";
import { setServerRef } from "./utils/server-ref.js";

/**
 * Transport and auth configuration types
 */
type TransportType = "stdio" | "http";
type AuthMode = "env" | "gateway";

/**
 * Available domains for navigation
 */
type Domain =
  | "contacts"
  | "invoices"
  | "payments"
  | "accounts"
  | "reports";

/**
 * Domain metadata for navigation
 */
const domainDescriptions: Record<Domain, string> = {
  contacts:
    "Contact management - list, get, create, and search contacts (customers and suppliers)",
  invoices:
    "Invoice management - list, get, create invoices and update their status",
  payments:
    "Payment management - list, get, and create payments against invoices",
  accounts:
    "Chart of accounts - list and view account details by type and class",
  reports:
    "Financial reports - profit & loss, balance sheet, aged receivables, and aged payables",
};

/**
 * Get tools for a specific domain
 */
function getDomainTools(domain: Domain): Tool[] {
  switch (domain) {
    case "contacts":
      return contactTools;
    case "invoices":
      return invoiceTools;
    case "payments":
      return paymentTools;
    case "accounts":
      return accountTools;
    case "reports":
      return reportTools;
  }
}

/**
 * All domain tools, collected once at startup
 */
let allDomainTools: Tool[] | null = null;

/**
 * Load all domain tools (lazy-loaded on first access)
 */
function getAllDomainTools(): Tool[] {
  if (allDomainTools !== null) {
    return allDomainTools;
  }

  const domains: Domain[] = ["contacts", "invoices", "payments", "accounts", "reports"];
  const tools: Tool[] = [];

  for (const domain of domains) {
    tools.push(...getDomainTools(domain));
  }

  allDomainTools = tools;
  return tools;
}

/**
 * Navigation / discovery tool - helps the LLM find the right tools
 *
 * This is a stateless helper that describes available tools for a domain.
 * All domain tools are always listed in tools/list regardless of navigation
 * state, because many MCP clients (claude.ai connectors, mcp-remote) only
 * fetch the tool list once and do not support notifications/tools/list_changed.
 */
const navigateTool: Tool = {
  name: "xero_navigate",
  description:
    "Discover available Xero tools by domain. Returns tool names and descriptions for the selected domain. All tools are callable at any time — this is a help/discovery aid, not a prerequisite.",
  inputSchema: {
    type: "object",
    properties: {
      domain: {
        type: "string",
        enum: [
          "contacts",
          "invoices",
          "payments",
          "accounts",
          "reports",
        ],
        description: `The domain to explore:
- contacts: ${domainDescriptions.contacts}
- invoices: ${domainDescriptions.invoices}
- payments: ${domainDescriptions.payments}
- accounts: ${domainDescriptions.accounts}
- reports: ${domainDescriptions.reports}`,
      },
    },
    required: ["domain"],
  },
};

/**
 * Status tool - shows credentials status and available domains
 */
const statusTool: Tool = {
  name: "xero_status",
  description: "Show credentials status and available domains",
  inputSchema: {
    type: "object",
    properties: {},
  },
};

/**
 * Back navigation tool - for compatibility (no-op)
 */
const backTool: Tool = {
  name: "xero_back",
  description:
    "Return to domain selection (no-op in flattened mode). All tools are always available.",
  inputSchema: {
    type: "object",
    properties: {},
  },
};

/**
 * Create a fresh MCP server instance with all handlers registered.
 * Called once for stdio, or per-request for HTTP transport.
 */
function createMcpServer(): Server {
  const server = new Server(
    {
      name: "xero-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  setServerRef(server);

  /**
   * Handle ListTools requests - always returns ALL tools
   */
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const domainTools = getAllDomainTools();
    return { tools: [navigateTool, statusTool, backTool, ...domainTools] };
  });

  /**
   * Handle CallTool requests
   */
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      // Handle navigation / discovery helper
      if (name === "xero_navigate") {
        const { domain } = args as { domain: Domain };

        const domainTools = getDomainTools(domain);
        const toolSummary = domainTools
          .map((t) => `- ${t.name}: ${t.description}`)
          .join("\n");

        return {
          content: [
            {
              type: "text",
              text: `${domainDescriptions[domain]}\n\nAvailable tools:\n${toolSummary}\n\nYou can call any of these tools directly.`,
            },
          ],
        };
      }

      if (name === "xero_status") {
        const credStatus = process.env.XERO_ACCESS_TOKEN
          ? `Configured (tenant: ${process.env.XERO_TENANT_ID || "env-based"})`
          : "NOT CONFIGURED - Please set environment variables";

        return {
          content: [
            {
              type: "text",
              text: `Xero MCP Server Status\n\nCredentials: ${credStatus}\nAvailable domains: contacts, invoices, payments, accounts, reports\n\nAll tools are available at all times. Use xero_navigate to discover tools by domain.`,
            },
          ],
        };
      }

      if (name === "xero_back") {
        return {
          content: [
            {
              type: "text",
              text: "All tools are always available in flattened mode. Use xero_navigate to discover tools by domain: contacts, invoices, payments, accounts, reports",
            },
          ],
        };
      }

      // Route to appropriate domain handler
      const toolArgs = (args ?? {}) as Record<string, unknown>;

      if (name.startsWith("xero_contacts_")) {
        return await handleContactTool(name, toolArgs);
      }
      if (name.startsWith("xero_invoices_")) {
        return await handleInvoiceTool(name, toolArgs);
      }
      if (name.startsWith("xero_payments_")) {
        return await handlePaymentTool(name, toolArgs);
      }
      if (name.startsWith("xero_accounts_")) {
        return await handleAccountTool(name, toolArgs);
      }
      if (name.startsWith("xero_reports_")) {
        return await handleReportTool(name, toolArgs);
      }

      // Unknown tool
      return {
        content: [
          {
            type: "text",
            text: `Unknown tool: ${name}. Use xero_navigate to discover available tools by domain.`,
          },
        ],
        isError: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Start the server with stdio transport (default)
 */
async function startStdioTransport(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Xero MCP server running on stdio (flattened mode)");
}

/**
 * Start the server with HTTP Streamable transport.
 * Each request gets a fresh Server + Transport (stateless).
 */
async function startHttpTransport(): Promise<void> {
  const port = parseInt(process.env.MCP_HTTP_PORT || "8080", 10);
  const host = process.env.MCP_HTTP_HOST || "0.0.0.0";
  const authMode = (process.env.AUTH_MODE as AuthMode) || "env";
  const isGatewayMode = authMode === "gateway";

  const httpServer = createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(
        req.url || "/",
        `http://${req.headers.host || "localhost"}`
      );

      // Health endpoint - no auth required
      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            transport: "http",
            authMode: isGatewayMode ? "gateway" : "env",
            timestamp: new Date().toISOString(),
          })
        );
        return;
      }

      // MCP endpoint
      if (url.pathname === "/mcp") {
        // In gateway mode, extract credentials and bind them to the
        // request's async context — no process.env mutation.
        const handleMcp = () => {
          const server = createMcpServer();
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableJsonResponse: true,
          });

          res.on("close", () => {
            transport.close();
            server.close();
          });

          server.connect(transport).then(() => {
            transport.handleRequest(req, res);
          });
        };

        if (isGatewayMode) {
          const accessToken = req.headers["x-xero-access-token"] as
            | string
            | undefined;
          const tenantId = req.headers["x-xero-tenant-id"] as
            | string
            | undefined;

          if (!accessToken || !tenantId) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "Missing credentials",
                message:
                  "Gateway mode requires X-Xero-Access-Token and X-Xero-Tenant-Id headers",
                required: ["X-Xero-Access-Token", "X-Xero-Tenant-Id"],
              })
            );
            return;
          }
          credentialStore.run({ accessToken, tenantId }, handleMcp);
        } else {
          handleMcp();
        }
        return;
      }

      // 404 for everything else
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Not found",
          endpoints: ["/mcp", "/health"],
        })
      );
    }
  );

  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => {
      console.error(
        `Xero MCP server listening on http://${host}:${port}/mcp`
      );
      console.error(
        `Health check available at http://${host}:${port}/health`
      );
      console.error(
        `Authentication mode: ${isGatewayMode ? "gateway (header-based)" : "env (environment variables)"}`
      );
      resolve();
    });
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.error("Shutting down Xero MCP server...");
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/**
 * Main entry point - selects transport based on MCP_TRANSPORT env var
 */
async function main() {
  const transportType =
    (process.env.MCP_TRANSPORT as TransportType) || "stdio";

  if (transportType === "http") {
    await startHttpTransport();
  } else {
    await startStdioTransport();
  }
}

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

main().catch(console.error);
