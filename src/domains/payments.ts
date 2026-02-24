/**
 * Payments domain tools for Xero MCP Server
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../utils/client.js";

/**
 * Payment domain tool definitions
 */
export const paymentTools: Tool[] = [
  {
    name: "xero_payments_list",
    description:
      "List payments in Xero with pagination. Optionally filter by status.",
    inputSchema: {
      type: "object",
      properties: {
        page: {
          type: "number",
          description: "Page number (1-based, default: 1). Each page returns up to 100 payments.",
        },
        Status: {
          type: "string",
          enum: ["AUTHORISED", "DELETED"],
          description: "Filter by payment status",
        },
      },
    },
  },
  {
    name: "xero_payments_get",
    description:
      "Get detailed information about a specific payment by its ID.",
    inputSchema: {
      type: "object",
      properties: {
        paymentId: {
          type: "string",
          description: "The unique payment ID (UUID)",
        },
      },
      required: ["paymentId"],
    },
  },
  {
    name: "xero_payments_create",
    description:
      "Create a new payment in Xero. Records a payment against an invoice.",
    inputSchema: {
      type: "object",
      properties: {
        InvoiceID: {
          type: "string",
          description: "The invoice ID to apply the payment to (required)",
        },
        AccountID: {
          type: "string",
          description: "The bank account ID the payment is made from/to (required)",
        },
        Amount: {
          type: "number",
          description: "Payment amount (required)",
        },
        Date: {
          type: "string",
          description: "Payment date in YYYY-MM-DD format (required)",
        },
        Reference: {
          type: "string",
          description: "Payment reference",
        },
      },
      required: ["InvoiceID", "AccountID", "Amount", "Date"],
    },
  },
];

/**
 * Handle payment domain tool calls
 */
export async function handlePaymentTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  const client = getClient();

  switch (name) {
    case "xero_payments_list": {
      const { page, Status } = args as {
        page?: number;
        Status?: string;
      };
      const params: Record<string, string> = {};
      if (page !== undefined) params.page = String(page);
      if (Status) params.where = `Status=="${Status}"`;

      const response = await client.get("Payments", params);
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    case "xero_payments_get": {
      const { paymentId } = args as { paymentId: string };
      const response = await client.get(`Payments/${paymentId}`);
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    case "xero_payments_create": {
      const { InvoiceID, AccountID, Amount, Date, Reference } = args as {
        InvoiceID: string;
        AccountID: string;
        Amount: number;
        Date: string;
        Reference?: string;
      };

      const payment: Record<string, unknown> = {
        Invoice: { InvoiceID },
        Account: { AccountID },
        Amount,
        Date,
      };
      if (Reference) payment.Reference = Reference;

      const response = await client.post("Payments", {
        Payments: [payment],
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown payment tool: ${name}` }],
        isError: true,
      };
  }
}
