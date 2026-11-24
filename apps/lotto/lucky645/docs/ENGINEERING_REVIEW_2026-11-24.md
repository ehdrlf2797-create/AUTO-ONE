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


## Security and persistence follow-up (2026-11-24)

### Confirmed issues fixed

- **CSV spreadsheet formula injection:** imported history fields could flow into the saved-check CSV export. A shared csvCell serializer now quotes every cell and prefixes string values that begin with spreadsheet formula characters (including whitespace/BOM-prefixed cases) with an apostrophe. Numeric negative values remain numeric. Regression vectors cover =, +, -, @, tab/space prefixes, ordinary text, and numeric values.
- **Frontend duplicate-rank payout:** the API already discarded all occurrences of duplicated prize ranks, but the browser normalizeDraw path did not. It now applies the same rule before any fallback payout derivation. A regression test uses duplicate 1st-rank rows alongside ranks 2–5 and asserts that ambiguous 1st-rank data is excluded and no payout is derived.
- **Backup restore partial writes:** the importer previously persisted saved combinations, check history and auto-check metadata separately, allowing partial local state to remain after a quota/write failure. It now stages all three next-state values in memory, writes them via a rollback-aware storage transaction, then updates live state and schedules cloud sync only after storage succeeds. Tests cover successful commit, failure rollback and importer call order. Rollback is best-effort; an underlying storage failure can also prevent restoration, which is surfaced explicitly.
- **Unbounded backup and collection input:** imported backups are limited to 10,000 saved combinations and 50,000 check-history rows, with validation before mapping. Existing/new saved combinations share a 10,000-entry ceiling, and check history is capped to the latest 50,000 persisted records. Operations that would exceed the saved-entry ceiling abort without silently deleting existing entries. Cloud merge validates prospective unique record counts before mutating in-memory state.
- **Avoid unnecessary malformed-array work:** six-number arrays are length-checked before mapping; winning-number arrays are sliced before normalization; simulation, research-candidate, saved-history and tombstone loaders limit their processing to their defined bounds. The history loader scans backward to retain the newest valid 50,000 records.

### HTML sink review

- Re-reviewed dynamic HTML insertion paths in assets/app.js, including saved history, research summaries, draw history, exports and popup output.
- In the inspected persisted/imported values, HTML sinks used escaping or constrained numeric/enum values. No executable DOM XSS was reproduced in the reviewed paths.
- This was a source-level review, not an authenticated browser penetration test. The remaining sink inventory and visual verification are still release-gate items; do not claim the whole application is XSS-free.

### Regression and release evidence

- New UI tests cover CSV formula neutralization, frontend duplicate ranks, import-count boundaries, rollback on a later storage write failure, successful multi-key storage commit, and the importer’s staged/transactional flow.
- The API/frontend CI job passed on 1bffc1b26bd56851f001ec8c4af59056a11a1293; Python Ubuntu/Windows jobs were still running at the time of this update. Re-check the latest full CI run after this documentation commit.
- Preview deployment for 1bffc1b26bd56851f001ec8c4af59056a11a1293 reached READY: https://auto-one-lucky645-ftlh8fkhw-ehdrlf2797-3377.vercel.app
- Authenticated browser verification remains outstanding. PR #32 remains Draft/open/unmerged; no main, production, or Supabase schema/RLS changes were made.


### Supabase cloud isolation review (read-only)

- Project: lucky645-cloud, ACTIVE_HEALTHY, ap-northeast-2.
- Both public.lucky645_sync_records and public.lucky645_research_runs have RLS enabled. The four policies on each table target authenticated and constrain SELECT/DELETE with auth.uid() = user_id; INSERT uses the same ownership predicate in WITH CHECK; UPDATE includes both USING and WITH CHECK with the same owner predicate.
- Table grants show authenticated SELECT/INSERT/UPDATE/DELETE; no anon table grants were returned for these two tables. Service-role grants are present as expected; the frontend uses a publishable key, not a service-role key.
- Ownership uniqueness is enforced by the sync-record unique index on (user_id, category, record_key) and the research-runs primary key on (user_id, run_id). Supporting user/date and user/update indexes exist.
- Research report JSON is constrained to object values up to 2 MiB; run_id is constrained to 1–128 characters. The sync-record payload has no comparable explicit JSON byte-size CHECK, so adding a database-level bound is a future schema-hardening candidate that remains unimplemented pending separate approval.
- Current stored footprint is small: 132 sync rows (max payload 390 bytes) and 1 research report (35,403 bytes). These are point-in-time counts, not quotas.
- Supabase Security Advisor returned one warning: leaked-password protection is disabled. Performance and health advisors returned no findings. Enabling this Auth setting is recommended, but no setting/policy/schema changes were made in this pass. See https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
- RLS is enabled but not forced on either table. Authenticated client access remains restricted by policies; table-owner/service-role bypass behavior is separate and should be considered when designing privileged server-side operations.

