/**
 * Accounts domain tools for Xero MCP Server
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../utils/client.js";

/**
 * Account domain tool definitions
 */
export const accountTools: Tool[] = [
  {
    name: "xero_accounts_list",
    description:
      "List chart of accounts in Xero. Optionally filter by account type or class.",
    inputSchema: {
      type: "object",
      properties: {
        Type: {
          type: "string",
          description:
            'Filter by account type (e.g., "BANK", "REVENUE", "EXPENSE", "CURRENT", "FIXED", "EQUITY", "CURRLIAB", "TERMLIAB", "DIRECTCOSTS", "OVERHEADS", "DEPRECIATN", "OTHERINCOME", "SALES")',
        },
        Class: {
          type: "string",
          enum: ["ASSET", "EQUITY", "EXPENSE", "LIABILITY", "REVENUE"],
          description: "Filter by account class",
        },
      },
    },
  },
  {
    name: "xero_accounts_get",
    description:
      "Get detailed information about a specific account by its ID.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: {
          type: "string",
          description: "The unique account ID (UUID)",
        },
      },
      required: ["accountId"],
    },
  },
];

/**
 * Handle account domain tool calls
 */
export async function handleAccountTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  const client = getClient();

  switch (name) {
    case "xero_accounts_list": {
      const { Type, Class } = args as {
        Type?: string;
        Class?: string;
      };
      const params: Record<string, string> = {};

      // Build where clause from filters
      const filters: string[] = [];
      if (Type) filters.push(`Type=="${Type}"`);
      if (Class) filters.push(`Class=="${Class}"`);
      if (filters.length > 0) params.where = filters.join(" AND ");

      const response = await client.get("Accounts", params);
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    case "xero_accounts_get": {
      const { accountId } = args as { accountId: string };
      const response = await client.get(`Accounts/${accountId}`);
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown account tool: ${name}` }],
        isError: true,
      };
  }
}
