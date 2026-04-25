import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

let proc: ReturnType<typeof spawn> | null = null;

async function waitForMockHcm(): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://localhost:3001/mock/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) return;
    } catch {
      // ignore and retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Mock HCM did not become ready on port 3001');
}

beforeAll(async () => {
  const dbPath = `./database.test.${process.pid}.sqlite`;
  process.env.DB_PATH = dbPath;
  process.env.PORT = '0';
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'supersecretjwtkey123';
  process.env.HCM_BASE_URL = process.env.HCM_BASE_URL ?? 'http://localhost:3001';
  process.env.HCM_SYNC_API_KEY = process.env.HCM_SYNC_API_KEY ?? 'hcm-secret-key-456';
  process.env.BALANCE_TTL_MINUTES = process.env.BALANCE_TTL_MINUTES ?? '60';

  try {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  } catch {
    // ignore
  }

  const serverPath = path.join(__dirname, '..', 'mock-hcm', 'server.js');
  proc = spawn(process.execPath, [serverPath], {
    stdio: 'ignore',
    env: process.env,
  });

  await waitForMockHcm();
});

afterAll(async () => {
  if (proc) {
    proc.kill();
    proc = null;
  }
});

