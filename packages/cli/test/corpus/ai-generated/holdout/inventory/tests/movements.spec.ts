import { test, expect, APIRequestContext } from '@playwright/test';

const BASE_URL = process.env.API_BASE_URL ?? 'https://api.inventory.example.com/api';
const MANAGER_TOKEN = process.env.INVENTORY_MANAGER_TOKEN ?? '';
const STAFF_TOKEN = process.env.INVENTORY_STAFF_TOKEN ?? '';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

function uniqueSku(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const l = Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * 26)]).join('');
  const n = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `${l}-${n}`;
}

async function createItem(request: APIRequestContext, quantity: number): Promise<string> {
  const created = await request.post(`${BASE_URL}/items`, {
    headers: auth(MANAGER_TOKEN),
    data: { sku: uniqueSku(), name: 'Movement item', quantity },
  });
  expect(created.status()).toBe(201);
  return (await created.json()).id;
}

async function getQuantity(request: APIRequestContext, id: string): Promise<number> {
  const res = await request.get(`${BASE_URL}/items/${id}`, { headers: auth(MANAGER_TOKEN) });
  expect(res.status()).toBe(200);
  return (await res.json()).quantity;
}

test.describe('POST /movements', () => {
  test('RECEIVED with positive delta increases stock', async ({ request }) => {
    const itemId = await createItem(request, 10);
    const response = await request.post(`${BASE_URL}/movements`, {
      headers: auth(STAFF_TOKEN),
      data: { itemId, delta: 5, reason: 'RECEIVED' },
    });
    expect(response.status()).toBe(201);
    expect(await getQuantity(request, itemId)).toBe(15);
  });

  test('SOLD with negative delta decreases stock', async ({ request }) => {
    const itemId = await createItem(request, 10);
    const response = await request.post(`${BASE_URL}/movements`, {
      headers: auth(STAFF_TOKEN),
      data: { itemId, delta: -4, reason: 'SOLD' },
    });
    expect(response.status()).toBe(201);
    expect(await getQuantity(request, itemId)).toBe(6);
  });

  for (const reason of ['RECEIVED', 'SOLD', 'DAMAGED', 'RETURNED']) {
    test(`accepts reason ${reason}`, async ({ request }) => {
      const itemId = await createItem(request, 10);
      const response = await request.post(`${BASE_URL}/movements`, {
        headers: auth(STAFF_TOKEN),
        data: { itemId, delta: 1, reason },
      });
      expect(response.status()).toBe(201);
    });
  }

  test('allows reducing stock exactly to zero', async ({ request }) => {
    const itemId = await createItem(request, 3);
    const response = await request.post(`${BASE_URL}/movements`, {
      headers: auth(STAFF_TOKEN),
      data: { itemId, delta: -3, reason: 'DAMAGED' },
    });
    expect(response.status()).toBe(201);
    expect(await getQuantity(request, itemId)).toBe(0);
  });

  test('returns 409 when movement would make stock negative', async ({ request }) => {
    const itemId = await createItem(request, 2);
    const response = await request.post(`${BASE_URL}/movements`, {
      headers: auth(STAFF_TOKEN),
      data: { itemId, delta: -3, reason: 'SOLD' },
    });
    expect(response.status()).toBe(409);
    expect(await getQuantity(request, itemId)).toBe(2);
  });

  test('returns 409 when stock is already zero and delta is negative', async ({ request }) => {
    const itemId = await createItem(request, 0);
    const response = await request.post(`${BASE_URL}/movements`, {
      headers: auth(STAFF_TOKEN),
      data: { itemId, delta: -1, reason: 'SOLD' },
    });
    expect(response.status()).toBe(409);
  });

  test('sequential movements accumulate correctly', async ({ request }) => {
    const itemId = await createItem(request, 10);
    const deltas: Array<[number, string]> = [
      [5, 'RECEIVED'],
      [-3, 'SOLD'],
      [-2, 'DAMAGED'],
      [1, 'RETURNED'],
    ];
    for (const [delta, reason] of deltas) {
      const res = await request.post(`${BASE_URL}/movements`, {
        headers: auth(STAFF_TOKEN),
        data: { itemId, delta, reason },
      });
      expect(res.status()).toBe(201);
    }
    expect(await getQuantity(request, itemId)).toBe(11);
  });

  test('returns 401 without token', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/movements`, {
      data: { itemId: '00000000-0000-4000-8000-000000000000', delta: 1, reason: 'RECEIVED' },
    });
    expect(response.status()).toBe(401);
  });

  test('returns 401 with invalid token', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/movements`, {
      headers: auth('invalid-token'),
      data: { itemId: '00000000-0000-4000-8000-000000000000', delta: 1, reason: 'RECEIVED' },
    });
    expect(response.status()).toBe(401);
  });

  const validId = '00000000-0000-4000-8000-000000000000';
  const invalidPayloads: Array<[string, Record<string, unknown>]> = [
    ['missing itemId', { delta: 1, reason: 'RECEIVED' }],
    ['missing delta', { itemId: validId, reason: 'RECEIVED' }],
    ['missing reason', { itemId: validId, delta: 1 }],
    ['empty body', {}],
    ['itemId not a uuid', { itemId: 'not-a-uuid', delta: 1, reason: 'RECEIVED' }],
    ['non-integer delta', { itemId: validId, delta: 1.5, reason: 'RECEIVED' }],
    ['string delta', { itemId: validId, delta: 'five', reason: 'RECEIVED' }],
    ['unknown reason', { itemId: validId, delta: 1, reason: 'STOLEN' }],
    ['lowercase reason', { itemId: validId, delta: 1, reason: 'received' }],
    ['numeric reason', { itemId: validId, delta: 1, reason: 1 }],
  ];

  for (const [label, payload] of invalidPayloads) {
    test(`returns 400 for ${label}`, async ({ request }) => {
      const response = await request.post(`${BASE_URL}/movements`, {
        headers: auth(STAFF_TOKEN),
        data: payload,
      });
      expect(response.status()).toBe(400);
    });
  }
});