## Incremental frontend modularization (2026-11-24)

- Extracted CSV export cell serialization and spreadsheet-formula neutralization from the main app entry into assets/export-utils.js.
- index.html loads the shared utility before assets/app.js; both script URLs carry explicit cache-busting versions.
- app.js now calls window.Lucky645ExportUtils.csvCell; tests load the utility in isolation and verify all exported cells route through it.
- This is the first narrow module extraction, not a wholesale frontend rewrite. The main app remains a large legacy entry file. Next extraction candidates are persistence/account scope and data-source adapters, each gated by focused contract tests.

## Latest verified CI and Preview (commit 09916f0d8b6c03da1407b0b403d975e1aadf0c87)

- GitHub Actions Run #45242250743 passed all three jobs: LUCKY 645 API/frontend suite, Python 3.14 Ubuntu and Python 3.14 Windows.
- Vercel Preview is READY at https://auto-one-lucky645-fcc0ykjsi-ehdrlf2797-3377.vercel.app
- An authenticated or full browser smoke test has not been completed. TinyFish read-only smoke test did not start because the connected TinyFish wallet had a negative balance (-$0.312); no paid top-up was performed.
- PR #32 remains Draft/open/unmerged. Production deployment and Supabase DDL/policy/settings changes were not performed.
## Account storage and performance follow-up (2026-11-24)

- Extracted account namespace and one-time legacy migration logic into assets/storage-scope.js via a small createAccountStorage API. app.js retains thin wrappers and passes only the account-owned key allowlist and a live user-ID getter.
- index.html loads storage-scope.js before export-utils.js and app.js. Tests execute the module independently and cover first-account legacy adoption, second-account isolation, local namespace behavior, and failed migration preserving the legacy source.
- The 1,000,000-draw Monte Carlo sampler now reuses a Uint8Array selection-flag buffer and a six-slot selection buffer instead of allocating one Set per draw. It retains the same seeded RNG call sequence and selection order.
- A 25,000-draw seeded equivalence test matches number and match histograms exactly against the prior Set-based algorithm.
- A full 1,000,000-draw CI smoke test passed with 100 progress yields and 6,000,000 total selections. Observed duration was approximately 1,380 ms on the GitHub CI runner; this is not a representative mobile-device benchmark and there is no before/after timing claim.

## Latest verified code commit and CI

- Code/test commit: ccfba4b82a6147b158f0b026b215718305ea025f.
- GitHub Actions Run #45243742302 passed all 3 jobs: LUCKY 645 API/frontend (including 1,000,000-draw smoke test), Python 3.14 Ubuntu, and Python 3.14 Windows.
- Vercel Preview is READY at https://auto-one-lucky645-mju97orul-ehdrlf2797-3377.vercel.app
- Docs/handoff still need a final refresh after this commit; the PR remains Draft/open/unmerged.
- Mobile-device performance, authenticated browser verification, and browser-level storage quota/rollback testing remain outstanding. No production deployment or Supabase DDL/policy/Auth-setting change was performed.
## Data-source adapter extraction and input hardening (2026-11-25)

- Extracted source endpoints, JSON/text HTTP transport, local-proxy-unavailable classification, and CSV parsing into assets/data-source.js. The app consumes it through window.Lucky645DataSource.createAdapter({normalizeDraw}); index.html loads the module before app.js.
- Canonical data-source order remains unchanged: cumulative Vercel proxy, GitHub raw JSON, GitHub Pages JSON; latest official proxy then official endpoint; public latest mirror only when official lookup is unavailable; CSV is used as a history/financial enrichment fallback.
- The adapter uses CORS, credentials=omit, cache=no-store, AbortController timeouts, HTTP status checks, and HTML/invalid-JSON rejection.
- JSON response limit is 16 MiB; text/CSV limit is 8 MiB. Content-Length is checked before consuming the body where the header is available, and the decoded string length is checked afterward.
- CSV parsing rejects an unterminated quoted field instead of silently accepting a malformed row. UTF-8 BOM, quoted commas, and doubled quotes are covered by tests.
- Regression coverage: source endpoint contract/order, app script load order, timeout cleanup, fetch security options, HTTP error, HTML response, malformed JSON, oversized declared body, CSV BOM/quotes and unterminated quote.

## Latest data-source code verification

