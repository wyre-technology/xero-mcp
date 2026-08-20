/**
 * Tests for invoices domain handler
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Create mock functions using vi.hoisted so they're available when vi.mock is hoisted
const { mockGet, mockPost, mockClient } = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockPost = vi.fn();
  const mockClient = { get: mockGet, post: mockPost };
  return { mockGet, mockPost, mockClient };
});

// Mock the client module before importing the handler
vi.mock("../../utils/client.js", () => ({
  getClient: () => mockClient,
}));

// Mock elicitation so xero_invoices_list's "no filters" branch doesn't hang
// waiting on a real MCP client prompt.
const { mockElicitText } = vi.hoisted(() => ({ mockElicitText: vi.fn() }));
vi.mock("../../utils/elicitation.js", () => ({
  elicitText: mockElicitText,
}));

// Mock the invoice-card builder so tests exercise the domain handler's own
// logic, not the card-rendering module's.
const { mockBuildInvoiceCard } = vi.hoisted(() => ({
  mockBuildInvoiceCard: vi.fn(),
}));
vi.mock("../../invoice-card.js", () => ({
  buildInvoiceCard: mockBuildInvoiceCard,
  INVOICE_CARD_META: { "openai/outputTemplate": "ui://widget/invoice-card.html" },
}));

// Import handler after mocking
import { invoiceTools, handleInvoiceTool } from "../../domains/invoices.js";

describe("Invoices Domain Handler", () => {
  beforeEach(() => {
    mockGet.mockClear();
    mockPost.mockClear();
    mockElicitText.mockClear();
    mockBuildInvoiceCard.mockClear();

    mockGet.mockResolvedValue({
      Invoices: [
        { InvoiceID: "1", InvoiceNumber: "INV-001" },
        { InvoiceID: "2", InvoiceNumber: "INV-002" },
      ],
    });
    mockPost.mockResolvedValue({
      Invoices: [{ InvoiceID: "100", InvoiceNumber: "INV-100" }],
    });
    // Default: user declines both elicitation prompts (no date range).
    mockElicitText.mockResolvedValue(null);
    // Default: no card payload (null card = no UI surface).
    mockBuildInvoiceCard.mockReturnValue(null);
  });

  describe("invoiceTools", () => {
    it("should export all invoice tools", () => {
      const names = invoiceTools.map((t) => t.name);
      expect(names).toEqual([
        "xero_invoices_list",
        "xero_invoices_get",
        "xero_invoices_create",
        "xero_invoices_update_status",
      ]);
    });

    it("xero_invoices_get should require invoiceId", () => {
      const tool = invoiceTools.find((t) => t.name === "xero_invoices_get");
      expect(tool?.inputSchema.required).toContain("invoiceId");
    });

    it("xero_invoices_create should require Type, ContactID, and LineItems", () => {
      const tool = invoiceTools.find((t) => t.name === "xero_invoices_create");
      expect(tool?.inputSchema.required).toEqual([
        "Type",
        "ContactID",
        "LineItems",
      ]);
    });

    it("xero_invoices_update_status should require invoiceId and Status", () => {
      const tool = invoiceTools.find(
        (t) => t.name === "xero_invoices_update_status"
      );
      expect(tool?.inputSchema.required).toEqual(["invoiceId", "Status"]);
    });
  });

  describe("handleInvoiceTool", () => {
    describe("xero_invoices_list", () => {
      it("should elicit a date range when called with no filters, then apply it", async () => {
        mockElicitText
          .mockResolvedValueOnce("2026-01-01")
          .mockResolvedValueOnce("2026-01-31");

        const result = await handleInvoiceTool("xero_invoices_list", {});

        expect(mockElicitText).toHaveBeenCalledTimes(2);
        expect(mockGet).toHaveBeenCalledWith("Invoices", {
          where:
            "Date >= DateTime(2026,01,01) AND Date <= DateTime(2026,01,31)",
        });
        expect(result.isError).toBeUndefined();
        const data = JSON.parse(result.content[0].text);
        expect(data.Invoices).toHaveLength(2);
      });

      it("should only apply a start date when the end date is declined", async () => {
        mockElicitText.mockResolvedValueOnce("2026-01-01").mockResolvedValueOnce(null);

        await handleInvoiceTool("xero_invoices_list", {});

        expect(mockElicitText).toHaveBeenCalledTimes(2);
        expect(mockGet).toHaveBeenCalledWith("Invoices", {
          where: "Date >= DateTime(2026,01,01)",
        });
      });

      it("should skip elicitation and list all when the user declines the start date", async () => {
        const result = await handleInvoiceTool("xero_invoices_list", {});

        expect(mockElicitText).toHaveBeenCalledTimes(1);
        expect(mockGet).toHaveBeenCalledWith("Invoices", {});
        expect(result.isError).toBeUndefined();
      });

      it("should skip elicitation entirely when page is explicitly provided", async () => {
        await handleInvoiceTool("xero_invoices_list", { page: 2 });

        expect(mockElicitText).not.toHaveBeenCalled();
        expect(mockGet).toHaveBeenCalledWith("Invoices", { page: "2" });
      });

      it("should skip elicitation entirely when Status is explicitly provided", async () => {
        await handleInvoiceTool("xero_invoices_list", { Status: "PAID" });

        expect(mockElicitText).not.toHaveBeenCalled();
        expect(mockGet).toHaveBeenCalledWith("Invoices", {
          where: 'Status=="PAID"',
        });
      });

      it("should combine Status and Type filters into one where clause", async () => {
        await handleInvoiceTool("xero_invoices_list", {
          Status: "AUTHORISED",
          Type: "ACCREC",
        });

        expect(mockGet).toHaveBeenCalledWith("Invoices", {
          where: 'Status=="AUTHORISED" AND Type=="ACCREC"',
        });
      });
    });

    describe("xero_invoices_get", () => {
      it("should fetch a single invoice by ID", async () => {
        mockGet.mockResolvedValueOnce({
          InvoiceID: "1",
          InvoiceNumber: "INV-001",
        });

        const result = await handleInvoiceTool("xero_invoices_get", {
          invoiceId: "1",
        });

        expect(mockGet).toHaveBeenCalledWith("Invoices/1");
        expect(result.isError).toBeUndefined();
        const data = JSON.parse(result.content[0].text);
        expect(data.InvoiceNumber).toBe("INV-001");
      });

      it("should attach a _card payload when buildInvoiceCard returns one", async () => {
        mockGet.mockResolvedValueOnce({ InvoiceID: "1" });
        mockBuildInvoiceCard.mockReturnValueOnce({ total: "100.00" });

        const result = await handleInvoiceTool("xero_invoices_get", {
          invoiceId: "1",
        });

        const data = JSON.parse(result.content[0].text);
        expect(data._card).toEqual({ total: "100.00" });
      });

      it("should not attach a _card field when buildInvoiceCard returns null", async () => {
        mockGet.mockResolvedValueOnce({ InvoiceID: "1" });

        const result = await handleInvoiceTool("xero_invoices_get", {
          invoiceId: "1",
        });

        const data = JSON.parse(result.content[0].text);
        expect(data._card).toBeUndefined();
      });

      it("should still return the raw invoice if buildInvoiceCard throws", async () => {
        mockGet.mockResolvedValueOnce({ InvoiceID: "1", InvoiceNumber: "INV-001" });
        mockBuildInvoiceCard.mockImplementationOnce(() => {
          throw new Error("card build failed");
        });

        const result = await handleInvoiceTool("xero_invoices_get", {
          invoiceId: "1",
        });

        expect(result.isError).toBeUndefined();
        const data = JSON.parse(result.content[0].text);
        expect(data.InvoiceNumber).toBe("INV-001");
        expect(data._card).toBeUndefined();
      });
    });

    describe("xero_invoices_create", () => {
      it("should create an invoice with only the required fields", async () => {
        await handleInvoiceTool("xero_invoices_create", {
          Type: "ACCREC",
          ContactID: "c1",
          LineItems: [
            {
              Description: "Consulting",
              Quantity: 1,
              UnitAmount: 100,
              AccountCode: "200",
            },
          ],
        });

        expect(mockPost).toHaveBeenCalledWith("Invoices", {
          Invoices: [
            {
              Type: "ACCREC",
              Contact: { ContactID: "c1" },
              LineItems: [
                {
                  Description: "Consulting",
                  Quantity: 1,
                  UnitAmount: 100,
                  AccountCode: "200",
                },
              ],
            },
          ],
        });
      });

      it("should include all optional fields when provided", async () => {
        await handleInvoiceTool("xero_invoices_create", {
          Type: "ACCREC",
          ContactID: "c1",
          LineItems: [],
          Date: "2026-01-01",
          DueDate: "2026-01-31",
          Reference: "PO-123",
          Status: "AUTHORISED",
        });

        expect(mockPost).toHaveBeenCalledWith("Invoices", {
          Invoices: [
            {
              Type: "ACCREC",
              Contact: { ContactID: "c1" },
              LineItems: [],
              Date: "2026-01-01",
              DueDate: "2026-01-31",
              Reference: "PO-123",
              Status: "AUTHORISED",
            },
          ],
        });
      });

      it("should omit optional fields entirely when not provided, not send them as undefined", async () => {
        await handleInvoiceTool("xero_invoices_create", {
          Type: "ACCPAY",
          ContactID: "c1",
          LineItems: [],
        });

        const [, body] = mockPost.mock.calls[0];
        const sentInvoice = (body as { Invoices: Record<string, unknown>[] })
          .Invoices[0];
        expect(Object.keys(sentInvoice)).toEqual([
          "Type",
          "Contact",
          "LineItems",
        ]);
      });

      it("should return the created invoice from the API response", async () => {
        const result = await handleInvoiceTool("xero_invoices_create", {
          Type: "ACCREC",
          ContactID: "c1",
          LineItems: [],
        });

        expect(result.isError).toBeUndefined();
        const data = JSON.parse(result.content[0].text);
        expect(data.Invoices[0].InvoiceID).toBe("100");
      });
    });

    describe("xero_invoices_update_status", () => {
      it("should post the new status to the invoice's endpoint", async () => {
        await handleInvoiceTool("xero_invoices_update_status", {
          invoiceId: "1",
          Status: "AUTHORISED",
        });

        expect(mockPost).toHaveBeenCalledWith("Invoices/1", {
          InvoiceID: "1",
          Status: "AUTHORISED",
        });
      });

      it("should return the API response", async () => {
        const result = await handleInvoiceTool("xero_invoices_update_status", {
          invoiceId: "1",
          Status: "VOIDED",
        });

        expect(result.isError).toBeUndefined();
      });
    });

    describe("unknown tool", () => {
      it("should return an error result for an unrecognized tool name", async () => {
        const result = await handleInvoiceTool("xero_invoices_bogus", {});

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Unknown invoice tool");
      });

      it("should not touch the API client for an unrecognized tool", async () => {
        await handleInvoiceTool("xero_invoices_bogus", {});
        expect(mockGet).not.toHaveBeenCalled();
        expect(mockPost).not.toHaveBeenCalled();
      });
    });
  });
});
