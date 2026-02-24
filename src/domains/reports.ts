/**
 * Reports domain tools for Xero MCP Server
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../utils/client.js";

/**
 * Report domain tool definitions
 */
export const reportTools: Tool[] = [
  {
    name: "xero_reports_profit_and_loss",
    description:
      "Get a Profit and Loss (income statement) report for a date range.",
    inputSchema: {
      type: "object",
      properties: {
        fromDate: {
          type: "string",
          description: "Start date in YYYY-MM-DD format (required)",
        },
        toDate: {
          type: "string",
          description: "End date in YYYY-MM-DD format (required)",
        },
      },
      required: ["fromDate", "toDate"],
    },
  },
  {
    name: "xero_reports_balance_sheet",
    description: "Get a Balance Sheet report as of a specific date.",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Report date in YYYY-MM-DD format (required)",
        },
      },
      required: ["date"],
    },
  },
  {
    name: "xero_reports_aged_receivables",
    description:
      "Get an Aged Receivables report showing outstanding customer invoices by age.",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Report date in YYYY-MM-DD format (required)",
        },
      },
      required: ["date"],
    },
  },
  {
    name: "xero_reports_aged_payables",
    description:
      "Get an Aged Payables report showing outstanding supplier bills by age.",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Report date in YYYY-MM-DD format (required)",
        },
      },
      required: ["date"],
    },
  },
];

/**
 * Handle report domain tool calls
 */
export async function handleReportTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  const client = getClient();

  switch (name) {
    case "xero_reports_profit_and_loss": {
      const { fromDate, toDate } = args as {
        fromDate: string;
        toDate: string;
      };
      const response = await client.get("Reports/ProfitAndLoss", {
        fromDate,
        toDate,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    case "xero_reports_balance_sheet": {
      const { date } = args as { date: string };
      const response = await client.get("Reports/BalanceSheet", { date });
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    case "xero_reports_aged_receivables": {
      const { date } = args as { date: string };
      const response = await client.get("Reports/AgedReceivablesByContact", {
        date,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    case "xero_reports_aged_payables": {
      const { date } = args as { date: string };
      const response = await client.get("Reports/AgedPayablesByContact", {
        date,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown report tool: ${name}` }],
        isError: true,
      };
  }
}
