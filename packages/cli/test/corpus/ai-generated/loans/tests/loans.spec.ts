import { test, expect } from '@playwright/test';

const BASE_URL = process.env.LOANS_API_URL ?? 'https://api.loans.example.com/v1';
const TOKEN = process.env.LOANS_API_TOKEN ?? '';

const authHeaders = { Authorization: `Bearer ${TOKEN}` };

const validLoan = { principal: 10000, currency: 'EUR', termMonths: 24 };

test.describe('Health', () => {
  test('GET /health returns 200 without auth', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/health`);
    expect(response.status()).toBe(200);
  });
});

test.describe('GET /loans', () => {
  test('returns list of loans for authenticated user', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/loans`, { headers: authHeaders });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBeTruthy();
  });

  test('returns 401 without token', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/loans`);
    expect(response.status()).toBe(401);
  });
});

test.describe('POST /loans', () => {
  test('creates a loan with valid data', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/loans`, {
      headers: authHeaders,
      data: validLoan,
    });
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.id).toBeDefined();
    expect(body.principal).toBe(10000);
    expect(body.status).toBe('PENDING');
  });

  test('returns 400 when principal is too low', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/loans`, {
      headers: authHeaders,
      data: { ...validLoan, principal: 999 },
    });
    expect(response.status()).toBe(400);
  });

  test('returns 400 when principal is too high', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/loans`, {
      headers: authHeaders,
      data: { ...validLoan, principal: 500001 },
    });
    expect(response.status()).toBe(400);
  });

  test('returns 400 for invalid currency', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/loans`, {
      headers: authHeaders,
      data: { ...validLoan, currency: 'GBP' },
    });
    expect(response.status()).toBe(400);
  });

  test('returns 400 when termMonths is out of range', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/loans`, {
      headers: authHeaders,
      data: { ...validLoan, termMonths: 3 },
    });
    expect(response.status()).toBe(400);
  });

  test('returns 400 when required fields are missing', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/loans`, {
      headers: authHeaders,
      data: {},
    });
    expect(response.status()).toBe(400);
  });

  test('returns 401 without token', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/loans`, { data: validLoan });
    expect(response.status()).toBe(401);
  });
});

test.describe('GET /loans/{loanId}', () => {
  test('returns a loan by id', async ({ request }) => {
    const created = await request.post(`${BASE_URL}/loans`, {
      headers: authHeaders,
      data: validLoan,
    });
    const { id } = await created.json();

    const response = await request.get(`${BASE_URL}/loans/${id}`, { headers: authHeaders });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(id);
    expect(['PENDING', 'ACTIVE', 'CANCELLED']).toContain(body.status);
  });

  test('returns 404 for non-existent loan', async ({ request }) => {
    const response = await request.get(
      `${BASE_URL}/loans/00000000-0000-4000-8000-000000000000`,
      { headers: authHeaders },
    );
    expect(response.status()).toBe(404);
  });

  test('returns 401 without token', async ({ request }) => {
    const response = await request.get(
      `${BASE_URL}/loans/00000000-0000-4000-8000-000000000000`,
    );
    expect(response.status()).toBe(401);
  });
});

test.describe('DELETE /loans/{loanId}', () => {
  test('cancels own loan', async ({ request }) => {
    const created = await request.post(`${BASE_URL}/loans`, {
      headers: authHeaders,
      data: validLoan,
    });
    const { id } = await created.json();

    const response = await request.delete(`${BASE_URL}/loans/${id}`, { headers: authHeaders });
    expect(response.status()).toBe(204);
  });

  test('returns 404 for non-existent loan', async ({ request }) => {
    const response = await request.delete(
      `${BASE_URL}/loans/00000000-0000-4000-8000-000000000000`,
      { headers: authHeaders },
    );
    expect(response.status()).toBe(404);
  });

  test('returns 401 without token', async ({ request }) => {
    const response = await request.delete(
      `${BASE_URL}/loans/00000000-0000-4000-8000-000000000000`,
    );
    expect(response.status()).toBe(401);
  });
});
