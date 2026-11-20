import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BOOKINGS_API_URL ?? 'https://api.bookings.example.com/v1';
const TOKEN = process.env.BOOKINGS_API_TOKEN ?? '';

const authHeaders = { Authorization: `Bearer ${TOKEN}` };

const validBooking = { amount: 10000, currency: 'EUR', nights: 24 };

test.describe('Health', () => {
  test('GET /health returns 200 without auth', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/health`);
    expect(response.status()).toBe(200);
  });
});

test.describe('GET /bookings', () => {
  test('returns list of bookings for authenticated user', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/bookings`, { headers: authHeaders });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBeTruthy();
  });

  test('returns 401 without token', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/bookings`);
    expect(response.status()).toBe(401);
  });
});

test.describe('POST /bookings', () => {
  test('creates a booking with valid data', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/bookings`, {
      headers: authHeaders,
      data: validBooking,
    });
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.id).toBeDefined();
    expect(body.amount).toBe(10000);
    expect(body.status).toBe('PENDING');
  });

  test('returns 400 when amount is too low', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/bookings`, {
      headers: authHeaders,
      data: { ...validBooking, amount: 999 },
    });
    expect(response.status()).toBe(400);
  });

  test('returns 400 when amount is too high', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/bookings`, {
      headers: authHeaders,
      data: { ...validBooking, amount: 500001 },
    });
    expect(response.status()).toBe(400);
  });

  test('returns 400 for invalid currency', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/bookings`, {
      headers: authHeaders,
      data: { ...validBooking, currency: 'GBP' },
    });
    expect(response.status()).toBe(400);
  });

  test('returns 400 when nights is out of range', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/bookings`, {
      headers: authHeaders,
      data: { ...validBooking, nights: 3 },
    });
    expect(response.status()).toBe(400);
  });

  test('returns 400 when required fields are missing', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/bookings`, {
      headers: authHeaders,
      data: {},
    });
    expect(response.status()).toBe(400);
  });

  test('returns 401 without token', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/bookings`, { data: validBooking });
    expect(response.status()).toBe(401);
  });
});

test.describe('GET /bookings/{bookingId}', () => {
  test('returns a booking by id', async ({ request }) => {
    const created = await request.post(`${BASE_URL}/bookings`, {
      headers: authHeaders,
      data: validBooking,
    });
    const { id } = await created.json();

    const response = await request.get(`${BASE_URL}/bookings/${id}`, { headers: authHeaders });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(id);
    expect(['PENDING', 'ACTIVE', 'CANCELLED']).toContain(body.status);
  });

  test('returns 404 for non-existent booking', async ({ request }) => {
    const response = await request.get(
      `${BASE_URL}/bookings/00000000-0000-4000-8000-000000000000`,
      { headers: authHeaders },
    );
    expect(response.status()).toBe(404);
  });

  test('returns 401 without token', async ({ request }) => {
    const response = await request.get(
      `${BASE_URL}/bookings/00000000-0000-4000-8000-000000000000`,
    );
    expect(response.status()).toBe(401);
  });
});

test.describe('DELETE /bookings/{bookingId}', () => {
  test('cancels own booking', async ({ request }) => {
    const created = await request.post(`${BASE_URL}/bookings`, {
      headers: authHeaders,
      data: validBooking,
    });
    const { id } = await created.json();

    const response = await request.delete(`${BASE_URL}/bookings/${id}`, { headers: authHeaders });
    expect(response.status()).toBe(204);
  });

  test('returns 404 for non-existent booking', async ({ request }) => {
    const response = await request.delete(
      `${BASE_URL}/bookings/00000000-0000-4000-8000-000000000000`,
      { headers: authHeaders },
    );
    expect(response.status()).toBe(404);
  });

  test('returns 401 without token', async ({ request }) => {
    const response = await request.delete(
      `${BASE_URL}/bookings/00000000-0000-4000-8000-000000000000`,
    );
    expect(response.status()).toBe(401);
  });
});
