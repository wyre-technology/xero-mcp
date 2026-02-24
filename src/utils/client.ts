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
 * Singleton client instance (lazy-loaded)
 */
let _client: XeroClient | null = null;

/**
 * Get or create the Xero client instance.
 * Uses lazy loading to defer instantiation until first use.
 *
 * @throws Error if XERO_ACCESS_TOKEN or XERO_TENANT_ID environment variables are not set
 * @returns The XeroClient instance
 */
export function getClient(): XeroClient {
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
 * Used in gateway mode to pick up new credentials from headers.
 */
export function resetClient(): void {
  _client = null;
}
