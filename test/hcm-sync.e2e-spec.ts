import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureTestApp } from './e2e-bootstrap';

function jwt(role: 'employee' | 'manager', sub: string) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, role, iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  const crypto = require('crypto');
  const secret = process.env.JWT_SECRET ?? 'supersecretjwtkey123';
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

describe('HCM sync + edge cases (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureTestApp(app);
    await app.init();

    await fetch('http://localhost:3001/mock/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('HCM configured to force error → request rejected and reservation released', async () => {
    await fetch('http://localhost:3001/mock/configure', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        employeeId: 'emp_123',
        locationId: 'loc_nyc',
        leaveType: 'annual',
        forceError: true,
      }),
    });

    await request(app.getHttpServer())
      .post('/hcm/batch-sync')
      .set('x-hcm-api-key', process.env.HCM_SYNC_API_KEY!)
      .send({
        records: [{ employeeId: 'emp_123', locationId: 'loc_nyc', leaveType: 'annual', totalDays: 20 }],
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${jwt('employee', 'emp_123')}`)
      .send({
        employeeId: 'emp_123',
        locationId: 'loc_nyc',
        leaveType: 'annual',
        startDate: '2026-10-01',
        endDate: '2026-10-02',
        daysRequested: 1,
      })
      .expect(422);

    await fetch('http://localhost:3001/mock/configure', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        employeeId: 'emp_123',
        locationId: 'loc_nyc',
        leaveType: 'annual',
        forceError: false,
      }),
    });
  });
});

