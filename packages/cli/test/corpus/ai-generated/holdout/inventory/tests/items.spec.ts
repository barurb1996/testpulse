import { test, expect } from '@playwright/test';

const BASE_URL = process.env.API_BASE_URL ?? 'https://api.inventory.example.com/api';
const MANAGER_TOKEN = process.env.INVENTORY_MANAGER_TOKEN ?? '';
const STAFF_TOKEN = process.env.INVENTORY_STAFF_TOKEN ?? '';
const OTHER_WAREHOUSE_TOKEN = process.env.INVENTORY_OTHER_WAREHOUSE_TOKEN ?? '';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

function uniqueSku(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const l = Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * 26)]).join('');
  const n = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `${l}-${n}`;
}

test.describe('GET /items', () => {
  test('returns list of items for authenticated user', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/items`, { headers: auth(STAFF_TOKEN) });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test('returns 401 without token', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/items`);
    expect(response.status()).toBe(401);
  });

  test('returns 401 with invalid token', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/items`, { headers: auth('invalid-token') });
    expect(response.status()).toBe(401);
  });

  test('lowStock=true returns 200', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/items?lowStock=true`, { headers: auth(STAFF_TOKEN) });
    expect(response.status()).toBe(200);
    expect(Array.isArray(await response.json())).toBe(true);
  });

  test('lowStock=false returns 200', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/items`, {
      headers: auth(STAFF_TOKEN),
      params: { lowStock: false },
    });
    expect(response.status()).toBe(200);
  });

  test('each item matches Item schema', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/items`, { headers: auth(STAFF_TOKEN) });
    const items = await response.json();
    for (const item of items) {
      expect(item.sku).toMatch(/^[A-Z]{3}-[0-9]{4}$/);
      expect(typeof item.name).toBe('string');
      expect(Number.isInteger(item.quantity)).toBe(true);
      expect(item.quantity).toBeGreaterThanOrEqual(0);
    }
  });
});

