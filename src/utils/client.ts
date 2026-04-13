/**
 * Xero REST Client
 *
 * Lightweight HTTP client for the Xero API.
 * Does NOT handle OAuth flows - expects a pre-authenticated access token.
 * In gateway mode, the gateway handles OAuth and passes tokens via headers.
 * In env mode, the user provides tokens directly via environment variables.
 *
 * Base URL: https://api.xero.com/api.xro/2.0/
 * Rate Limit: 60 requests/minute, 5000/day
 */

import { AsyncLocalStorage } from "node:async_hooks";

const XERO_API_BASE = "https://api.xero.com/api.xro/2.0";
const XERO_PAGE_SIZE = 100;

/**
 * Configuration for the Xero client
 */
interface XeroClientConfig {
  accessToken: string;
  tenantId: string;
}

/**
 * Xero REST client with Bearer token authentication
 */
class XeroClient {
  private config: XeroClientConfig;

  constructor(config: XeroClientConfig) {
    this.config = config;
  }

  /**
   * Make an authenticated request to the Xero API
   */
  private async request(
    method: string,
    path: string,
    params?: Record<string, string>,
    body?: unknown
  ): Promise<unknown> {
    let url = `${XERO_API_BASE}/${path}`;
    if (params && Object.keys(params).length > 0) {
      const searchParams = new URLSearchParams(params);
      url += `?${searchParams.toString()}`;
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.accessToken}`,
      "xero-tenant-id": this.config.tenantId,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    const options: RequestInit = { method, headers };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const responseBody = await response.text();
      throw new Error(
        `Xero API error ${method} /${path} (${response.status}): ${responseBody}`
      );
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  /**
   * GET request
   */
  async get(path: string, params?: Record<string, string>): Promise<unknown> {
    return this.request("GET", path, params);
  }

  /**
   * POST request
   */
  async post(path: string, body: unknown): Promise<unknown> {
    return this.request("POST", path, undefined, body);
  }

  /**
   * PUT request
   */
  async put(path: string, body: unknown): Promise<unknown> {
    return this.request("PUT", path, undefined, body);
  }

  /**
   * DELETE request
   */
  async delete(path: string): Promise<unknown> {
    return this.request("DELETE", path);
  }

  /**
   * Fetch all pages of a paginated endpoint.
   * Xero uses 1-based page numbers and returns 100 items per page.
   * Returns the combined items from all pages.
   */
  async getPaginated(
    path: string,
    params?: Record<string, string>,
    responseKey?: string
  ): Promise<unknown[]> {
    const allItems: unknown[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = (await this.get(path, {
        ...params,
        page: String(page),
      })) as Record<string, unknown>;

      // Xero wraps responses in a key matching the resource name
      const items = responseKey
        ? (response[responseKey] as unknown[])
        : (Object.values(response).find((v) => Array.isArray(v)) as
            | unknown[]
            | undefined);

      if (items && items.length > 0) {
        allItems.push(...items);
        hasMore = items.length >= XERO_PAGE_SIZE;
        page++;
      } else {
        hasMore = false;
      }
    }

    return allItems;
  }
}

/**
 * Per-request credential overrides via AsyncLocalStorage.
 * In gateway mode the HTTP handler sets this so that concurrent requests
 * never share or overwrite each other's credentials through process.env.
 */
export interface XeroCredentials {
  accessToken: string;
  tenantId: string;
}

export const credentialStore = new AsyncLocalStorage<XeroCredentials>();

/**
 * Singleton client instance (lazy-loaded, used only in stdio/env mode)
 */
let _client: XeroClient | null = null;

/**
 * Get or create the Xero client instance.
 * In gateway mode (AsyncLocalStorage has credentials), creates a fresh client per request.
 * In stdio/env mode, uses a lazy-loaded singleton.
 *
 * @throws Error if credentials are not available
 * @returns The XeroClient instance
 */
export function getClient(): XeroClient {
  // Prefer per-request credentials from AsyncLocalStorage (gateway mode)
  const override = credentialStore.getStore();
  if (override) {
    return new XeroClient({ accessToken: override.accessToken, tenantId: override.tenantId });
  }

  // Stdio / env mode: use singleton
  if (!_client) {
    const accessToken = process.env.XERO_ACCESS_TOKEN;
    const tenantId = process.env.XERO_TENANT_ID;

    if (!accessToken || !tenantId) {
      throw new Error(
        "XERO_ACCESS_TOKEN and XERO_TENANT_ID environment variables are required. " +
          "In gateway mode, these are set from request headers automatically."
      );
    }

    _client = new XeroClient({ accessToken, tenantId });
  }
  return _client;
}

/**
 * Reset the client instance.
 * Used in tests or when env-mode credentials change.
 */
export function resetClient(): void {
  _client = null;
}
