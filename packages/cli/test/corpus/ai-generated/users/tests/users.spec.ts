import { test, expect } from '@playwright/test';

const BASE_URL = 'https://api.users.example.com';
const TOKEN = process.env.API_TOKEN ?? '';
const auth = { Authorization: `Bearer ${TOKEN}` };
const USER_ID = process.env.USER_ID ?? '3fa85f64-5717-4562-b3fc-2c963f66afa6';

test.describe('POST /auth/login', () => {
  test('returns 200 for valid credentials', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/auth/login`, {
      data: { email: 'user@example.com', password: 'correct-horse-battery' },
    });
    expect(res.status()).toBe(200);
  });

  test('returns 400 for malformed body', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/auth/login`, { data: {} });
    expect(res.status()).toBe(400);
  });

  test('returns 401 for bad credentials', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/auth/login`, {
      data: { email: 'user@example.com', password: 'wrong-password' },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe('POST /users', () => {
  test('creates a user', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/users`, {
      headers: auth,
      data: { email: `new-${Date.now()}@example.com`, password: 'a-very-long-password-1', role: 'user' },
    });
    expect(res.status()).toBe(201);
  });

  test('returns 400 for invalid body', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/users`, {
      headers: auth,
      data: { email: 'not-an-email', password: 'short' },
    });
    expect(res.status()).toBe(400);
  });

  test('returns 409 when email is taken', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/users`, {
      headers: auth,
      data: { email: 'user@example.com', password: 'a-very-long-password-1' },
    });
    expect(res.status()).toBe(409);
  });
});

test.describe('GET /users/me', () => {
  test('returns current user', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/users/me`, { headers: auth });
    expect(res.status()).toBe(200);
  });
});

test.describe('GET /users/{userId}', () => {
  test('returns a user', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/users/${USER_ID}`, { headers: auth });
    expect(res.status()).toBe(200);
  });

  test('returns 404 for unknown user', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/users/00000000-0000-4000-8000-000000000000`, {
      headers: auth,
    });
    expect(res.status()).toBe(404);
  });
});

test.describe('PATCH /users/{userId}', () => {
  test('updates a user', async ({ request }) => {
    const res = await request.patch(`${BASE_URL}/users/${USER_ID}`, {
      headers: auth,
      data: { displayName: 'New Name' },
    });
    expect(res.status()).toBe(200);
  });

  test('returns 400 for invalid email', async ({ request }) => {
    const res = await request.patch(`${BASE_URL}/users/${USER_ID}`, {
      headers: auth,
      data: { email: 'bad' },
    });
    expect(res.status()).toBe(400);
  });

  test('returns 404 for unknown user', async ({ request }) => {
    const res = await request.patch(`${BASE_URL}/users/00000000-0000-4000-8000-000000000000`, {
      headers: auth,
      data: { displayName: 'X' },
    });
    expect(res.status()).toBe(404);
  });
});