test.describe('POST /items', () => {
  test('manager creates an item', async ({ request }) => {
    const sku = uniqueSku();
    const response = await request.post(`${BASE_URL}/items`, {
      headers: auth(MANAGER_TOKEN),
      data: { sku, name: 'Test widget', quantity: 10 },
    });
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.sku).toBe(sku);
    expect(body.name).toBe('Test widget');
    expect(body.quantity).toBe(10);
  });

  test('accepts quantity of zero', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/items`, {
      headers: auth(MANAGER_TOKEN),
      data: { sku: uniqueSku(), name: 'Zero stock', quantity: 0 },
    });
    expect(response.status()).toBe(201);
  });

  test('accepts name at min and max length boundaries', async ({ request }) => {
    const min = await request.post(`${BASE_URL}/items`, {
      headers: auth(MANAGER_TOKEN),
      data: { sku: uniqueSku(), name: 'ab', quantity: 1 },
    });
    expect(min.status()).toBe(201);
    const max = await request.post(`${BASE_URL}/items`, {
      headers: auth(MANAGER_TOKEN),
      data: { sku: uniqueSku(), name: 'a'.repeat(100), quantity: 1 },
    });
    expect(max.status()).toBe(201);
  });

  test('returns 409 when sku already exists', async ({ request }) => {
    const sku = uniqueSku();
    const first = await request.post(`${BASE_URL}/items`, {
      headers: auth(MANAGER_TOKEN),
      data: { sku, name: 'Original', quantity: 1 },
    });
    expect(first.status()).toBe(201);
    const second = await request.post(`${BASE_URL}/items`, {
      headers: auth(MANAGER_TOKEN),
      data: { sku, name: 'Duplicate', quantity: 2 },
    });
    expect(second.status()).toBe(409);
  });

  test('returns 403 for non-manager', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/items`, {
      headers: auth(STAFF_TOKEN),
      data: { sku: uniqueSku(), name: 'Forbidden', quantity: 1 },
    });
    expect(response.status()).toBe(403);
  });

  test('returns 401 without token', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/items`, {
      data: { sku: uniqueSku(), name: 'Anon', quantity: 1 },
    });
    expect(response.status()).toBe(401);
  });

  const invalidPayloads: Array<[string, Record<string, unknown>]> = [
    ['missing sku', { name: 'No sku', quantity: 1 }],
    ['missing name', { sku: 'ABC-1234', quantity: 1 }],
    ['missing quantity', { sku: 'ABC-1234', name: 'No qty' }],
    ['empty body', {}],
    ['sku lowercase', { sku: 'abc-1234', name: 'Bad sku', quantity: 1 }],
    ['sku wrong digits count', { sku: 'ABC-123', name: 'Bad sku', quantity: 1 }],
    ['sku without dash', { sku: 'ABC1234', name: 'Bad sku', quantity: 1 }],
    ['sku too long', { sku: 'ABCD-12345', name: 'Bad sku', quantity: 1 }],
    ['name too short', { sku: 'ABC-1234', name: 'a', quantity: 1 }],
    ['name too long', { sku: 'ABC-1234', name: 'a'.repeat(101), quantity: 1 }],
    ['negative quantity', { sku: 'ABC-1234', name: 'Negative', quantity: -1 }],
    ['non-integer quantity', { sku: 'ABC-1234', name: 'Fraction', quantity: 1.5 }],
    ['string quantity', { sku: 'ABC-1234', name: 'String qty', quantity: 'ten' }],
    ['numeric sku', { sku: 1234, name: 'Numeric sku', quantity: 1 }],
    ['numeric name', { sku: 'ABC-1234', name: 123, quantity: 1 }],
  ];

  for (const [label, payload] of invalidPayloads) {
    test(`returns 400 for ${label}`, async ({ request }) => {
      const response = await request.post(`${BASE_URL}/items`, {
        headers: auth(MANAGER_TOKEN),
        data: payload,
      });
      expect(response.status()).toBe(400);
    });
  }
});

test.describe('GET /items/{itemId}', () => {
  let itemId: string;
  let sku: string;

  test.beforeAll(async ({ playwright }) => {
    const ctx = await playwright.request.newContext();
    sku = uniqueSku();
    const created = await ctx.post(`${BASE_URL}/items`, {
      headers: auth(MANAGER_TOKEN),
      data: { sku, name: 'Fetch me', quantity: 5 },
    });
    expect(created.status()).toBe(201);
    itemId = (await created.json()).id;
    await ctx.dispose();
  });

  test('returns an item from own warehouse', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/items/${itemId}`, { headers: auth(MANAGER_TOKEN) });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(itemId);
    expect(body.sku).toBe(sku);
    expect(body.name).toBe('Fetch me');
    expect(body.quantity).toBe(5);
  });

  test('returns 401 without token', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/items/${itemId}`);
    expect(response.status()).toBe(401);
  });

  test('returns 403 for item in other warehouse', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/items/${itemId}`, {
      headers: auth(OTHER_WAREHOUSE_TOKEN),
    });
    expect(response.status()).toBe(403);
  });

  test('returns 404 for unknown id', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/items/00000000-0000-4000-8000-000000000000`, {
      headers: auth(MANAGER_TOKEN),
    });
    expect(response.status()).toBe(404);
  });
});

test.describe('DELETE /items/{itemId}', () => {
  async function createItem(request: import('@playwright/test').APIRequestContext): Promise<string> {
    const created = await request.post(`${BASE_URL}/items`, {
      headers: auth(MANAGER_TOKEN),
      data: { sku: uniqueSku(), name: 'Disposable', quantity: 1 },
    });
    expect(created.status()).toBe(201);
    return (await created.json()).id;
  }

  test('manager removes an item and it is gone afterwards', async ({ request }) => {
    const id = await createItem(request);
    const del = await request.delete(`${BASE_URL}/items/${id}`, { headers: auth(MANAGER_TOKEN) });
    expect(del.status()).toBe(204);
    const get = await request.get(`${BASE_URL}/items/${id}`, { headers: auth(MANAGER_TOKEN) });
    expect(get.status()).toBe(404);
  });

  test('second delete returns 404', async ({ request }) => {
    const id = await createItem(request);
    await request.delete(`${BASE_URL}/items/${id}`, { headers: auth(MANAGER_TOKEN) });
    const again = await request.delete(`${BASE_URL}/items/${id}`, { headers: auth(MANAGER_TOKEN) });
    expect(again.status()).toBe(404);
  });

  test('returns 401 without token', async ({ request }) => {
    const id = await createItem(request);
    const response = await request.delete(`${BASE_URL}/items/${id}`);
    expect(response.status()).toBe(401);
  });

  test('returns 403 for non-manager', async ({ request }) => {
    const id = await createItem(request);
    const response = await request.delete(`${BASE_URL}/items/${id}`, { headers: auth(STAFF_TOKEN) });
    expect(response.status()).toBe(403);
  });

  test('returns 403 for manager of another warehouse', async ({ request }) => {
    const id = await createItem(request);
    const response = await request.delete(`${BASE_URL}/items/${id}`, {
      headers: auth(OTHER_WAREHOUSE_TOKEN),
    });
    expect(response.status()).toBe(403);
  });

  test('returns 404 for unknown id', async ({ request }) => {
    const response = await request.delete(`${BASE_URL}/items/00000000-0000-4000-8000-000000000000`, {
      headers: auth(MANAGER_TOKEN),
    });
    expect(response.status()).toBe(404);
  });
});
