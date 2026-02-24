import { describe, it, expect } from 'vitest';

describe('xero-mcp', () => {
  it('should export domain tools', async () => {
    const contacts = await import('../domains/contacts.js');
    const invoices = await import('../domains/invoices.js');
    const payments = await import('../domains/payments.js');
    const accounts = await import('../domains/accounts.js');
    const reports = await import('../domains/reports.js');

    expect(contacts.contactTools.length).toBeGreaterThan(0);
    expect(invoices.invoiceTools.length).toBeGreaterThan(0);
    expect(payments.paymentTools.length).toBeGreaterThan(0);
    expect(accounts.accountTools.length).toBeGreaterThan(0);
    expect(reports.reportTools.length).toBeGreaterThan(0);
  });

  it('should have unique tool names', async () => {
    const contacts = await import('../domains/contacts.js');
    const invoices = await import('../domains/invoices.js');
    const payments = await import('../domains/payments.js');
    const accounts = await import('../domains/accounts.js');
    const reports = await import('../domains/reports.js');

    const allTools = [
      ...contacts.contactTools,
      ...invoices.invoiceTools,
      ...payments.paymentTools,
      ...accounts.accountTools,
      ...reports.reportTools,
    ];
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
