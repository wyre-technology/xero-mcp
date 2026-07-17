/**
 * MCP Apps (SEP-1865) contract tests — mirrors the checks an MCP Apps host
 * performs to render the invoice card:
 *   1. renderable tools advertise the UI resource via _meta (both key forms)
 *   2. the ui:// resource lists and reads back as profile=mcp-app HTML
 *   3. buildInvoiceCard normalizes a raw Xero invoice response into the flat,
 *      label-resolved card payload the iframe renders from — best-effort, so
 *      anything that is not an invoice simply yields no card
 *   4. the default bundle is brand-neutral; MCP_BRAND_* env vars inject a
 *      window.__BRAND__ override at serve time
 */

import { describe, it, expect, vi } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import worker from "../worker.js";
import { listResources, readResource } from "../resources.js";
import {
  buildInvoiceCard,
  applyBrandInjection,
  INVOICE_CARD_RESOURCE_URI,
  MCP_APP_RESOURCE_MIME,
} from "../invoice-card.js";
import { INVOICE_CARD_HTML } from "../generated/invoice-card-html.js";

const RENDERABLE_TOOLS = ["xero_invoices_get"];

/** Fetch the full wire-level tool list through the Workers entrypoint. */
async function getAllTools(): Promise<Tool[]> {
  const res = await worker.fetch(
    new Request("http://worker.local/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    }),
    {},
  );
  const body = (await res.json()) as { result?: { tools?: Tool[] } };
  return body.result?.tools ?? [];
}

describe("MCP Apps invoice card", () => {
  describe("tool _meta advertisement", () => {
    it.each(RENDERABLE_TOOLS)("%s links the card via _meta", async (name) => {
      const tool = (await getAllTools()).find((t) => t.name === name);
      expect(tool).toBeDefined();
      // Canonical flat key (ext-apps RESOURCE_URI_META_KEY) …
      expect(tool?._meta?.["ui/resourceUri"]).toBe(INVOICE_CARD_RESOURCE_URI);
      // … and the nested form registerAppTool also emits.
      expect((tool?._meta?.ui as { resourceUri?: string })?.resourceUri).toBe(
        INVOICE_CARD_RESOURCE_URI,
      );
    });

    it("no other tools carry UI metadata", async () => {
      const others = (await getAllTools()).filter(
        (t) => t._meta && !RENDERABLE_TOOLS.includes(t.name),
      );
      expect(others).toEqual([]);
    });
  });

  describe("ui:// resource", () => {
    it("is listed with the MCP Apps MIME type", () => {
      const card = listResources().find(
        (r) => r.uri === INVOICE_CARD_RESOURCE_URI,
      );
      expect(card?.mimeType).toBe(MCP_APP_RESOURCE_MIME);
    });

    it("reads back as profile=mcp-app HTML containing the card app", () => {
      const content = readResource(INVOICE_CARD_RESOURCE_URI);
      expect(content.mimeType).toBe(MCP_APP_RESOURCE_MIME);
      // No MCP_BRAND_* env set → the embedded HTML is served byte-identical.
      expect(content.text).toBe(INVOICE_CARD_HTML);
      expect(content.text).toContain("card__bar");
      // The injection marker survives the vite build, exactly once.
      expect(content.text.match(/BRAND_INJECT/g)).toHaveLength(1);
      // The vite build must have inlined the bridge script — a bare
      // <script src> would be unloadable from a resources/read HTML string.
      expect(content.text).not.toContain('src="./invoice-card.ts"');
    });

    it("serves neutral defaults with no vendor identity", () => {
      const { text } = readResource(INVOICE_CARD_RESOURCE_URI);
      expect(text).not.toMatch(/WYRE/i);
      expect(text).not.toContain("00c9db"); // WYRE cyan
      expect(text).not.toContain("ede947"); // WYRE yellow
      expect(text).not.toContain("fonts.googleapis.com"); // no external fetches
    });

    it("injects MCP_BRAND_* env vars into the served HTML", () => {
      vi.stubEnv("MCP_BRAND_NAME", "Acme Accounting");
      vi.stubEnv("MCP_BRAND_PRIMARY_COLOR", "#ff0000");
      try {
        const { text } = readResource(INVOICE_CARD_RESOURCE_URI);
        expect(text).toContain(
          '<script>window.__BRAND__={"name":"Acme Accounting","primaryColor":"#ff0000"}</script>',
        );
        expect(text).not.toContain("BRAND_INJECT");
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("rejects unknown resource URIs", () => {
      expect(() => readResource("ui://xero/nope.html")).toThrow(
        /Unknown resource/,
      );
    });
  });

  describe("applyBrandInjection", () => {
    const html = INVOICE_CARD_HTML;

    it("replaces the marker with an inline window.__BRAND__ script", () => {
      const out = applyBrandInjection(html, {
        name: "Acme",
        primaryColor: "#123456",
      });
      expect(out).toContain(
        'window.__BRAND__={"name":"Acme","primaryColor":"#123456"}',
      );
      expect(out).not.toContain("BRAND_INJECT");
    });

    it("escapes < so brand values cannot break out of the script tag", () => {
      const out = applyBrandInjection(html, { name: "</script><script>alert(1)" });
      expect(out).not.toContain("</script><script>alert(1)");
      expect(out).toContain("\\u003c/script>\\u003cscript>alert(1)");
    });

    it("returns the HTML unchanged for an empty brand", () => {
      expect(applyBrandInjection(html, {})).toBe(html);
      expect(applyBrandInjection(html, { name: "" })).toBe(html);
    });
  });

  describe("buildInvoiceCard", () => {
    /** Shape of a raw `GET Invoices/{id}` response. */
    const response = {
      Invoices: [
        {
          InvoiceID: "b3b8f4c2-4a1e-4a1e-9a1e-000000000001",
          InvoiceNumber: "INV-0042",
          Type: "ACCREC",
          Status: "AUTHORISED",
          Contact: {
            ContactID: "c1c1c1c1-0000-0000-0000-000000000001",
            Name: "Acme Corp",
          },
          DateString: "2026-07-01T00:00:00",
          DueDateString: "2026-07-31T00:00:00",
          Reference: "PO-9931",
          CurrencyCode: "USD",
          SubTotal: 1000,
          TotalTax: 100,
          Total: 1100,
          AmountDue: 600,
          AmountPaid: 500,
          LineItems: [
            {
              Description: "Consulting",
              Quantity: 10,
              UnitAmount: 100,
              LineAmount: 1000,
            },
          ],
        },
      ],
    };

    it("normalizes labels, names, and amounts into the card payload", () => {
      const card = buildInvoiceCard(response);
      expect(card).toMatchObject({
        invoiceId: "b3b8f4c2-4a1e-4a1e-9a1e-000000000001",
        invoiceNumber: "INV-0042",
        type: "Sales invoice",
        status: "Authorised",
        contact: "Acme Corp",
        date: "2026-07-01T00:00:00",
        dueDate: "2026-07-31T00:00:00",
        reference: "PO-9931",
        currency: "USD",
        subTotal: 1000,
        totalTax: 100,
        total: 1100,
        amountDue: 600,
        amountPaid: 500,
        lineItemCount: 1,
        lineItems: [
          { description: "Consulting", quantity: 10, unitAmount: 100, lineAmount: 1000 },
        ],
      });
    });

    it("parses .NET-style /Date(ms)/ values when DateString is absent", () => {
      const invoice = {
        ...response.Invoices[0],
        DateString: undefined,
        Date: "/Date(1751328000000+0000)/",
      };
      const card = buildInvoiceCard({ Invoices: [invoice] });
      expect(card?.date).toBe("2025-07-01T00:00:00.000Z");
    });

    it("falls back to a short contact id when the name is missing", () => {
      const invoice = {
        ...response.Invoices[0],
        Contact: { ContactID: "c1c1c1c1-0000-0000-0000-000000000001" },
      };
      const card = buildInvoiceCard({ Invoices: [invoice] });
      expect(card?.contact).toBe("#c1c1c1c1");
    });

    it("caps line items and truncates long descriptions", () => {
      const invoice = {
        ...response.Invoices[0],
        LineItems: Array.from({ length: 8 }, (_, i) => ({
          Description: i === 0 ? "x".repeat(300) : `Item ${i}`,
          LineAmount: i,
        })),
      };
      const card = buildInvoiceCard({ Invoices: [invoice] });
      expect(card?.lineItemCount).toBe(8);
      expect(card?.lineItems).toHaveLength(5);
      expect(card?.lineItems[0].description).toHaveLength(200);
    });

    it("returns null for payloads that are not an invoice (best-effort)", () => {
      expect(buildInvoiceCard(null)).toBeNull();
      expect(buildInvoiceCard("nope")).toBeNull();
      expect(buildInvoiceCard({})).toBeNull();
      expect(buildInvoiceCard({ Invoices: [] })).toBeNull();
      expect(buildInvoiceCard({ Invoices: [{ Status: "PAID" }] })).toBeNull();
    });
  });
});
