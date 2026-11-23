# LUCKY 645 Engineering Review & Optimization Plan

**Date:** 2026-11-24  
**Repository:** `ehdrlf2797-create/AUTO-ONE`  
**Target branch:** `fix/lucky645-sales-field-mapping`  
**Scope:** `apps/lotto/lucky645`  
**Status:** Review in progress; no production release authorized.

## Verified source inventory

- Frontend entry: `index.html`, `assets/app.js`, `assets/app.css`.
- API entry: `api/lotto.js`.
- Node runtime configured in README: Node.js 24.x.
- Current frontend script is approximately 180 KB / 3,523 lines.
- Static scan of `assets/app.js`: 55 `innerHTML` occurrences, 54 `addEventListener` occurrences, 3 direct `fetch(` occurrences, 17 `Math.random` occurrences, and 2 `crypto.getRandomValues` occurrences.
- The project already has API and UI regression tests and a GitHub Actions job that runs `node --check` plus `node --test apps/lotto/lucky645/tests/*.test.cjs`.

These are inventory counts, not by themselves proof of a defect.

## Confirmed issue fixed in this review

### Ambiguous duplicate prize ranks

The API previously accepted repeated rank rows in `raw.ranks`. The payout fallback built a Map keyed by rank, which silently overwrote duplicate rows. A payload containing all five rank numbers plus a conflicting duplicate could therefore look complete and produce a payout from an arbitrary row.

**Change:** count each rank and discard every row for a rank that appears more than once before attempting payout derivation.

**Regression test:** a payload with duplicate first-place rows must not derive a total payout and must exclude the ambiguous rank rows.

Files:
- `api/lotto.js`
- `tests/api.test.cjs`

## Optimization roadmap

### P0 — Data correctness and recovery
- Preserve strict round/number/date validation and source trust boundaries.
- Reject ambiguous rank sets and incomplete payout inputs.
- Test timeout, malformed upstream payload, stale cache, and source failover behavior.
- Test refresh failure, account switching, cloud sync retry boundaries, and restore rollback.
- Keep user-facing states explicit: verified, stale, unavailable, and not yet checked.

### P1 — Security and persistence
- Review every dynamic `innerHTML` sink; require escaping for persisted/user-controlled strings or replace with DOM text APIs.
- Add schema/version validation and bounded-size checks to every local-storage JSON record.
- Verify account-scoped storage migration and cloud sync never cross account boundaries.
- Keep Supabase service-role credentials server-side; browser code may use only the publishable key with RLS.
- Review popup/export paths and external URL handling.

### P2 — Frontend maintainability
- Keep the current production behavior stable while extracting the monolithic `app.js` into bounded modules.
- Candidate boundaries: data/API adapters, account-scoped persistence, cloud auth/sync, draw history, number generation, simulation/research, rendering and exports.
- Introduce modules incrementally with explicit contracts and tests; avoid a one-shot rewrite.
- Consolidate repeated fetch timeout/JSON parsing logic only after behavior is covered by tests.
- Add a lightweight formatting/lint step for JavaScript if it can be adopted without noisy unrelated diffs.

### P3 — Performance and observability
- Benchmark the 100-strategy research run and 1,000,000-draw Monte Carlo workload on representative mobile hardware.
- Keep long calculations chunked/yielding and cancellable; show real progress and preserve completed results.
- Bound history and report rendering work; paginate or virtualize only if measurements justify it.
- Track API source, stale age, last success, and failure category without exposing secrets or tokens.

## Architecture and delivery boundaries

- Keep the static SPA and serverless API unless measurements show a concrete reason to migrate.
- Use deterministic validation/normalization in ordinary code; do not add AI to lottery-number generation or data-integrity decisions.
- Bind cloud records to the authenticated user and enforce ownership with Supabase RLS.
- Treat external source values as untrusted input.
- Release through Preview first. Production domain changes, Supabase schema/policy changes, merging to `main`, and production deployment require a separate explicit approval.

## Acceptance gates

1. API and UI regression tests pass.
2. New tests cover every repaired defect and important failure path.
3. No cross-account read/write regression.
4. No unescaped persisted/user-controlled values reach HTML sinks.
5. Preview deployment is ready and authenticated browser verification is recorded separately.
6. PR review records unresolved risks and exact tested commit.
7. No production release is claimed from a Preview-only result.

## Current verification gap

The duplicate-rank fix has been committed to the existing feature branch. CI and Preview checks for the newest commit must complete before this review can be called validated. The authenticated visual check is still outstanding.

### Late refresh-token response after account switch

A second race was found in the browser auth flow: if account A's refresh-token request completed after the user had switched to account B, the late successful response could call `saveCloudSession` and restore account A. This was not prevented by the cloud-sync generation guard because the stale response changed the session before the sync guard rejected the operation.

**Change:** capture the initiating user ID and session generation before refreshing. Before applying a successful response, reject it if the account/session generation changed; if another tab rotated the token for the same account, retain the newer current session instead of overwriting it. Also reject a mismatched user ID returned by the refresh endpoint.

**Regression test:** hold account A's refresh response, switch to account B, then resolve A's response and assert B remains signed in.

Files:
- `assets/app.js`
- `tests/ui-regression.test.cjs`
