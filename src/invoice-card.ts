/**
 * Invoice-card payload builder for the MCP Apps (SEP-1865) UI surface.
 *
 * xero_invoices_get results get a normalized `_card` object attached (see
 * domains/invoices.ts) that the ui:// invoice card renders from. The card is
 * progressive enhancement: normalization is best-effort, and a null return
 * simply means the host renders no card while the JSON payload is unchanged.
 *
 * The card is read-only by policy — invoices are financial records, so no
 * write round-trip is exposed from the card.
 */

export const INVOICE_CARD_RESOURCE_URI = "ui://xero/invoice-card.html";

/** MCP Apps resource MIME (RESOURCE_MIME_TYPE in @modelcontextprotocol/ext-apps). */
export const MCP_APP_RESOURCE_MIME = "text/html;profile=mcp-app";

/**
 * Tool `_meta` advertising the card. Carries both the canonical flat key
 * (RESOURCE_URI_META_KEY in ext-apps) and the nested form ext-apps'
 * registerAppTool emits, so any MCP Apps host revision finds it.
 */
export const INVOICE_CARD_META = {
  "ui/resourceUri": INVOICE_CARD_RESOURCE_URI,
  ui: { resourceUri: INVOICE_CARD_RESOURCE_URI },
} as const;

/** Brand overrides injected into the card as `window.__BRAND__`. */
export interface CardBrand {
  name?: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  bg?: string;
  text?: string;
}

/** The comment marker in ui/index.html that serve-time injection replaces. */
const BRAND_INJECT_MARKER = /<!-- BRAND_INJECT:[\s\S]*?-->/;

/**
 * Replace the card's brand-inject comment with a `window.__BRAND__` script.
 * The card ships neutral; this is the customization mechanism. An empty
 * brand returns the HTML unchanged. `<` is escaped so brand values can
 * never break out of the injected script tag.
 */
export function applyBrandInjection(html: string, brand: CardBrand): string {
  const entries = Object.entries(brand).filter(
    ([, value]) => typeof value === "string" && value !== "",
  );
  if (entries.length === 0) return html;
  const json = JSON.stringify(Object.fromEntries(entries)).replace(/</g, "\\u003c");
  return html.replace(BRAND_INJECT_MARKER, `<script>window.__BRAND__=${json}</script>`);
}

/**
 * Resolve brand overrides from MCP_BRAND_* environment variables. Returns
 * an empty brand (HTML served unchanged) when none are set, or on runtimes
 * without `process.env` (e.g. Cloudflare Workers without nodejs_compat).
 */
export function resolveBrandFromEnv(): CardBrand {
  if (typeof process === "undefined" || !process.env) return {};
  const env = process.env;
  const brand: CardBrand = {};
  if (env.MCP_BRAND_NAME) brand.name = env.MCP_BRAND_NAME;
  if (env.MCP_BRAND_LOGO_URL) brand.logoUrl = env.MCP_BRAND_LOGO_URL;
  if (env.MCP_BRAND_PRIMARY_COLOR) brand.primaryColor = env.MCP_BRAND_PRIMARY_COLOR;
  if (env.MCP_BRAND_ACCENT_COLOR) brand.accentColor = env.MCP_BRAND_ACCENT_COLOR;
  if (env.MCP_BRAND_BG) brand.bg = env.MCP_BRAND_BG;
  if (env.MCP_BRAND_TEXT) brand.text = env.MCP_BRAND_TEXT;
  return brand;
}

/** Mirror of InvoiceCard in ui/invoice-card.ts — keep in sync. */
export interface InvoiceCard {
  invoiceId: string;
  invoiceNumber?: string;
  type?: string;
  status?: string;
  contact?: string;
  date?: string;
  dueDate?: string;
  reference?: string;
  currency?: string;
  subTotal?: number;
  totalTax?: number;
  total?: number;
  amountDue?: number;
  amountPaid?: number;
  lineItems: Array<{
    description: string;
    quantity?: number;
    unitAmount?: number;
    lineAmount?: number;
  }>;
  /** Total number of line items on the invoice (lineItems is capped). */
  lineItemCount: number;
}

const CARD_LINE_ITEM_LIMIT = 5;
const CARD_DESCRIPTION_MAX_LENGTH = 200;

/** Xero status codes -> human-readable labels. */
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  AUTHORISED: "Authorised",
  PAID: "Paid",
  VOIDED: "Voided",
  DELETED: "Deleted",
};