- **CI Run #45443096100** on commit 6ca8be92291a3d794d72bdea704627f96d0ee769: LUCKY 645 API/UI, Python 3.14 Ubuntu, and Python 3.14 Windows all passed.
- **Preview READY:** https://auto-one-lucky645-ongse7ae8-ehdrlf2797-3377.vercel.app
- The immediately preceding source-priority/script-order commit e4ea43610237d9d0bd7493afaace181e6fafaa0e also passed all 3 CI jobs in Run #45442749842.
- Authenticated visual/browser penetration testing remains incomplete. TinyFish execution could not start with a -$0.312 wallet balance and no credit top-up was made. Direct web page inspection also failed at the host, so neither is counted as a browser test.
- Supabase Security Advisor's leaked-password protection warning remains. Official Supabase documentation states the setting is configured in Auth settings and is available on Pro and above. The connected Supabase tools expose read/audit and database operations but no Auth security-setting update action; no setting change was attempted.
## Draw-domain extraction, feed diagnostics and sales round-trip fix (2026-11-25)

- Extracted normalizeDraw, extractDraws/raw-row extraction, normalizeOfficial, isContinuousHistory, sourceTrust and mergeDraws into assets/draw-domain.js. The app and data-source adapter now consume a single pure domain implementation loaded before app.js.
- Added auditHistory/auditDraws to report raw-row count, valid/invalid rows, duplicate round IDs, compressed missing-round ranges, first/last round, missing sales rounds and missing payout rounds. The audit checks structural continuity separately from financial-field completeness.
- refreshData now records structured diagnostics for rejected cumulative JSON and CSV feeds. Final readiness is derived from the audit rather than a simple filtered-array length check. Financial missingness is reported without fabricating zero values.
- Found and fixed a sales-value round-trip defect: normalized draw records previously stored totalSales but omitted the authoritative source alias. A later cache restore or merge re-normalized the record and could discard the sales amount. Normalized records now retain the canonical totSellamnt value, which is accepted by the same sales-field precedence. Regression test covers CSV parse -> normalized draw -> merge/cache-style re-normalization.
- New deterministic fixtures cover invalid rows, duplicate rounds, missing round ranges, missing sales/payout values, fully continuous normalized feeds, official nested API selection, trust ordering and financial enrichment.

## Latest draw-domain and feed-audit verification

- **GitHub Actions Run #45445283338** on code/test commit ae8203e7ac49cfa76684f4d0ed875391dcfeca0b passed all three jobs: LUCKY 645 API/UI, Python 3.14 Ubuntu and Python 3.14 Windows.
- **Vercel Preview READY:** https://auto-one-lucky645-qsihkv9jd-ehdrlf2797-3377.vercel.app
- The preceding domain-extraction commit b5914f9567a1616e689c7c545d1d6902f359042f passed its subsequent harness-fix commit's entire CI in Run #45444180443; no failed code was retained as current head.
- Browser visual testing, authenticated browser penetration tests and actual Android-device profiling remain uncompleted. TinyFish wallet is negative (-$0.312); no top-up was made.
- No production deployment, main merge or Supabase schema/RLS/Auth setting mutation.
## Cloud sync atomic apply and HTML regression follow-up (2026-11-25)

- Remote cloud rows are first normalized, deduplicated and capacity-checked. Before applying, the app takes in-memory snapshots of saved combinations, check-history records and auto-check metadata.
- The local apply phase now writes saved combinations, check history, auto-check metadata and account-specific tombstones through one rollback-aware storage transaction. UI refresh occurs only after commit. A write failure restores all three in-memory snapshots and rethrows so the sync layer records an error.
- Added a contract regression asserting the cloud apply path uses a single transaction, rechecks account/generation before commit, restores in-memory snapshots after failure, and does not write tombstones ahead of the other records.
- Added hostile-but-inert persisted-text fixtures for image/svg/script/attribute payloads. They assert the shared escapeHtml helper removes literal angle brackets from the HTML output, and source-contract tests verify saved-history source, PDF source, research labels/notes and cloud sync errors are escaped at their dynamic HTML boundaries.
- **CI Run #45447686827** on code/test commit 9b4878c0659a06a12cdf9bb3b5fb51dc1ca0ed88 passed all 3 jobs (LUCKY 645 API/UI, Python 3.14 Ubuntu, Python 3.14 Windows).
- **Preview READY:** https://auto-one-lucky645-cuo74vw1f-ehdrlf2797-3377.vercel.app
- This remains source/contract testing. No browser execution of payloads or authenticated penetration test was performed. The TinyFish execution wallet remains negative (-$0.312), and no top-up was made.