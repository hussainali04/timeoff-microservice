const express = require('express');

const app = express();
app.use(express.json());

const DEFAULTS = {
  emp_123: {
    loc_nyc: { annual: 20, sick: 10, personal: 5 },
  },
  emp_456: {
    loc_lax: { annual: 15, sick: 10, personal: 3 },
  },
};

let store = JSON.parse(JSON.stringify(DEFAULTS));
let forcedErrors = new Map(); // key -> boolean

function key(employeeId, locationId, leaveType) {
  return `${employeeId}::${locationId}::${leaveType}`;
}

function ensure(employeeId, locationId) {
  if (!store[employeeId]) store[employeeId] = {};
  if (!store[employeeId][locationId]) store[employeeId][locationId] = {};
}

function getBalance(employeeId, locationId, leaveType) {
  const v = store?.[employeeId]?.[locationId]?.[leaveType];
  return typeof v === 'number' ? v : 0;
}

app.get('/hcm/balance/:employeeId/:locationId/:leaveType', (req, res) => {
  const { employeeId, locationId, leaveType } = req.params;
  if (forcedErrors.get(key(employeeId, locationId, leaveType))) {
    return res.status(500).json({ message: 'Forced error' });
  }
  const balance = getBalance(employeeId, locationId, leaveType);
  return res.json({ employeeId, locationId, leaveType, balance });
});

app.post('/hcm/balance/deduct', (req, res) => {
  const { employeeId, locationId, leaveType, days } = req.body || {};
  if (!employeeId || !locationId || !leaveType || typeof days !== 'number') {
    return res.status(400).json({ message: 'Invalid body' });
  }
  if (forcedErrors.get(key(employeeId, locationId, leaveType))) {
    return res.status(422).json({ message: 'Forced error' });
  }
  ensure(employeeId, locationId);
  const current = getBalance(employeeId, locationId, leaveType);
  if (current < days) {
    return res.status(422).json({ message: 'Insufficient balance' });
  }
  store[employeeId][locationId][leaveType] = Number((current - days).toFixed(4));
  return res.json({ ok: true, referenceId: `hcm_ref_${Date.now()}` });
});

app.post('/hcm/balance/restore', (req, res) => {
  const { employeeId, locationId, leaveType, days } = req.body || {};
  if (!employeeId || !locationId || !leaveType || typeof days !== 'number') {
    return res.status(400).json({ message: 'Invalid body' });
  }
  if (forcedErrors.get(key(employeeId, locationId, leaveType))) {
    return res.status(422).json({ message: 'Forced error' });
  }
  ensure(employeeId, locationId);
  const current = getBalance(employeeId, locationId, leaveType);
  store[employeeId][locationId][leaveType] = Number((current + days).toFixed(4));
  return res.json({ ok: true });
});

app.post('/mock/configure', (req, res) => {
  const { employeeId, locationId, leaveType, balance, forceError } = req.body || {};
  if (!employeeId || !locationId || !leaveType) {
    return res.status(400).json({ message: 'Invalid body' });
  }
  ensure(employeeId, locationId);
  if (typeof balance === 'number') {
    store[employeeId][locationId][leaveType] = balance;
  }
  forcedErrors.set(key(employeeId, locationId, leaveType), Boolean(forceError));
  return res.json({ ok: true });
});

app.post('/mock/reset', (_req, res) => {
  store = JSON.parse(JSON.stringify(DEFAULTS));
  forcedErrors = new Map();
  return res.json({ ok: true });
});

app.listen(3001, () => {
  // eslint-disable-next-line no-console
  console.log('Mock HCM listening on http://localhost:3001');
});

