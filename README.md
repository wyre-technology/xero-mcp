# Xero MCP Server

Model Context Protocol (MCP) server for the [Xero Accounting API](https://developer.xero.com/documentation/api/accounting/overview). Enables Claude and other MCP-compatible clients to manage Xero contacts, invoices, payments, accounts, and reports.

## Quick Start

### Prerequisites

- Node.js >= 20
- Xero OAuth2 app credentials (requires a [Xero developer account](https://developer.xero.com/))

### Install and Build

```bash
npm install
npm run build
```

### Run (stdio mode)

```bash
XERO_ACCESS_TOKEN=your-access-token XERO_TENANT_ID=your-tenant-id npm start
```

### Run (HTTP mode)

```bash
MCP_TRANSPORT=http XERO_ACCESS_TOKEN=your-access-token XERO_TENANT_ID=your-tenant-id npm start
```

The server listens on `http://0.0.0.0:8080/mcp` by default.

### Docker

```bash
docker build -t xero-mcp .
docker run -p 8080:8080 \
  -e MCP_TRANSPORT=http \
  -e XERO_ACCESS_TOKEN=your-access-token \
  -e XERO_TENANT_ID=your-tenant-id \
  xero-mcp
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `XERO_ACCESS_TOKEN` | Yes (env mode) | — | Xero OAuth2 access token |
| `XERO_TENANT_ID` | Yes (env mode) | — | Xero tenant ID (organisation) |
| `MCP_TRANSPORT` | No | `stdio` | Transport type: `stdio` or `http` |
| `MCP_HTTP_PORT` | No | `8080` | HTTP server port |
| `MCP_HTTP_HOST` | No | `0.0.0.0` | HTTP server bind address |
| `AUTH_MODE` | No | `env` | Auth mode: `env` or `gateway` |

## Gateway Mode

When `AUTH_MODE=gateway`, credentials are passed per-request via HTTP headers instead of environment variables:

- `X-Xero-Access-Token` — OAuth2 access token
- `X-Xero-Tenant-Id` — Xero tenant ID

This allows a gateway/proxy to manage multi-tenant credentials.

## Available Tools

Tools are organized into domains. Use `xero_navigate` to select a domain, then use the domain-specific tools.

### Navigation

- `xero_navigate` — Select a domain (contacts, invoices, payments, accounts, reports)
- `xero_back` — Return to domain selection

### Contacts

- `xero_contacts_list` — List contacts with pagination and optional filtering
- `xero_contacts_get` — Get detailed contact information by ID
- `xero_contacts_create` — Create a new contact (customer or supplier)
- `xero_contacts_search` — Search contacts by name

### Invoices

- `xero_invoices_list` — List invoices with optional status and type filters
- `xero_invoices_get` — Get detailed invoice information by ID
- `xero_invoices_create` — Create a new invoice (sales or bill)
- `xero_invoices_update_status` — Update invoice status (submit, authorise, void)

### Payments

- `xero_payments_list` — List payments with optional status filter
- `xero_payments_get` — Get detailed payment information by ID
- `xero_payments_create` — Record a payment against an invoice

### Accounts

- `xero_accounts_list` — List chart of accounts with optional type/class filter
- `xero_accounts_get` — Get detailed account information by ID

### Reports

- `xero_reports_profit_and_loss` — Profit and Loss (income statement) for a date range
- `xero_reports_balance_sheet` — Balance Sheet as of a specific date
- `xero_reports_aged_receivables` — Aged Receivables by contact
- `xero_reports_aged_payables` — Aged Payables by contact

## License

Apache-2.0
