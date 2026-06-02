/**
 * Shared MCP server factory for Xero.
 *
 * This module is **side-effect free** (importing it never starts a transport),
 * so it can be reused by every entrypoint:
 * - `index.ts`  — stdio + Node HTTP transport
 * - `worker.ts` — Cloudflare Workers (Web Standard) transport
 *
 * All tools are listed upfront (flat architecture) for universal MCP client
 * compatibility. Credentials are NOT baked into the server: every request
 * resolves them through the `credentialStore` AsyncLocalStorage (gateway
 * headers) or `process.env` (env mode), so a fresh server per request can
 * safely serve concurrent requests with different credentials.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
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
import { credentialStore, type XeroCredentials } from "./utils/client.js";
import { setServerRef } from "./utils/server-ref.js";

export type { XeroCredentials };
export { credentialStore };

/**
 * Available domains for navigation
 */
type Domain = "contacts" | "invoices" | "payments" | "accounts" | "reports";

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

  const domains: Domain[] = [
    "contacts",
    "invoices",
    "payments",
    "accounts",
    "reports",
  ];
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
        enum: ["contacts", "invoices", "payments", "accounts", "reports"],
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
 * Resolve per-request gateway credentials from a header accessor.
 *
 * Works with any transport: pass a getter that returns a (lowercased) header
 * value. Returns `{ creds }` on success, or `{ error }` when required headers
 * are missing.
 */
export function resolveGatewayCredentials(
  getHeader: (lowerName: string) => string | undefined,
): { creds?: XeroCredentials; error?: string } {
  const accessToken = getHeader("x-xero-access-token");
  const tenantId = getHeader("x-xero-tenant-id");

  if (!accessToken || !tenantId) {
    return {
      error:
        "Gateway mode requires X-Xero-Access-Token and X-Xero-Tenant-Id headers",
    };
  }

  return { creds: { accessToken, tenantId } };
}

/**
 * Create a fresh MCP server instance with all handlers registered.
 * Called once for stdio, or per-request for HTTP / Workers transports.
 *
 * The returned server is credential-agnostic — handlers read credentials at
 * call time from `credentialStore` (gateway) or `process.env` (env).
 */
export function createMcpServer(): Server {
  const server = new Server(
    {
      name: "xero-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
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
        const override = credentialStore.getStore();
        const accessToken = override?.accessToken ?? process.env.XERO_ACCESS_TOKEN;
        const tenantId = override?.tenantId ?? process.env.XERO_TENANT_ID;
        const credStatus = accessToken
          ? `Configured (tenant: ${tenantId || "env-based"})`
          : "NOT CONFIGURED - Please set credentials (env vars or gateway headers)";

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
