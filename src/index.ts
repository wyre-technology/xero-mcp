#!/usr/bin/env node
/**
 * Xero MCP Server
 *
 * This MCP server provides tools for interacting with the Xero Accounting API.
 * It implements a decision tree architecture where tools are dynamically
 * loaded based on the selected domain.
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
import { resetClient } from "./utils/client.js";

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
 * Server state management
 */
interface ServerState {
  currentDomain: Domain | null;
}

const state: ServerState = {
  currentDomain: null,
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
 * Navigation tool - entry point for decision tree
 */
const navigateTool: Tool = {
  name: "xero_navigate",
  description:
    "Navigate to a specific domain in Xero. Call this first to select which area you want to work with. After navigation, domain-specific tools will be available.",
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
        description: `The domain to navigate to:
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
 * Back navigation tool - return to domain selection
 */
const backTool: Tool = {
  name: "xero_back",
  description:
    "Return to domain selection. Use this to switch to a different area of Xero.",
  inputSchema: {
    type: "object",
    properties: {},
  },
};

/**
 * Create the MCP server
 */
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

/**
 * Handle ListTools requests - returns tools based on current state
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools: Tool[] = [];

  if (state.currentDomain === null) {
    // At root - show navigation tool only
    tools.push(navigateTool);
  } else {
    // In a domain - show domain tools plus back navigation
    tools.push(backTool);
    tools.push(...getDomainTools(state.currentDomain));
  }

  return { tools };
});

/**
 * Handle CallTool requests
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Handle navigation
    if (name === "xero_navigate") {
      const { domain } = args as { domain: Domain };
      state.currentDomain = domain;

      const domainTools = getDomainTools(domain);
      const toolNames = domainTools.map((t) => t.name).join(", ");

      return {
        content: [
          {
            type: "text",
            text: `Navigated to ${domain} domain. Available tools: ${toolNames}`,
          },
        ],
      };
    }

    // Handle back navigation
    if (name === "xero_back") {
      state.currentDomain = null;
      return {
        content: [
          {
            type: "text",
            text: "Returned to domain selection. Use xero_navigate to select a domain: contacts, invoices, payments, accounts, reports",
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
          text: `Unknown tool: ${name}. Use xero_navigate to select a domain first.`,
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

/**
 * Start the server with stdio transport (default)
 */
async function startStdioTransport(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Xero MCP server running on stdio");
}

/**
 * Start the server with HTTP Streamable transport
 * In gateway mode, credentials are extracted from request headers on each request
 */
async function startHttpTransport(): Promise<void> {
  const port = parseInt(process.env.MCP_HTTP_PORT || "8080", 10);
  const host = process.env.MCP_HTTP_HOST || "0.0.0.0";
  const authMode = (process.env.AUTH_MODE as AuthMode) || "env";
  const isGatewayMode = authMode === "gateway";

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
  });

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
        // In gateway mode, extract credentials from headers
        if (isGatewayMode) {
          const accessToken = req.headers["x-xero-access-token"] as
            | string
            | undefined;
          const tenantId = req.headers["x-xero-tenant-id"] as
            | string
            | undefined;

          if (!accessToken || !tenantId) {
            console.error(
              "Gateway mode: Missing X-Xero-Access-Token or X-Xero-Tenant-Id header"
            );
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

          // Reset client so next getClient() picks up the new credentials
          resetClient();
          process.env.XERO_ACCESS_TOKEN = accessToken;
          process.env.XERO_TENANT_ID = tenantId;
        }

        transport.handleRequest(req, res);
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

  await server.connect(transport);

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
    await server.close();
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
