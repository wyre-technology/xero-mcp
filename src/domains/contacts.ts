/**
 * Contacts domain tools for Xero MCP Server
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../utils/client.js";

/**
 * Contact domain tool definitions
 */
export const contactTools: Tool[] = [
  {
    name: "xero_contacts_list",
    description:
      "List contacts in Xero with pagination. Optionally filter using a where clause. Returns contact details including name, email, and addresses.",
    inputSchema: {
      type: "object",
      properties: {
        page: {
          type: "number",
          description: "Page number (1-based, default: 1). Each page returns up to 100 contacts.",
        },
        where: {
          type: "string",
          description:
            'Optional Xero where clause filter (e.g., \'ContactStatus=="ACTIVE"\')',
        },
      },
    },
  },
  {
    name: "xero_contacts_get",
    description:
      "Get detailed information about a specific contact by its ID. Returns full contact profile including addresses, phone numbers, and email.",
    inputSchema: {
      type: "object",
      properties: {
        contactId: {
          type: "string",
          description: "The unique contact ID (UUID)",
        },
      },
      required: ["contactId"],
    },
  },
  {
    name: "xero_contacts_create",
    description:
      "Create a new contact in Xero. Name is required; other fields are optional.",
    inputSchema: {
      type: "object",
      properties: {
        Name: {
          type: "string",
          description: "Contact name (required)",
        },
        EmailAddress: {
          type: "string",
          description: "Contact email address",
        },
        FirstName: {
          type: "string",
          description: "Contact first name",
        },
        LastName: {
          type: "string",
          description: "Contact last name",
        },
        Phone: {
          type: "string",
          description: "Contact phone number",
        },
        AccountNumber: {
          type: "string",
          description: "Account number for the contact",
        },
        TaxNumber: {
          type: "string",
          description: "Tax number (ABN in Australia, GST in NZ, VAT in UK)",
        },
        IsCustomer: {
          type: "boolean",
          description: "Whether the contact is a customer",
        },
        IsSupplier: {
          type: "boolean",
          description: "Whether the contact is a supplier",
        },
      },
      required: ["Name"],
    },
  },
  {
    name: "xero_contacts_search",
    description:
      "Search contacts by name. Returns contacts whose name contains the search term.",
    inputSchema: {
      type: "object",
      properties: {
        term: {
          type: "string",
          description: "Search term to match against contact names",
        },
      },
      required: ["term"],
    },
  },
];

/**
 * Handle contact domain tool calls
 */
export async function handleContactTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  const client = getClient();

  switch (name) {
    case "xero_contacts_list": {
      const { page, where } = args as {
        page?: number;
        where?: string;
      };
      const params: Record<string, string> = {};
      if (page !== undefined) params.page = String(page);
      if (where) params.where = where;

      const response = await client.get("Contacts", params);
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    case "xero_contacts_get": {
      const { contactId } = args as { contactId: string };
      const response = await client.get(`Contacts/${contactId}`);
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    case "xero_contacts_create": {
      const {
        Name,
        EmailAddress,
        FirstName,
        LastName,
        Phone,
        AccountNumber,
        TaxNumber,
        IsCustomer,
        IsSupplier,
      } = args as {
        Name: string;
        EmailAddress?: string;
        FirstName?: string;
        LastName?: string;
        Phone?: string;
        AccountNumber?: string;
        TaxNumber?: string;
        IsCustomer?: boolean;
        IsSupplier?: boolean;
      };

      const contact: Record<string, unknown> = { Name };
      if (EmailAddress) contact.EmailAddress = EmailAddress;
      if (FirstName) contact.FirstName = FirstName;
      if (LastName) contact.LastName = LastName;
      if (Phone) {
        contact.Phones = [{ PhoneType: "DEFAULT", PhoneNumber: Phone }];
      }
      if (AccountNumber) contact.AccountNumber = AccountNumber;
      if (TaxNumber) contact.TaxNumber = TaxNumber;
      if (IsCustomer !== undefined) contact.IsCustomer = IsCustomer;
      if (IsSupplier !== undefined) contact.IsSupplier = IsSupplier;

      const response = await client.post("Contacts", { Contacts: [contact] });
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    case "xero_contacts_search": {
      const { term } = args as { term: string };
      const params: Record<string, string> = {
        where: `Name.Contains("${term}")`,
      };
      const response = await client.get("Contacts", params);
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown contact tool: ${name}` }],
        isError: true,
      };
  }
}
