## GitHub Repository
🔗 https://github.com/hussainali04/timeoff-microservice

# Time-Off Microservice (NestJS + SQLite)

Production-grade REST API for managing employee time-off requests while keeping leave balances in sync with an external HCM (e.g., Workday/SAP). The HCM is the source of truth for balances and may change independently of this service (anniversary grants, year resets, manual adjustments). This service caches balances locally for performance, validates availability before reserving days, and reconciles/flags mismatches for manual review.

## Architecture overview

- **NestJS REST API**: `src/` with modules for balances, requests, audit, auth, and HCM integration.
- **SQLite + TypeORM**: local cache for balances and authoritative request state.
- **HCM integration**: `axios` via `@nestjs/axios` against `HCM_BASE_URL`.
- **Security**: JWT (Passport) for all endpoints except `/hcm/batch-sync` which is protected by `x-hcm-api-key`.
- **Reliability**: background retry job for `pending_hcm_confirmation` using `@nestjs/schedule`.
- **Auditability**: immutable `audit_log` table, exposed via `GET /audit`.

## Prerequisites

- Node.js **v18+**
- npm

## Installation

```bash
npm install
```

## Run the mock HCM server

In one terminal:

```bash
cd mock-hcm
npm install
node server.js
```

Mock HCM listens on `http://localhost:3001`.

## Run the main application

In a second terminal:

```bash
npm run start:dev
```

API listens on `http://localhost:3000` by default.

## Run unit tests

```bash
npm test
```

## Run e2e tests

```bash
npm run test:e2e
```

## Coverage report

```bash
npm run test:cov
```

Open `coverage/lcov-report/index.html`.

## Environment variables

| Variable | Description | Default |
| --- | --- | --- |
| `PORT` | API port | `3000` |
| `JWT_SECRET` | HS256 signing secret | required |
| `HCM_SYNC_API_KEY` | API key for `/hcm/batch-sync` | required |
| `HCM_BASE_URL` | Base URL of HCM | `http://localhost:3001` |
| `BALANCE_TTL_MINUTES` | TTL for cached balances | `60` |
| `DB_PATH` | SQLite database file path | `./database.sqlite` |

## API endpoints (examples)

### Auth

All endpoints require `Authorization: Bearer <jwt>` with payload:

```json
{ "sub": "emp_123", "role": "employee" }
```

### Balances

- `GET /balances/:employeeId`

```bash
curl -H "Authorization: Bearer <jwt>" http://localhost:3000/balances/emp_123
```

- `GET /balances/:employeeId/:locationId/:leaveType`

```bash
curl -H "Authorization: Bearer <jwt>" http://localhost:3000/balances/emp_123/loc_nyc/annual
```

### HCM batch sync (no JWT)

- `POST /hcm/batch-sync`

```bash
curl -X POST http://localhost:3000/hcm/batch-sync \
  -H "Content-Type: application/json" \
  -H "x-hcm-api-key: hcm-secret-key-456" \
  -d '{"records":[{"employeeId":"emp_123","locationId":"loc_nyc","leaveType":"annual","totalDays":20}]}'
```

### Requests

- `POST /requests`

```bash
curl -X POST http://localhost:3000/requests \
  -H "Authorization: Bearer <employee-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"employeeId":"emp_123","locationId":"loc_nyc","leaveType":"annual","startDate":"2026-06-01","endDate":"2026-06-02","daysRequested":2}'
```

- `PATCH /requests/:id/approve` (manager role)

```bash
curl -X PATCH http://localhost:3000/requests/<id>/approve \
  -H "Authorization: Bearer <manager-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"managerId":"mgr_1","managerNote":"approved"}'
```

- `PATCH /requests/:id/reject` (manager role)

```bash
curl -X PATCH http://localhost:3000/requests/<id>/reject \
  -H "Authorization: Bearer <manager-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"managerId":"mgr_1","managerNote":"rejected"}'
```

- `PATCH /requests/:id/cancel` (employee)

```bash
curl -X PATCH http://localhost:3000/requests/<id>/cancel \
  -H "Authorization: Bearer <employee-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"employeeId":"emp_123"}'
```

### Audit

- `GET /audit?entityId=<id>`

```bash
curl -H "Authorization: Bearer <jwt>" "http://localhost:3000/audit?entityId=<request-or-balance-id>"
```

## Folder structure

- `src/`: application source (modules, entities, services, guards, filters)
- `mock-hcm/`: standalone Express mock HCM server
- `test/`: e2e tests and e2e setup

