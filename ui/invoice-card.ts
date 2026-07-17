/**
 * Iframe bridge + renderer for the Xero invoice card (MCP Apps, SEP-1865).
 *
 * Runs inside the host's sandboxed iframe. Uses the official MCP Apps client
 * (`App`) to receive the xero_invoices_get tool result from the host. The
 * card is read-only — Xero invoices are financial records, so no write
 * round-trip is exposed from the card.
 *
 * The server attaches a normalized `_card` payload to xero_invoices_get
 * results (see src/invoice-card.ts) so this renderer never needs to
 * interpret raw Xero API objects itself.
 *
 * Rendering uses DOM construction (no innerHTML) — contact names, references
 * and line-item descriptions are untrusted accounting data, so text only
 * ever lands in text nodes.
 *
 * White-label: the card is neutral by default (no vendor identity) and
 * applies an injected `window.__BRAND__` override (set by the MCP server via
 * MCP_BRAND_* env vars, or a gateway per-org) so the same card can render in
 * any operator's brand. No injection = neutral card with no brand identity.
 */
import { App } from "@modelcontextprotocol/ext-apps";

interface Brand {
  name?: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  bg?: string;
  text?: string;
}
declare global {
  interface Window {
    __BRAND__?: Brand;
  }
}

/** Mirror of InvoiceCard in src/invoice-card.ts — keep in sync. */
interface InvoiceCard {
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
  lineItemCount: number;
}

const brand: Brand = window.__BRAND__ ?? {};

// Apply any injected brand overrides onto the CSS custom properties.
function applyBrand(): void {
  const root = document.documentElement.style;
  if (brand.primaryColor) root.setProperty("--brand-primary", brand.primaryColor);
  if (brand.accentColor) root.setProperty("--brand-accent", brand.accentColor);
  if (brand.bg) root.setProperty("--brand-bg", brand.bg);
  if (brand.text) root.setProperty("--brand-text", brand.text);
}

const app = new App({ name: "Xero Invoice Card", version: "1.0.0" });

/** Create an element with a class and (safe, text-node) children. */
function el(
  tag: string,
  className = "",
  ...children: Array<Node | string | null>
): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) {
    if (child == null) continue;
    node.append(child); // strings become text nodes — never parsed as HTML
  }
  return node;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fmtMoney(n: number | undefined, currency?: string): string | undefined {
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  if (currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
      }).format(n);
    } catch {
      /* unknown currency code — fall through to plain formatting */
    }
  }
  const formatted = n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${formatted} ${currency}` : formatted;
}

function field(label: string, value: string | undefined): HTMLElement | null {
  if (!value) return null;
  return el(
    "div",
    "field",
    el("div", "field__label", label),
    el("div", "field__value", value),
  );
}

function badge(text: string | undefined, cls: string): HTMLElement | null {
  return text ? el("span", `badge ${cls}`, text) : null;
}

function amountRow(
  label: string,
  value: string | undefined,
  cls = "",
): HTMLElement | null {
  if (!value) return null;
  return el(
    "div",
    cls ? `amount ${cls}` : "amount",
    el("span", "amount__label", label),
    el("span", "amount__value", value),
  );
}

function itemRow(
  item: InvoiceCard["lineItems"][number],
  currency?: string,
): HTMLElement {
  const qty =
    typeof item.quantity === "number" && typeof item.unitAmount === "number"
      ? `${item.quantity} × ${fmtMoney(item.unitAmount, currency)}`
      : undefined;
  return el(
    "div",
    "item",
    el("span", "item__desc", item.description),
    qty ? el("span", "item__qty", qty) : null,
    el("span", "item__amount", fmtMoney(item.lineAmount, currency) ?? ""),
  );
}

function render(inv: InvoiceCard): void {
  // Brand identity only renders when a brand was injected — the neutral
  // default card carries no identity at all.
  const brandId = el("span", "brandid");
  if (brand.logoUrl) {
    const logo = document.createElement("img");
    logo.src = brand.logoUrl;
    logo.alt = brand.name ?? "";
    logo.style.display = "inline-block";
    brandId.append(logo);
  }
  if (brand.name) brandId.append(el("span", "brand", brand.name));

  const invoiceRef = inv.invoiceNumber ?? inv.invoiceId.slice(0, 8);

  const amounts = el(
    "div",
    "amounts",
    amountRow("Subtotal", fmtMoney(inv.subTotal, inv.currency)),
    amountRow("Tax", fmtMoney(inv.totalTax, inv.currency)),
    amountRow("Total", fmtMoney(inv.total, inv.currency), "amount--total"),
    amountRow("Amount paid", fmtMoney(inv.amountPaid, inv.currency)),
    amountRow("Amount due", fmtMoney(inv.amountDue, inv.currency), "amount--due"),
  );

  let items: HTMLElement | null = null;
  if (inv.lineItems.length > 0) {
    items = el("div", "items", el("div", "items__h", `Line items (${inv.lineItemCount})`));
    for (const item of inv.lineItems) items.append(itemRow(item, inv.currency));
    const hidden = inv.lineItemCount - inv.lineItems.length;
    if (hidden > 0) {
      items.append(el("div", "items__more", `+ ${hidden} more line item${hidden === 1 ? "" : "s"}`));
    }
  }

  const body = el(
    "div",
    "card__body",
    el("div", "brandrow", brandId, el("span", "invoiceno", `${invoiceRef} · Xero`)),
    el("h1", "", inv.contact ?? invoiceRef),
    el("div", "badges", badge(inv.status, "badge--status"), badge(inv.type, "badge--type")),
    el(
      "div",
      "grid",
      field("Date", inv.date && fmtDate(inv.date)),
      field("Due date", inv.dueDate && fmtDate(inv.dueDate)),
      field("Reference", inv.reference),
      field("Currency", inv.currency),
    ),
    amounts,
    items,
  );

  const root = document.getElementById("root")!;
  root.replaceChildren(el("div", "card", el("div", "card__bar"), body));
}

// xero-mcp returns the raw Xero response JSON with the normalized card
// attached as a top-level _card field.
function extractCard(obj: unknown): InvoiceCard | null {
  const card = (obj as { _card?: InvoiceCard })?._card;
  return card && typeof card.invoiceId === "string" && Array.isArray(card.lineItems)
    ? card
    : null;
}

applyBrand();

// Must be set before connect() so the initial tool-result isn't missed.
app.ontoolresult = (result: { content?: Array<{ type: string; text?: string }> }) => {
  const payload = (result.content ?? []).find((c) => c.type === "text");
  if (!payload?.text) return;
  try {
    const card = extractCard(JSON.parse(payload.text));
    if (card) render(card);
  } catch {
    /* ignore malformed payloads */
  }
};

app.connect();
