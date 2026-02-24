/**
 * Invoices domain tools for Xero MCP Server
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../utils/client.js";

/**
 * Invoice domain tool definitions
 */
export const invoiceTools: Tool[] = [
  {
    name: "xero_invoices_list",
    description:
      "List invoices in Xero with pagination. Optionally filter by status and type (ACCREC for sales, ACCPAY for bills).",
    inputSchema: {
      type: "object",
      properties: {
        page: {
          type: "number",
          description: "Page number (1-based, default: 1). Each page returns up to 100 invoices.",
        },
        Status: {
          type: "string",
          enum: ["DRAFT", "SUBMITTED", "AUTHORISED", "PAID", "VOIDED", "DELETED"],
          description: "Filter by invoice status",
        },
        Type: {
          type: "string",
          enum: ["ACCREC", "ACCPAY"],
          description:
            "Filter by invoice type: ACCREC (accounts receivable / sales invoices) or ACCPAY (accounts payable / bills)",
        },
      },
    },
  },
  {
    name: "xero_invoices_get",
    description:
      "Get detailed information about a specific invoice by its ID. Returns full invoice details including line items, amounts, and payment status.",
    inputSchema: {
      type: "object",
      properties: {
        invoiceId: {
          type: "string",
          description: "The unique invoice ID (UUID)",
        },
      },
      required: ["invoiceId"],
    },
  },
  {
    name: "xero_invoices_create",
    description:
      "Create a new invoice in Xero. Requires type, contact, and at least one line item.",
    inputSchema: {
      type: "object",
      properties: {
        Type: {
          type: "string",
          enum: ["ACCREC", "ACCPAY"],
          description:
            "Invoice type: ACCREC (sales invoice) or ACCPAY (bill) (required)",
        },
        ContactID: {
          type: "string",
          description: "The contact ID to create the invoice for (required)",
        },
        LineItems: {
          type: "array",
          description: "Array of line items (required). Each item needs Description, Quantity, UnitAmount, and AccountCode.",
          items: {
            type: "object",
            properties: {
              Description: {
                type: "string",
                description: "Line item description",
              },
              Quantity: {
                type: "number",
                description: "Quantity",
              },
              UnitAmount: {
                type: "number",
                description: "Unit price",
              },
              AccountCode: {
                type: "string",
                description: "Account code for the line item",
              },
              TaxType: {
                type: "string",
                description: "Tax type code (e.g., OUTPUT, INPUT, NONE)",
              },
            },
            required: ["Description", "Quantity", "UnitAmount", "AccountCode"],
          },
        },
        Date: {
          type: "string",
          description: "Invoice date in YYYY-MM-DD format",
        },
        DueDate: {
          type: "string",
          description: "Due date in YYYY-MM-DD format",
        },
        Reference: {
          type: "string",
          description: "Invoice reference/PO number",
        },
        Status: {
          type: "string",
          enum: ["DRAFT", "SUBMITTED", "AUTHORISED"],
          description: "Initial invoice status (default: DRAFT)",
        },
      },
      required: ["Type", "ContactID", "LineItems"],
    },
  },
  {
    name: "xero_invoices_update_status",
    description:
      "Update the status of an existing invoice. Can submit, authorise, or void an invoice.",
    inputSchema: {
      type: "object",
      properties: {
        invoiceId: {
          type: "string",
          description: "The invoice ID to update (required)",
        },
        Status: {
          type: "string",
          enum: ["SUBMITTED", "AUTHORISED", "VOIDED"],
          description: "New status for the invoice (required)",
        },
      },
      required: ["invoiceId", "Status"],
    },
  },
];

/**
 * Handle invoice domain tool calls
 */
export async function handleInvoiceTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  const client = getClient();

  switch (name) {
    case "xero_invoices_list": {
      const { page, Status, Type } = args as {
        page?: number;
        Status?: string;
        Type?: string;
      };
      const params: Record<string, string> = {};
      if (page !== undefined) params.page = String(page);

      // Build where clause from filters
      const filters: string[] = [];
      if (Status) filters.push(`Status=="${Status}"`);
      if (Type) filters.push(`Type=="${Type}"`);
      if (filters.length > 0) params.where = filters.join(" AND ");

      const response = await client.get("Invoices", params);
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    case "xero_invoices_get": {
      const { invoiceId } = args as { invoiceId: string };
      const response = await client.get(`Invoices/${invoiceId}`);
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    case "xero_invoices_create": {
      const { Type, ContactID, LineItems, Date, DueDate, Reference, Status } =
        args as {
          Type: string;
          ContactID: string;
          LineItems: unknown[];
          Date?: string;
          DueDate?: string;
          Reference?: string;
          Status?: string;
        };

      const invoice: Record<string, unknown> = {
        Type,
        Contact: { ContactID },
        LineItems,
      };
      if (Date) invoice.Date = Date;
      if (DueDate) invoice.DueDate = DueDate;
      if (Reference) invoice.Reference = Reference;
      if (Status) invoice.Status = Status;

      const response = await client.post("Invoices", {
        Invoices: [invoice],
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    case "xero_invoices_update_status": {
      const { invoiceId, Status } = args as {
        invoiceId: string;
        Status: string;
      };

      const response = await client.post(`Invoices/${invoiceId}`, {
        InvoiceID: invoiceId,
        Status,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown invoice tool: ${name}` }],
        isError: true,
      };
  }
}