/** Xero invoice types -> human-readable labels. */
const TYPE_LABELS: Record<string, string> = {
  ACCREC: "Sales invoice",
  ACCPAY: "Bill",
};

const XERO_MS_DATE = /\/Date\((\d+)(?:[+-]\d{4})?\)\//;

/**
 * Normalize a Xero date. The Accounting API returns both a plain
 * `DateString` ("2026-07-01T00:00:00") and a .NET-style `Date`
 * ("/Date(1751328000000+0000)/"); prefer the former, parse the latter.
 */
function isoDate(dateString: unknown, msDate: unknown): string | undefined {
  if (typeof dateString === "string" && dateString) return dateString;
  if (typeof msDate === "string") {
    const match = XERO_MS_DATE.exec(msDate);
    if (match) {
      const parsed = new Date(Number(match[1]));
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
  }
  return undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Build the renderable card from a raw `GET Invoices/{id}` response
 * (`{ Invoices: [invoice] }`). All labels are resolved server-side from
 * data already present in the response — the Xero API embeds the resolved
 * `Contact.Name` alongside the id, so no extra lookups are needed.
 *
 * Returns null for anything that is not an invoice payload.
 */
export function buildInvoiceCard(response: unknown): InvoiceCard | null {
  if (!response || typeof response !== "object") return null;
  const invoices = (response as { Invoices?: unknown }).Invoices;
  const first = Array.isArray(invoices) ? invoices[0] : undefined;
  if (!first || typeof first !== "object") return null;
  const invoice = first as Record<string, unknown>;
  if (typeof invoice.InvoiceID !== "string" || invoice.InvoiceID === "") return null;

  const card: InvoiceCard = {
    invoiceId: invoice.InvoiceID,
    lineItems: [],
    lineItemCount: 0,
  };

  if (typeof invoice.InvoiceNumber === "string" && invoice.InvoiceNumber) {
    card.invoiceNumber = invoice.InvoiceNumber;
  }
  if (typeof invoice.Type === "string" && invoice.Type) {
    card.type = TYPE_LABELS[invoice.Type] ?? invoice.Type;
  }
  if (typeof invoice.Status === "string" && invoice.Status) {
    card.status = STATUS_LABELS[invoice.Status] ?? invoice.Status;
  }

  const contact = invoice.Contact as Record<string, unknown> | undefined;
  if (contact && typeof contact === "object") {
    if (typeof contact.Name === "string" && contact.Name) {
      card.contact = contact.Name;
    } else if (typeof contact.ContactID === "string" && contact.ContactID) {
      card.contact = `#${contact.ContactID.slice(0, 8)}`;
    }
  }

  const date = isoDate(invoice.DateString, invoice.Date);
  const dueDate = isoDate(invoice.DueDateString, invoice.DueDate);
  if (date) card.date = date;
  if (dueDate) card.dueDate = dueDate;

  if (typeof invoice.Reference === "string" && invoice.Reference) {
    card.reference = invoice.Reference;
  }
  if (typeof invoice.CurrencyCode === "string" && invoice.CurrencyCode) {
    card.currency = invoice.CurrencyCode;
  }

  const subTotal = num(invoice.SubTotal);
  const totalTax = num(invoice.TotalTax);
  const total = num(invoice.Total);
  const amountDue = num(invoice.AmountDue);
  const amountPaid = num(invoice.AmountPaid);
  if (subTotal !== undefined) card.subTotal = subTotal;
  if (totalTax !== undefined) card.totalTax = totalTax;
  if (total !== undefined) card.total = total;
  if (amountDue !== undefined) card.amountDue = amountDue;
  if (amountPaid !== undefined) card.amountPaid = amountPaid;

  if (Array.isArray(invoice.LineItems)) {
    const items = invoice.LineItems.filter(
      (item): item is Record<string, unknown> => !!item && typeof item === "object",
    );
    card.lineItemCount = items.length;
    card.lineItems = items.slice(0, CARD_LINE_ITEM_LIMIT).map((item) => {
      const entry: InvoiceCard["lineItems"][number] = {
        description:
          typeof item.Description === "string"
            ? item.Description.slice(0, CARD_DESCRIPTION_MAX_LENGTH)
            : "(no description)",
      };
      const quantity = num(item.Quantity);
      const unitAmount = num(item.UnitAmount);
      const lineAmount = num(item.LineAmount);
      if (quantity !== undefined) entry.quantity = quantity;
      if (unitAmount !== undefined) entry.unitAmount = unitAmount;
      if (lineAmount !== undefined) entry.lineAmount = lineAmount;
      return entry;
    });
  }

  return card;
}
