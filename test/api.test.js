import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

const basic = (username = 'demo@example.com', password = 'Demo12345!') => `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
const seedId = '00000000-0000-4000-8000-000000000001';
async function setup(t) {
  const app = await buildApp();
  t.after(() => app.close());
  return app;
}
async function oauth(app, scope = 'users:read users:write') {
  return app.inject({ method: 'POST', url: '/oauth/token', headers: {
    authorization: basic('postman-demo', 'demo-client-secret'),
    'content-type': 'application/x-www-form-urlencoded',
  }, payload: new URLSearchParams({ grant_type: 'client_credentials', scope }).toString() });
}

test('CRUD completo, duplicados, validacion y respuestas sin password', async t => {
  const app = await setup(t);
  const headers = { authorization: basic() };
  const payload = { name: 'Ana', email: 'ANA@example.com', password: 'Password123!' };
  const created = await app.inject({ method: 'POST', url: '/users', payload });
  assert.equal(created.statusCode, 201);
  const user = created.json();
  assert.equal(user.email, 'ana@example.com');
  assert.equal(created.headers.location, `/users/${user.id}`);
  assert.ok(!('password' in user) && !('passwordHash' in user));
  assert.equal((await app.inject({ method: 'POST', url: '/users', payload })).statusCode, 409);
  for (const body of [{ ...payload, email: 'bad' }, { ...payload, password: 'short' }, { ...payload, name: '   ' }, { ...payload, role: 'admin' }]) {
    assert.equal((await app.inject({ method: 'POST', url: '/users', payload: body })).statusCode, 400);
  }
  const list = await app.inject({ url: '/users', headers });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().length, 2);
  assert.ok(!list.body.includes('password'));
  assert.equal((await app.inject({ url: `/users/${user.id}`, headers })).statusCode, 200);
  assert.equal((await app.inject({ method: 'PATCH', url: `/users/${user.id}`, headers, payload: {} })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PATCH', url: `/users/${user.id}`, headers, payload: { email: 'DEMO@example.com' } })).statusCode, 409);
  const updated = await app.inject({ method: 'PATCH', url: `/users/${user.id}`, headers, payload: { name: 'Ana actualizada', password: 'Updated123!' } });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().name, 'Ana actualizada');
  assert.equal((await app.inject({ url: '/users', headers: { authorization: basic(user.email, 'Password123!') } })).statusCode, 401);
  assert.equal((await app.inject({ url: '/users', headers: { authorization: basic(user.email, 'Updated123!') } })).statusCode, 200);
  const deleted = await app.inject({ method: 'DELETE', url: `/users/${user.id}`, headers });
  assert.equal(deleted.statusCode, 204);
  assert.equal(deleted.body, '');
  for (const method of ['GET', 'PATCH', 'DELETE']) {
    assert.equal((await app.inject({ method, url: `/users/${user.id}`, headers, ...(method === 'PATCH' ? { payload: { name: 'Ana' } } : {}) })).statusCode, 404);
  }
});

test('Basic Auth y JWT: credenciales, firma, expiracion y usuario eliminado', async t => {
  const app = await setup(t);
  for (const authorization of [undefined, basic('demo@example.com', 'incorrect'), 'Bearer invalid', 'Basic !!!']) {
    const result = await app.inject({ url: '/users', headers: authorization ? { authorization } : {} });
    assert.equal(result.statusCode, 401);
    assert.ok(result.headers['www-authenticate']);
  }
  const badLogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'demo@example.com', password: 'Incorrect123' } });
  assert.equal(badLogin.statusCode, 401);
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'demo@example.com', password: 'Demo12345!' } });
  assert.equal(login.statusCode, 200);
  assert.equal(login.json().expires_in, 900);
  const token = login.json().access_token;
  const headers = { authorization: `Bearer ${token}` };
  assert.equal((await app.inject({ url: '/users', headers })).statusCode, 200);
  const expired = app.jwt.sign({ sub: seedId, kind: 'user' }, { expiresIn: -1 });
  for (const badToken of [token + 'tampered', expired]) {
    assert.equal((await app.inject({ url: '/users', headers: { authorization: `Bearer ${badToken}` } })).statusCode, 401);
  }
  assert.equal((await app.inject({ method: 'DELETE', url: `/users/${seedId}`, headers })).statusCode, 204);
  assert.equal((await app.inject({ url: '/users', headers })).statusCode, 401);
});

test('OAuth2: cliente, grant, scopes y CRUD con token opaco', async t => {
  const app = await setup(t);
  const formHeaders = { authorization: basic('postman-demo', 'demo-client-secret'), 'content-type': 'application/x-www-form-urlencoded' };
  for (const [payload, status] of [['grant_type=password', 400], ['grant_type=client_credentials&scope=admin', 400]]) {
    const response = await app.inject({ method: 'POST', url: '/oauth/token', headers: formHeaders, payload });
    assert.equal(response.statusCode, status);
  }
  assert.equal((await app.inject({ method: 'POST', url: '/oauth/token', headers: { ...formHeaders, authorization: basic('wrong', 'wrong') }, payload: 'grant_type=client_credentials' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/oauth/token', headers: { authorization: formHeaders.authorization }, payload: { grant_type: 'client_credentials' } })).statusCode, 415);
  const readToken = await oauth(app, 'users:read');
  assert.equal(readToken.statusCode, 200);
  assert.equal(readToken.headers['cache-control'], 'no-store');
  const headers = { authorization: `Bearer ${readToken.json().access_token}` };
  assert.equal((await app.inject({ url: '/users', headers })).statusCode, 200);
  const forbidden = await app.inject({ method: 'DELETE', url: `/users/${seedId}`, headers });
  assert.equal(forbidden.statusCode, 403);
  assert.match(forbidden.headers['www-authenticate'], /insufficient_scope/);
  const writeToken = await oauth(app, 'users:write');
  const writeHeaders = { authorization: `Bearer ${writeToken.json().access_token}` };
  assert.equal((await app.inject({ url: '/users', headers: writeHeaders })).statusCode, 403);
  assert.equal((await app.inject({ method: 'PATCH', url: `/users/${seedId}`, headers: writeHeaders, payload: { name: 'OAuth Demo' } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'DELETE', url: `/users/${seedId}`, headers: writeHeaders })).statusCode, 204);
});

test('OpenAPI y Swagger exponen operaciones y los tres esquemas de seguridad', async t => {
  const app = await setup(t);
  assert.equal((await app.inject('/health')).json().status, 'ok');
  assert.equal((await app.inject('/docs/')).statusCode, 200);
  const spec = (await app.inject('/openapi.json')).json();
  assert.equal(spec.openapi, '3.0.3');
  assert.deepEqual(Object.keys(spec.components.securitySchemes).sort(), ['basicAuth', 'bearerAuth', 'oauth2']);
  assert.equal(spec.paths['/users'].get.security.length, 3);
  assert.deepEqual(spec.paths['/users'].post.security, []);
  assert.ok(spec.paths['/users/{id}'].delete.responses['204']);
  assert.ok(spec.paths['/oauth/token'].post.requestBody.content['application/x-www-form-urlencoded']);
  assert.equal((await app.inject({ url: '/users/not-a-uuid', headers: { authorization: basic() } })).statusCode, 400);
});
