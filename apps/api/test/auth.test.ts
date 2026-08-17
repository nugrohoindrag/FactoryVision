import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { integrationSuite } from './describe-integration.js';
import { addUser, seedTenant, startTestApp, type TestApp } from './harness.js';

/**
 * Gate B1 — the whole way in, plus the negative tests that matter more than the
 * positive ones.
 *
 * The tenant-isolation cases here are not "does tenant A see its own data" but
 * "does tenant A fail to see tenant B's". That asymmetry is the point: the
 * first passes on a system with no isolation at all.
 */
await integrationSuite('auth & tenancy (B-013 → B-024)', () => {
  let test: TestApp;

  beforeAll(async () => {
    test = await startTestApp();
  });
  afterAll(async () => {
    await test.close();
  });
  beforeEach(async () => {
    await test.reset();
  });

  it('registers a factory with three fields and signs in immediately (B-013)', async () => {
    const response = await test.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        factoryName: 'Pabrik Roti Sejahtera',
        ownerName: 'Pak Budi',
        phone: '+628111000001',
        deviceId: crypto.randomUUID(),
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.user.role).toBe('OWNER');
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    // Signed in as part of registering: sending someone to hunt for a second
    // SMS is a second chance to walk away.
    expect(body.tenant.readOnly).toBe(false);
  });

  it('refuses a second account on the same phone number', async () => {
    const payload = {
      factoryName: 'A',
      ownerName: 'A',
      phone: '+628111000002',
      deviceId: crypto.randomUUID(),
    };
    await test.app.inject({ method: 'POST', url: '/api/auth/register', payload });
    const second = await test.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { ...payload, deviceId: crypto.randomUUID() },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('CONFLICT');
  });

  it('does not reveal whether a phone number has an account (B-014)', async () => {
    const unknown = await test.app.inject({
      method: 'POST',
      url: '/api/auth/otp/request',
      payload: { phone: '+628999999999' },
    });
    // Same answer either way — otherwise this endpoint is a directory of which
    // factories use the product.
    expect(unknown.statusCode).toBe(201);
    expect(unknown.json().sent).toBe(true);
  });

  it('locks out after three wrong codes and says how long (B-014)', async () => {
    const phone = '+628111000003';
    await seedTenant(test, { phone });
    await test.app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { phone } });

    const attempt = (code: string) =>
      test.app.inject({
        method: 'POST',
        url: '/api/auth/otp/verify',
        payload: { phone, code, deviceId: crypto.randomUUID() },
      });

    const first = await attempt('000000');
    const second = await attempt('111111');
    const third = await attempt('222222');

    expect(first.json().error.code).toBe('OTP_INVALID');
    expect(second.json().error.code).toBe('OTP_INVALID');
    expect(third.json().error.code).toBe('OTP_LOCKED');
    // PRD F13.1: the message names the wait. "Invalid code" leaves an operator
    // tapping the same digits at the receiving door while a truck waits.
    expect(third.json().error.message).toMatch(/15 minutes/);
    expect(third.json().error.details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('signs in from a second device and keeps both sessions (B-016, B-017)', async () => {
    const tenant = await seedTenant(test, { phone: '+628111000004' });
    const operator = await addUser(test, tenant, 'OPERATOR');

    const owner = await test.app.inject({ method: 'GET', url: '/api/auth/me', headers: tenant.auth });
    const other = await test.app.inject({ method: 'GET', url: '/api/auth/me', headers: operator.auth });

    expect(owner.statusCode).toBe(200);
    expect(other.statusCode).toBe(200);
    expect(other.json().user.role).toBe('OPERATOR');
  });

  it('refuses a device id already registered to someone else (B-017)', async () => {
    const tenantA = await seedTenant(test, { phone: '+628111000005' });
    const phoneB = '+628111000006';
    await seedTenant(test, { phone: phoneB, factoryName: 'Pabrik Lain' });

    await test.app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { phone: phoneB } });
    const otp = await test.prisma.otpRequest.findFirst({
      where: { phone: phoneB, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(otp).toBeTruthy();

    const { createHash } = await import('node:crypto');
    let code = '';
    for (let i = 0; i < 1_000_000; i += 1) {
      const candidate = String(i).padStart(6, '0');
      if (createHash('sha256').update(`${phoneB}:${candidate}`).digest('hex') === otp!.codeHash) {
        code = candidate;
        break;
      }
    }

    const response = await test.app.inject({
      method: 'POST',
      url: '/api/auth/otp/verify',
      // Tenant A's device id, tenant B's phone. Re-issuing it would hand one
      // person's hash chain to another.
      payload: { phone: phoneB, code, deviceId: tenantA.deviceId },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('DEVICE_UNKNOWN');
  });

  it('rotates refresh tokens and kills the chain on replay (B-016)', async () => {
    const tenant = await seedTenant(test, { phone: '+628111000007' });
    const register = await test.prisma.session.findFirst({ where: { tenantId: tenant.tenantId } });
    expect(register).toBeTruthy();

    const login = await test.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        factoryName: 'X',
        ownerName: 'X',
        phone: '+628111000008',
        deviceId: crypto.randomUUID(),
      },
    });
    const refreshToken = login.json().refreshToken as string;

    const first = await test.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken },
    });
    expect(first.statusCode).toBe(201);

    // The same token a second time is either a stale client or a stolen one.
    const replay = await test.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken },
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe('SESSION_EXPIRED');
  });

  it('blocks a revoked device before its access token expires (B-017)', async () => {
    const tenant = await seedTenant(test, { phone: '+628111000009' });
    const operator = await addUser(test, tenant, 'OPERATOR');

    await test.app.inject({
      method: 'POST',
      url: `/api/users/devices/${operator.deviceId}/revoke`,
      headers: tenant.auth,
    });

    const response = await test.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: operator.auth,
    });
    // "Sign this device out" must not mean "in an hour".
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('DEVICE_UNKNOWN');
  });

  it('refuses an action the role does not have (B-018)', async () => {
    const tenant = await seedTenant(test, { phone: '+628111000010' });
    const operator = await addUser(test, tenant, 'OPERATOR');

    const response = await test.app.inject({
      method: 'GET',
      url: '/api/users',
      headers: operator.auth,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('ROLE_NOT_PERMITTED');
  });

  it('keeps the last owner (B-020)', async () => {
    const tenant = await seedTenant(test, { phone: '+628111000011' });
    const response = await test.app.inject({
      method: 'PATCH',
      url: `/api/users/${tenant.ownerId}`,
      headers: tenant.auth,
      payload: { role: 'OPERATOR' },
    });
    // A factory with no owner has nobody who can approve a stock take.
    expect(response.statusCode).toBe(409);
  });

  it('NEGATIVE: one tenant cannot read another tenant users (B-024)', async () => {
    const tenantA = await seedTenant(test, { phone: '+628111000012', factoryName: 'A' });
    const tenantB = await seedTenant(test, { phone: '+628111000013', factoryName: 'B' });
    await addUser(test, tenantB, 'OPERATOR');

    const response = await test.app.inject({ method: 'GET', url: '/api/users', headers: tenantA.auth });
    expect(response.statusCode).toBe(200);

    const ids = (response.json() as { id: string }[]).map((u) => u.id);
    expect(ids).toContain(tenantA.ownerId);
    expect(ids).not.toContain(tenantB.ownerId);
    expect(ids).toHaveLength(1);
  });

  it('NEGATIVE: one tenant cannot revoke another tenant device (B-024)', async () => {
    const tenantA = await seedTenant(test, { phone: '+628111000014', factoryName: 'A' });
    const tenantB = await seedTenant(test, { phone: '+628111000015', factoryName: 'B' });

    const response = await test.app.inject({
      method: 'POST',
      url: `/api/users/devices/${tenantB.deviceId}/revoke`,
      headers: tenantA.auth,
    });
    expect(response.statusCode).toBe(201);

    // The call "succeeds" and changes nothing, because the tenant filter turned
    // it into a no-op. Tenant B's device is still signed in.
    const stillWorks = await test.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: tenantB.auth,
    });
    expect(stillWorks.statusCode).toBe(200);
  });

  it('turns writes off but leaves reads on when the trial ends (B-021)', async () => {
    const tenant = await seedTenant(test, { phone: '+628111000016' });
    await test.prisma.tenant.update({
      where: { id: tenant.tenantId },
      data: { trialEndsAt: new Date(Date.now() - 86_400_000) },
    });

    const read = await test.app.inject({ method: 'GET', url: '/api/users', headers: tenant.auth });
    expect(read.statusCode).toBe(200);

    const write = await test.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: tenant.auth,
      payload: { name: 'Baru', phone: '+628111000017', role: 'OPERATOR' },
    });
    expect(write.statusCode).toBe(402);
    expect(write.json().error.code).toBe('TRIAL_READ_ONLY');
    // Withholding a customer's own data is the fastest way to lose trust —
    // Prinsip 8 applies to the ones who have not paid yet too.
    expect(write.json().error.message).toMatch(/read and export/);
  });

  it('answers health and ready without a token (B-010)', async () => {
    const health = await test.app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json().status).toBe('ok');

    const ready = await test.app.inject({ method: 'GET', url: '/ready' });
    expect(ready.json().status).toBe('ready');
    expect(ready.json().checks.database.ok).toBe(true);
    expect(ready.json().checks.clock.ok).toBe(true);
  });

  it('refuses phone-only sign-in unless AUTH_SKIP_OTP is set', async () => {
    const phone = '+628111000042';
    await seedTenant(test, { phone });

    // This app runs with the flag off, which is the default everywhere the
    // trial is not deliberately configured.
    const response = await test.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { phone, deviceId: crypto.randomUUID() },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.message).toMatch(/not enabled/);
  });

  it('refuses an unauthenticated request everywhere else', async () => {
    const response = await test.app.inject({ method: 'GET', url: '/api/users' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHENTICATED');
  });
});

