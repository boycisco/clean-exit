# Clean Exit — Frontend Console

> **NEAR-based agent authority termination, capability inspection, and verifiable revocation platform.**

Clean Exit provides a developer console for inspecting delegated authority, mapping permission hierarchies, planning post-order terminations, revoking on-chain NEAR access keys, tracking manual obligations, and maintaining an immutable audit trail.

---

## 1. Architecture & Design Principles

- **Framework**: React 19 + TypeScript + Vite + Tailwind CSS v4.
- **Icons & Visuals**: Lucide icons, dark restrained developer theme, Plus Jakarta Sans display typography, JetBrains Mono tabular numerals (`tabular-nums`).
- **Authority**: The Clean Exit FastAPI backend is the single source of truth adhering strictly to the `api.md` contract.
- **Security & Privacy**:
  - API tokens use the `ce_` prefix and are provided by operators.
  - Ownership is derived exclusively from the token; user-supplied owner IDs are rejected.
  - Tokens are held in session memory only (never written to `localStorage` or transmitted externally).
  - Explicit **Disconnect** action clears all credentials immediately.

---

## 2. Capabilities & Truth Guarantees

Clean Exit strictly reflects backend capabilities discovered via `GET /api/v1/capabilities`:

1. **Signer Gating**: If `signer_configured` is false, destructive revocation actions are disabled with a tooltip explaining `signer_reason`. Read-only inspections and verification remain accessible.
2. **Tri-State On-Chain Status**:
   - `true`: Public key observed on-chain via NEAR RPC.
   - `false`: NEAR RPC confirmed key is absent from account.
   - `null`: Unknown, unsupported authority type, or RPC check inconclusive. `null` is **never** presented as "not on chain" or "revoked".
3. **Receipt Truth (Priority 4c Status)**: On-chain receipt publishing contract is pending implementation (P4). Off-chain canonical receipts with SHA-256 payload hashes are rendered accurately without fabricating blockchain transactions.
4. **Post-Order Termination Plan**: Steps are calculated in post-order sequence so downstream child delegations are revoked before parent access keys to avoid dangling delegations.

---

## 3. Getting Started

### Prerequisites

- Node.js 20+
- Running Clean Exit backend (FastAPI) at `http://127.0.0.1:8000` (or configured remote URL)

### Environment Configuration

Copy `.env.example` to `.env`:

```bash
VITE_API_BASE_URL="http://127.0.0.1:8000"
```

### Installation

```bash
npm install
```

### Running Locally

```bash
npm run dev
```

App runs on `http://localhost:3000`.

### Running Tests

```bash
npm test
```

Runs the automated test suite with Vitest in `jsdom` verifying:
- Bearer token authentication headers
- Error envelope pattern matching (`ApiError`)
- 401 session teardown
- Tri-state `on_chain` interpretation
- Revoked vs expired authority distinction
- Terminal agent statuses
- Sequential job phase transitions
- Accessible status indicators

### Production Build

```bash
npm run build
```

---

## 4. Endpoints Integrated

| Path | Method | Purpose |
| --- | --- | --- |
| `/health` | `GET` | Server health probe |
| `/api/v1/capabilities` | `GET` | Discovery of enabled features & signer status |
| `/api/v1/agents` | `GET`, `POST` | List and register autonomous agents |
| `/api/v1/agents/{id}` | `GET`, `PATCH` | Inspect agent and update mutable metadata |
| `/api/v1/agents/{id}/authorities` | `GET`, `POST` | Authority graph tree and registration |
| `/api/v1/authorities/{id}` | `GET`, `PATCH` | Authority details & attribute edits |
| `/api/v1/agents/{id}/verify` | `POST` | Read-only NEAR RPC key reconciliation |
| `/api/v1/agents/{id}/termination-plan` | `GET` | Post-order dry-run termination plan |
| `/api/v1/agents/{id}/terminate` | `POST` | Create durable termination job (idempotent) |
| `/api/v1/terminations/{id}` | `GET` | Poll active job phase & terminal status |
| `/api/v1/terminations/{id}/retry` | `POST` | Resume eligible failed/partial jobs |
| `/api/v1/agents/{id}/terminations` | `GET` | Chronological termination history |
| `/api/v1/agents/{id}/audit` | `GET` | Append-only immutable audit trail |
| `/api/v1/receipts/{id}` | `GET` | Receipt lookup (graceful 404 handling) |
| `/api/v1/receipts/{id}/verify` | `GET` | Cryptographic integrity verification |
| `/api/v1/agents/{id}/receipt` | `GET` | Latest finalized agent receipt |
