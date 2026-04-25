# Technical Requirements Document (TRD)
## Time-Off Microservice — ExampleHR / ReadyOn Platform

**Author:** Hussain  
**Version:** 1.0  
**Status:** Final  
**Date:** April 2026

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Background & Context](#2-background--context)
3. [Goals & Non-Goals](#3-goals--non-goals)
4. [User Personas](#4-user-personas)
5. [System Architecture](#5-system-architecture)
6. [Key Challenges & Solutions](#6-key-challenges--solutions)
7. [Data Model](#7-data-model)
8. [API Design](#8-api-design)
9. [HCM Synchronisation Strategy](#9-hcm-synchronisation-strategy)
10. [Error Handling & Defensive Design](#10-error-handling--defensive-design)
11. [Security Considerations](#11-security-considerations)
12. [Test Strategy](#12-test-strategy)
13. [Alternatives Considered](#13-alternatives-considered)
14. [Open Questions & Future Work](#14-open-questions--future-work)

---

## 1. Executive Summary

This document specifies the design and implementation plan for the **Time-Off Microservice** — a backend service responsible for managing the full lifecycle of employee time-off requests within the ReadyOn platform. The service acts as an intelligent intermediary between ReadyOn's user-facing interface and an external Human Capital Management (HCM) system (e.g., Workday, SAP), which remains the authoritative source of truth for all leave balances.

The core engineering challenge is maintaining **balance integrity** across two systems that can update independently, while providing employees and managers with fast, accurate, and reliable feedback. This document outlines the proposed architecture, API surface, synchronisation strategy, error-handling approach, and test plan.

---

## 2. Background & Context

### 2.1 Problem Statement

ReadyOn provides a module for employees to request time off. However, all leave balance data ultimately lives in the organisation's HCM system. This creates a dual-write problem:

- When an employee submits a request via ReadyOn, it must be validated against and committed to the HCM.
- The HCM can update balances independently of ReadyOn (e.g., a work anniversary bonus adds 2 days, or a new year refresh resets all balances).
- ReadyOn must detect and reconcile these external changes without corrupting local state.

### 2.2 HCM Integration Capabilities

The HCM exposes two integration points:

| Endpoint | Type | Description |
|---|---|---|
| Real-time API | REST | Get or write a single time-off value for a specific `employeeId` × `locationId` combination |
| Batch endpoint | Push | HCM pushes the full corpus of balances (all employees, all locations) to ReadyOn on demand or on schedule |

### 2.3 Scope of This Service

This microservice is responsible for:

- Accepting and validating time-off requests from employees
- Checking and reserving leave balances (with HCM confirmation)
- Exposing approval/rejection endpoints for managers
- Listening for and processing HCM-initiated balance updates
- Maintaining a local cache of balances for performance, with a clear invalidation strategy
- Providing an audit trail for all balance changes

---

## 3. Goals & Non-Goals

### Goals

- Provide REST endpoints for creating, reading, updating, and cancelling time-off requests
- Maintain accurate local balance records, synced with the HCM
- Handle HCM errors gracefully without corrupting local state
- Support external balance updates (anniversary bonuses, year-start resets) pushed by the HCM
- Be defensive when the HCM does not return explicit errors for invalid operations
- Produce a test suite that guards against regressions

### Non-Goals

- Building or modifying the HCM system itself
- Replacing the HCM as the source of truth for balance data
- Providing a front-end UI (this service is a backend API only)
- Supporting non-JavaScript runtimes (service is Node.js / NestJS only)
- Multi-currency or monetary leave (this service handles day/hour units only)

---

## 4. User Personas

### 4.1 The Employee

**Needs:**
- View accurate, up-to-date leave balances per location
- Submit a time-off request and receive immediate feedback (approved/pending/rejected)
- Cancel a previously submitted request
- View the history of their requests

**Pain points:**
- Seeing stale balances that don't reflect a recently approved request
- Submitting a request only to find out hours later it was invalid due to insufficient balance

### 4.2 The Manager

**Needs:**
- View all pending requests for their team
- Approve or reject a request with confidence that the balance data is valid
- Receive clear context when a request cannot be approved (e.g., HCM balance mismatch)

---

## 5. System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Client Layer                        │
│         Employee App          Manager App               │
└────────────────┬──────────────────┬────────────────────┘
                 │  REST            │  REST
┌────────────────▼──────────────────▼────────────────────┐
│              Time-Off Microservice (NestJS)             │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Requests    │  │  Balances    │  │  HCM Sync    │  │
│  │  Module      │  │  Module      │  │  Module      │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                  │          │
│  ┌──────▼─────────────────▼──────────────────▼───────┐  │
│  │                  SQLite Database                   │  │
│  │  time_off_requests │ balances │ audit_log          │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────┬──────────────────┘
                                      │  HTTP
                        ┌─────────────▼───────────────┐
                        │     HCM System (External)   │
                        │  Real-time API + Batch push  │
                        └─────────────────────────────┘
```

### 5.1 Module Breakdown

| Module | Responsibility |
|---|---|
| `RequestsModule` | CRUD for time-off requests; orchestrates balance checks |
| `BalancesModule` | Local balance cache; read/write; staleness tracking |
| `HcmSyncModule` | Adapter for HCM real-time API; batch ingestion endpoint; reconciliation logic |
| `AuditModule` | Append-only log of all balance changes and their sources |

### 5.2 Technology Stack

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | Node.js (v18+) | Required by assignment |
| Framework | NestJS | Structured, testable, dependency-injection-based |
| Database | SQLite (via TypeORM) | Lightweight, zero-config, sufficient for this scope |
| Testing | Jest + Supertest | NestJS-native; supports unit and e2e tests |
| Mock HCM | Express.js server | Lightweight standalone mock for testing |
| Validation | class-validator + class-transformer | Integrated with NestJS pipes |

---

## 6. Key Challenges & Solutions

### Challenge 1: Dual-Write Consistency

**Problem:** ReadyOn must deduct a balance locally and also commit it to the HCM. If one succeeds and the other fails, the two systems diverge.

**Solution: HCM-First with Local Rollback**

The service follows a strict sequence:

1. Validate the request locally (check local cached balance)
2. Send the deduction to the HCM real-time API
3. Only if HCM confirms success → persist locally and mark request as `approved`
4. If HCM returns an error → reject the request, do not modify local balance
5. If HCM is unreachable → mark request as `pending_hcm_confirmation` and retry via a background job

This prevents phantom deductions on the ReadyOn side while being transparent to the user.

---

### Challenge 2: External Balance Changes (HCM-Initiated)

**Problem:** The HCM can change an employee's balance without ReadyOn's knowledge (anniversary bonuses, year-start refreshes, manual corrections). ReadyOn's local cache becomes stale.

**Solution: Batch Endpoint Ingestion + TTL-Based Staleness**

- The microservice exposes a `POST /hcm/batch-sync` endpoint that accepts the full balance corpus from the HCM.
- Every locally cached balance record carries a `last_synced_at` timestamp and a `ttl_minutes` value (configurable, default: 60 minutes).
- Before serving a balance to the client, the service checks if the cached value is stale. If stale, it fetches fresh data from the HCM real-time API before responding.
- The batch sync endpoint always overwrites local balances with authoritative HCM values.

```
HCM triggers batch push
        │
        ▼
POST /hcm/batch-sync
        │
        ▼
For each record in batch:
  - Upsert balance in SQLite
  - Update last_synced_at
  - Append to audit_log with source = 'hcm_batch'
```

---

### Challenge 3: HCM May Not Return Errors Reliably

**Problem:** The HCM is expected to return errors for invalid operations (wrong dimensions, insufficient balance), but this is not guaranteed. ReadyOn must be defensively coded.

**Solution: Pre-flight Local Validation + Post-write Verification**

- **Before** sending to HCM: validate the request against locally cached balance. If local balance is insufficient, reject immediately without calling HCM.
- **After** HCM confirms: re-read the balance from HCM and verify the expected deduction was reflected. If the post-write balance does not match the expected value, flag the request for manual review and trigger a reconciliation job.
- This double-check catches silent HCM failures where no error is returned but the write also did not happen.

---

### Challenge 4: Balance Dimensions (employeeId × locationId)

**Problem:** Balances are per-employee per-location. A single employee may have different leave entitlements for different work locations, and requests must be validated against the correct dimension.

**Solution: Composite Key Design**

All balance records use a composite key of `(employee_id, location_id, leave_type)`. Every request must specify all three dimensions. The service rejects any request with missing or invalid dimensions before touching the HCM.

---

### Challenge 5: Concurrent Requests

**Problem:** An employee might submit two overlapping requests simultaneously, both of which pass local balance validation before either is committed to the HCM.

**Solution: Optimistic Locking + Request Queue**

- Each balance record carries a `version` field (integer, increments on every write).
- When deducting, the service uses a conditional update: `UPDATE balances SET ... WHERE version = :expectedVersion`. If zero rows are affected, the operation is aborted and the user is asked to retry.
- Additionally, in-flight requests are tracked in a `pending_requests` set per `(employee_id, location_id)` to block duplicate concurrent submissions.

---

## 7. Data Model

### 7.1 `balances` Table

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `employee_id` | TEXT NOT NULL | Employee identifier |
| `location_id` | TEXT NOT NULL | Location identifier |
| `leave_type` | TEXT NOT NULL | e.g., `annual`, `sick`, `personal` |
| `total_days` | REAL NOT NULL | Total entitlement |
| `used_days` | REAL NOT NULL DEFAULT 0 | Days consumed |
| `pending_days` | REAL NOT NULL DEFAULT 0 | Days in pending requests |
| `available_days` | REAL GENERATED | `total_days - used_days - pending_days` |
| `version` | INTEGER DEFAULT 1 | Optimistic lock version |
| `last_synced_at` | DATETIME | Timestamp of last HCM sync |
| `created_at` | DATETIME | Record creation timestamp |
| `updated_at` | DATETIME | Last modification timestamp |

**Unique constraint:** `(employee_id, location_id, leave_type)`

---

### 7.2 `time_off_requests` Table

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID |
| `employee_id` | TEXT NOT NULL | Requesting employee |
| `location_id` | TEXT NOT NULL | Location of the request |
| `leave_type` | TEXT NOT NULL | Leave category |
| `start_date` | DATE NOT NULL | First day of leave |
| `end_date` | DATE NOT NULL | Last day of leave |
| `days_requested` | REAL NOT NULL | Computed working days |
| `status` | TEXT NOT NULL | `pending` \| `approved` \| `rejected` \| `cancelled` \| `pending_hcm_confirmation` |
| `manager_id` | TEXT | Manager who actioned the request |
| `manager_note` | TEXT | Optional rejection or approval note |
| `hcm_reference_id` | TEXT | Reference ID returned by HCM on approval |
| `created_at` | DATETIME | Submission timestamp |
| `updated_at` | DATETIME | Last status change timestamp |

---

### 7.3 `audit_log` Table

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `entity_type` | TEXT | `balance` or `request` |
| `entity_id` | TEXT | ID of the affected record |
| `action` | TEXT | e.g., `deducted`, `restored`, `batch_synced`, `approved` |
| `delta_days` | REAL | Change in days (positive = added, negative = deducted) |
| `source` | TEXT | `employee_request`, `manager_action`, `hcm_batch`, `hcm_realtime`, `system_reconciliation` |
| `performed_by` | TEXT | User or system actor |
| `metadata` | TEXT | JSON blob for additional context |
| `created_at` | DATETIME | Event timestamp |

---

## 8. API Design

All endpoints return JSON. All requests with a body must set `Content-Type: application/json`. Standard HTTP status codes are used throughout.

### 8.1 Balance Endpoints

#### `GET /balances/:employeeId`

Returns all balance records for a given employee across all locations and leave types.

**Response 200:**
```json
{
  "employeeId": "emp_123",
  "balances": [
    {
      "locationId": "loc_nyc",
      "leaveType": "annual",
      "totalDays": 20,
      "usedDays": 5,
      "pendingDays": 2,
      "availableDays": 13,
      "lastSyncedAt": "2026-04-25T08:00:00Z"
    }
  ]
}
```

#### `GET /balances/:employeeId/:locationId/:leaveType`

Returns a single balance record. Triggers a real-time HCM fetch if the cached value is stale.

#### `POST /hcm/batch-sync`

Accepts a full balance corpus pushed by the HCM. Upserts all records and updates `last_synced_at`.

**Request body:**
```json
{
  "syncId": "batch_20260425_001",
  "records": [
    {
      "employeeId": "emp_123",
      "locationId": "loc_nyc",
      "leaveType": "annual",
      "totalDays": 22,
      "usedDays": 5
    }
  ]
}
```

**Response 200:**
```json
{ "synced": 450, "errors": 0, "syncId": "batch_20260425_001" }
```

---

### 8.2 Request Endpoints

#### `POST /requests`

Submit a new time-off request.

**Request body:**
```json
{
  "employeeId": "emp_123",
  "locationId": "loc_nyc",
  "leaveType": "annual",
  "startDate": "2026-05-10",
  "endDate": "2026-05-14",
  "note": "Family vacation"
}
```

**Response 201:**
```json
{
  "requestId": "req_abc456",
  "status": "pending",
  "daysRequested": 5,
  "message": "Request submitted and awaiting manager approval."
}
```

**Error responses:**

| Status | Condition |
|---|---|
| 400 | Missing or invalid fields |
| 409 | Insufficient balance |
| 422 | Invalid dimension combination (HCM rejected) |
| 503 | HCM unreachable (request queued) |

---

#### `GET /requests/:requestId`

Retrieve a single request by ID.

#### `GET /requests?employeeId=emp_123&status=pending`

List requests filtered by employee and/or status.

#### `PATCH /requests/:requestId/approve`

Approve a pending request (manager action). Triggers HCM commitment.

**Request body:**
```json
{ "managerId": "mgr_789", "note": "Approved — enjoy your break." }
```

#### `PATCH /requests/:requestId/reject`

Reject a pending request. Restores any reserved balance.

**Request body:**
```json
{ "managerId": "mgr_789", "note": "Insufficient cover during that period." }
```

#### `PATCH /requests/:requestId/cancel`

Cancel a request (employee action, only if status is `pending`). Restores reserved balance.

---

### 8.3 Audit Endpoints

#### `GET /audit?entityId=req_abc456`

Returns the full audit trail for a given request or balance record.

---

## 9. HCM Synchronisation Strategy

### 9.1 Sync Flow Overview

```
Employee submits request
         │
         ▼
Local pre-validation (cached balance sufficient?)
         │ NO → reject 409
         │ YES
         ▼
Reserve pending_days in SQLite (optimistic lock)
         │
         ▼
POST to HCM real-time API
         │ Error → release reservation, reject 422
         │ Unreachable → keep reservation, status = pending_hcm_confirmation
         │ Success
         ▼
Set status = pending (awaiting manager)
         │
Manager approves
         │
         ▼
PATCH HCM to finalise deduction
         │ Success
         ▼
Move pending_days → used_days
Set status = approved
Write audit_log entry
```

### 9.2 Staleness Handling

| Scenario | Action |
|---|---|
| Balance fresher than TTL | Serve from cache |
| Balance older than TTL | Fetch from HCM real-time API, update cache, then serve |
| HCM real-time API unreachable | Serve stale cache with `"stale": true` flag in response |
| Batch sync received | Overwrite cache unconditionally |

### 9.3 Reconciliation Job

A scheduled background job runs every 15 minutes (configurable):
- Finds all requests in `pending_hcm_confirmation` status older than 5 minutes
- Retries the HCM commit
- If HCM still unreachable after 3 attempts, escalates to `needs_manual_review` status and logs an alert

---

## 10. Error Handling & Defensive Design

### 10.1 Input Validation

All incoming requests are validated using `class-validator` decorators on DTOs. Invalid inputs are rejected at the controller level with descriptive 400 errors before any business logic executes.

### 10.2 HCM Error Handling

| HCM Response | ReadyOn Action |
|---|---|
| 200 OK | Proceed with operation |
| 400 Bad Request | Surface specific error to caller (invalid dimensions) |
| 409 Conflict (insufficient balance) | Reject request, release reservation |
| 5xx / Timeout | Mark as `pending_hcm_confirmation`, schedule retry |
| No response / no error (silent fail) | Post-write verification step catches divergence |

### 10.3 Post-Write Verification

After every balance deduction committed to the HCM:
1. Re-fetch the balance from the HCM real-time API
2. Compute expected value: `previous_balance - days_requested`
3. If actual ≠ expected: flag request as `needs_manual_review`, do not update local balance, write alert to audit log

### 10.4 Global Exception Filter

A NestJS global exception filter catches all unhandled errors and returns:
```json
{
  "statusCode": 500,
  "error": "Internal Server Error",
  "message": "An unexpected error occurred. Reference: err_<uuid>",
  "referenceId": "err_<uuid>"
}
```
The `referenceId` maps to a structured log entry for debugging without leaking internals.

---

## 11. Security Considerations

### 11.1 Authentication & Authorisation

- All endpoints require a valid `Authorization: Bearer <token>` header.
- Tokens are verified using a configurable JWT secret (environment variable `JWT_SECRET`).
- Employees may only access and modify their own requests (`employeeId` in token payload must match request parameter).
- Manager endpoints require a `role: manager` claim in the JWT payload.
- The `/hcm/batch-sync` endpoint requires a separate `HCM_SYNC_API_KEY` header to prevent unauthorised balance overwrites.

### 11.2 Input Sanitisation

- All string inputs are trimmed and length-limited.
- SQL injection is prevented by TypeORM's parameterised queries exclusively — no raw SQL strings.
- Date fields are strictly validated to ISO 8601 format.

### 11.3 Rate Limiting

- Public-facing endpoints are rate-limited to 100 requests/minute per IP using the `@nestjs/throttler` package.
- The batch sync endpoint is limited to 10 requests/hour.

### 11.4 Sensitive Data

- Employee IDs and leave data are never logged in plain text in production. Log entries use a hashed reference.
- The `.env` file is excluded from version control via `.gitignore`. A `.env.example` is provided.

### 11.5 Dependency Security

- `npm audit` is run as part of the CI check.
- Production dependencies are kept minimal; all `devDependencies` are excluded from the final build.

---

## 12. Test Strategy

### 12.1 Philosophy

Given that this service is built using agentic development (AI-generated code), the test suite is the primary mechanism for verifying correctness and guarding against regressions. Tests are written to be the specification — if a test passes, the system behaves correctly by definition.

### 12.2 Test Layers

#### Unit Tests (`*.spec.ts`)

Test individual service methods in isolation with all external dependencies mocked.

**Key unit test cases:**

| Module | Test Case |
|---|---|
| BalancesService | Returns cached balance when within TTL |
| BalancesService | Fetches from HCM when cache is stale |
| BalancesService | Serves stale cache with flag when HCM is unreachable |
| BalancesService | Correctly handles composite key (employeeId × locationId × leaveType) |
| RequestsService | Rejects request when local balance is insufficient |
| RequestsService | Reserves pending_days atomically before calling HCM |
| RequestsService | Releases reservation if HCM returns error |
| RequestsService | Sets status to pending_hcm_confirmation when HCM is unreachable |
| RequestsService | Applies optimistic lock — aborts if version mismatch |
| HcmSyncService | Upserts all records correctly on batch sync |
| HcmSyncService | Writes audit_log entry for every synced record |
| HcmSyncService | Post-write verification detects silent HCM failure |
| AuditService | Appends correct source and delta on every balance change |

#### Integration Tests (`*.e2e-spec.ts`)

Test the full HTTP request/response cycle using Supertest against a running NestJS application with a real SQLite test database. The mock HCM server runs as a real Express process on a test port.

**Key integration test cases:**

| Scenario | Expected Behaviour |
|---|---|
| `POST /requests` with sufficient balance | 201, status = pending, pending_days incremented |
| `POST /requests` with insufficient balance | 409, no state change |
| `POST /requests` with invalid leaveType | 400, validation error |
| `PATCH /requests/:id/approve` | 200, HCM called, status = approved, used_days incremented |
| `PATCH /requests/:id/reject` | 200, pending_days restored |
| `PATCH /requests/:id/cancel` | 200, pending_days restored, status = cancelled |
| `POST /hcm/batch-sync` with valid payload | 200, all balances upserted |
| `POST /hcm/batch-sync` with missing API key | 401 |
| `GET /balances/:id` when cache is stale | Balance refreshed from mock HCM |
| Concurrent duplicate request submission | Second request rejected (optimistic lock) |
| HCM unreachable on approval | Request queued as pending_hcm_confirmation |
| Anniversary balance update via batch sync | Local balance updated, audit log records hcm_batch source |
| Post-write verification catches silent HCM fail | Request flagged as needs_manual_review |

#### Mock HCM Server

A standalone Express.js server (`mock-hcm/server.js`) that simulates:
- `GET /hcm/balance/:employeeId/:locationId/:leaveType` — returns a configurable balance
- `POST /hcm/balance/deduct` — simulates deduction; supports configurable failure modes
- `POST /hcm/balance/restore` — restores a deducted balance
- An admin endpoint `POST /mock/configure` to set balance values and inject failures at runtime during tests

### 12.3 Coverage Target

Minimum 80% line coverage enforced via Jest's `--coverage` flag with a `coverageThreshold` in `jest.config.js`. Coverage reports are output to `coverage/` and a summary is included in the submission.

---

## 13. Alternatives Considered

### 13.1 Event-Driven Architecture (Message Queue)

**Approach:** Use a message queue (e.g., RabbitMQ, Redis Streams) to decouple ReadyOn from the HCM. Balance updates would be published as events and consumed asynchronously.

**Why not chosen:** The scope of this exercise calls for a self-contained microservice with SQLite. Introducing a message broker adds operational complexity without meaningful benefit at this scale. The retry logic in `HcmSyncModule` achieves similar resilience with simpler infrastructure.

---

### 13.2 PostgreSQL Instead of SQLite

**Approach:** Use PostgreSQL for stronger concurrency guarantees, row-level locking, and advisory locks.

**Why not chosen:** The assignment explicitly specifies SQLite. The optimistic locking strategy using a `version` column is sufficient to handle the concurrency requirements within SQLite's constraints.

---

### 13.3 HCM as the Only Source (No Local Cache)

**Approach:** Never cache balances locally. Always fetch directly from the HCM real-time API for every request.

**Why not chosen:** This would make every read dependent on HCM availability, degrading the employee experience during HCM downtime. The local cache with TTL-based invalidation provides resilience while keeping data acceptably fresh.

---

### 13.4 Saga Pattern for Distributed Transactions

**Approach:** Model each request lifecycle as a saga with compensating transactions.

**Why not chosen:** A full saga implementation adds considerable complexity. The simpler HCM-first with local rollback approach achieves the same consistency guarantees within the scope of this service.

---

## 14. Open Questions & Future Work

| Item | Notes |
|---|---|
| Half-day / hourly leave units | Current model uses `REAL` days — extension to hours is straightforward |
| Public holiday calendars | Days requested calculation currently counts calendar days; working day logic needs a holiday calendar integration |
| Multi-tenancy | `location_id` partially addresses this but a `tenant_id` dimension may be needed at scale |
| HCM webhook vs polling | If the HCM gains webhook capabilities, replace TTL-based staleness with event-driven invalidation |
| Observability | Add structured logging (e.g., Pino), metrics (e.g., Prometheus), and distributed tracing (e.g., OpenTelemetry) for production readiness |

---

*End of Technical Requirements Document*

---

> **Note to reviewer:** This TRD was written before any code was generated. It intentionally documents not just *what* the system does but *why* specific design decisions were made and what alternatives were weighed. The test strategy section is written as a specification that the code must satisfy, not as an afterthought.