/**
 * The trial's phone-only sign-in (AUTH_SKIP_OTP).
 *
 * Its own app, because a flag that changes behaviour cannot be proved by the
 * default one: the suite above can only ever show what happens with it off.
 * Both halves matter — that it works when asked for, and that it is not quietly
 * available when it is not.
 */
await integrationSuite('trial sign-in without a code (AUTH_SKIP_OTP)', () => {
  let test: TestApp;

  beforeAll(async () => {
    test = await startTestApp({ AUTH_SKIP_OTP: true });
  });
  afterAll(async () => {
    await test.close();
  });
  beforeEach(async () => {
    await test.reset();
  });

  it('issues a full session from a phone number alone', async () => {
    const phone = '+628999000111';
    await seedTenant(test, { phone });

    const response = await test.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { phone, deviceId: crypto.randomUUID(), deviceLabel: 'demo phone' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    // The same session shape the OTP path returns — a demo that signs in
    // differently but receives something lesser would prove nothing about the
    // real flow.
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.user.role).toBe('OWNER');

    // And it is a working session, not just a well-formed one.
    const me = await test.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.id).toBe(body.user.id);
  });

  it('says nothing about whether an unknown number has an account', async () => {
    const response = await test.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { phone: '+628999000222', deviceId: crypto.randomUUID() },
    });

    expect(response.statusCode).toBe(401);
    // Identical to the message a deactivated account gets. A login that
    // distinguishes the two is a login that enumerates customers.
    expect(response.json().error.message).toMatch(/no longer active/);
  });
});
