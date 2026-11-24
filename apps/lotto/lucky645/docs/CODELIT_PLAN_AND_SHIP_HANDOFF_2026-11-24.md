# Codelit Plan & Ship — LUCKY 645 Engineering Handoff

> Planning handoff prepared using the public Codelit Plan & Ship template. This is a repository Markdown artifact, not a Codelit-native saved project or executed agent run.

## Source snapshot

**Goal:** Improve the LUCKY 645 module's correctness, account safety, maintainability, and mobile performance without changing lottery odds or releasing unreviewed code.

**Repository:** `ehdrlf2797-create/AUTO-ONE`  
**Branch:** `fix/lucky645-sales-field-mapping`  
**PR:** [#32](https://github.com/ehdrlf2797-create/AUTO-ONE/pull/32)  
**Current reviewed commit:** `b4cab3885c7c2f78981a4e1fad29b3732c2ac860`  
**Main implementation paths:**
- `apps/lotto/lucky645/api/lotto.js`
- `apps/lotto/lucky645/assets/app.js`
- `apps/lotto/lucky645/assets/app.css`
- `apps/lotto/lucky645/index.html`
- `apps/lotto/lucky645/tests/api.test.cjs`
- `apps/lotto/lucky645/tests/cloud-session.test.cjs`
- `apps/lotto/lucky645/tests/ui-regression.test.cjs`

**Accepted decisions already in force:**
- Official sales field / CSV `totSellamnt` only; do not trust the ambiguous mirror `totalSales` alias.
- Payout is distinct from sales and is derived only from five complete, unique rank rows.
- Per-account local storage and cloud sync must not cross account boundaries.
- No production deployment, main merge, or Supabase schema/RLS change without separate explicit approval.
- Statistical analysis and simulation must not claim to improve the probability of a particular ticket.

**Evidence status:**
- Observed CI Run #162 passed all three jobs before the token-refresh race patch.
- CI Run #163 failed because the existing isolated cloud-session test harness did not define the new session-generation variable; this failure exposed a test-fixture gap, not a failed application syntax check.
- The harness was updated. CI Run #165 has API/UI tests passed and Ubuntu checks passed; Windows checks were still running at last inspection.
- Vercel Preview for commit `b4cab38` was observed as READY.
- Authenticated browser visual verification remains uncompleted.

## Traceability

| Requirement | Component | Owner | Work item | Acceptance test |
|---|---|---|---|---|
| P-01 Correct financial metrics and reject ambiguous rank rows | C-01 API normalization | Human maintainer with assistant support | W-01 Harden sales/payout and duplicate-rank normalization | T-01 API tests cover missing, complete, duplicate, and invalid ranks |
| P-02 Prevent account crossover during auth refresh and cloud sync | C-02 Auth/session lifecycle | Human maintainer with assistant support | W-02 Bind token refresh to initiating user and session generation | T-02 Cloud-session test switches accounts before a deferred refresh response resolves |
| P-03 Recover from upstream refresh failure | C-03 Data refresh UI | Human maintainer with assistant support | W-03 Verify manual retry, duplicate request guard, and failure cleanup | T-03 UI regression tests assert error details and restored button/lock |
| P-04 Prevent persisted or external data from becoming executable HTML | C-04 Rendering and storage | Human maintainer with assistant support | W-04 Audit all dynamic HTML sinks and storage validators | T-04 Tests inject HTML-like values into relevant renderers and assert escaped/text-only output |
| P-05 Reduce monolithic frontend maintenance cost without behavior changes | C-05 Frontend module boundaries | Human maintainer with assistant support | W-05 Extract one cohesive module at a time with explicit interfaces | T-05 Full existing API/UI/cloud tests pass after each extraction |
| P-06 Keep research and simulation responsive on mobile | C-06 Research/simulation runtime | Human maintainer with assistant support | W-06 Benchmark, yield, cancel, and bound long-running work | T-06 Reproducible mobile benchmark plus cancellation/progress tests |

## Scoped implementation prompt

```text
Goal:
Improve LUCKY 645 correctness, account isolation, security, maintainability,
and mobile responsiveness while preserving current product behavior.

Grounded context:
Use the repository and branch named above. Read the current source files and tests
before editing. The frontend app.js is approximately 180 KB / 3,523 lines.
A static inventory counted 55 innerHTML occurrences and 54 event listener
registrations; these are audit targets, not proof of vulnerabilities.

Included changes:
1. Fix data integrity defects with focused regression tests.
2. Harden refresh-token handling against late responses after account changes.
3. Audit dynamic HTML sinks and browser storage input validation.
4. Extract frontend modules incrementally, retaining the current stack.
5. Measure research/simulation performance before changing algorithms.

Excluded changes:
- Do not merge to main or deploy to production.
- Do not alter Supabase schema, RLS policies, or credentials.
- Do not replace the lottery-number generation methodology or imply a higher
  per-ticket winning probability.
- Do not perform a wholesale SPA rewrite or introduce an agent/AI runtime
  for deterministic validation.

Constraints:
Preserve per-user storage, session generation guards, RLS ownership, backup
rollback, retry idempotency, and all current source-trust rules. Treat external
data as untrusted. Never put secrets in browser code or logs.

Ordered tasks:
1. Finish current CI run and reconcile every failing job.
2. Audit HTML sinks and persistence schemas; fix only confirmed unsafe paths.
3. Add tests for account switching during token refresh and sync/backup import.
4. Benchmark research and simulation on representative mobile hardware.
5. Extract data adapters and storage/auth modules one at a time.
6. Run full CI and Preview checks after each bounded change.
7. Prepare release review; await explicit approval before merge/deploy.

Acceptance checks:
Node syntax checks, all API/UI/cloud-session tests, Python CI on Ubuntu and
Windows, account isolation tests, XSS-style input tests, backup rollback tests,
and a verified Preview. Record authenticated browser verification separately.

Release and recovery:
Use the feature branch and Preview only. Preserve the last known-good commit.
If a migration or module extraction fails, revert that isolated commit. Production
deployment and Supabase changes require separate explicit authorization.

Reporting:
Report exact changed files, commit IDs, CI run IDs and job outcomes, Preview
state, tests not run, unresolved risks, and actions not performed.
```

## Completion ledger

| Item | Status | Evidence | Remaining action |
|---|---|---|---|
| Sales/payout mapping | Implemented and audited across rounds 1–1251 | Historical CSV/JSON comparison and regression fixtures | Maintain source precedence |
| Duplicate prize-rank rejection | Implemented in API and domain normalizer | Duplicate-rank tests; Run #45445283338 passed | None known |
| Account-switch refresh guard | Implemented | Delayed refresh race test; full CI | Preserve in future auth refactor |
| CSV formula injection | Fixed and extracted to export-utils.js | Prefix vectors and module tests | None known |
| Backup restore consistency | Transactional multi-key writes with best-effort rollback | Commit/rollback regression tests | Browser quota failure remains untested |
| Saved data bounds | 10,000 combinations / 50,000 check-history rows | Import/save/cloud merge boundary tests | Legacy oversized storage review |
| Account storage | Extracted into storage-scope.js | Migration failure and account isolation tests | None known |
| Data source adapter | Extracted with 16 MiB JSON / 8 MiB text caps | Source order, timeout, status, malformed/oversize response and CSV tests | Monitor external source freshness |
| Draw domain | Extracted into draw-domain.js | Normalization, official API selection, source trust, merge and continuity tests | None known |
| Feed quality audit | Structured invalid/duplicate/gap and missing financial-field report integrated in refreshData | Deterministic JSON/CSV fixtures; Run #45445283338 passed | Add live source freshness snapshots when fixtures are refreshed |
| CSV sales round-trip | Preserves canonical totSellamnt through parse/merge/cache re-normalization | Dedicated regression test | None known |
| Monte Carlo simulation | Typed-array scratch buffers; previous seeded draw sequence preserved | 25k equivalence and 1M CI smoke (~1,380 ms CI host) | Android profiling not available in current environment |
| HTML sink review | No executable DOM XSS reproduced in inspected persisted paths | Source review only | Browser penetration testing remains open |
| Supabase isolation | RLS/policies/grants/indexes read-only reviewed | Auth owner-only policies; Security Advisor warning documented | Leaked-password protection remains disabled; connector has no Auth settings writer |
| Authenticated visual verification | Not completed | TinyFish unavailable (-$0.312); direct Preview fetch inaccessible from web host | Authorized browser session required |
| Merge / production release | Not attempted | PR #32 remains Draft/open/unmerged | Explicit release gate after browser testing |

## Latest verified acceptance evidence

- **CI Run #45445283338** on ae8203e7ac49cfa76684f4d0ed875391dcfeca0b: all three jobs passed (LUCKY 645 API/frontend, Python 3.14 Ubuntu, Python 3.14 Windows).
- **Vercel Preview READY:** https://auto-one-lucky645-qsihkv9jd-ehdrlf2797-3377.vercel.app
- The domain audit distinguishes invalid rows, duplicate round IDs, missing round ranges, missing sales and missing payout values; incomplete financial data remains explicit and is not changed to zero.
- Normalized records preserve totSellamnt so authoritative CSV sales remain available through cache restoration and trusted-source merging.
- Supabase Security Advisor leaked-password protection warning remains; official guidance: https://supabase.com/docs/guides/auth/password-security. No Supabase configuration or database change was made.
- Browser/authenticated XSS testing and Android-device profiling remain outstanding. PR #32 remains Draft/open/unmerged.

## Next concrete actions

1. Continue the read-only storage audit: inventory every persisted key, payload shape, write frequency and error-handling path; do not impose byte limits until a no-data-loss export/recovery path is implemented.
2. Continue persisted/imported HTML sink testing with hostile-but-inert fixtures and verify escaped rendering contracts. Keep authenticated browser verification as a distinct release gate.
3. Add an offline benchmark harness for 100-strategy research and 1,000,000-draw simulation; run it on a representative Android device when a user-controlled device/browser session is available.
4. Keep merge, production deployment, Supabase DDL/RLS changes and Auth settings changes outside autonomous scope until the corresponding release gates are verifiably complete.

[Explore Plan & Ship in Codelit](https://codelit.io/plan-and-ship)

## Browser persistence failure visibility (2026-11-25)

- persistDraws now returns a success boolean rather than silently swallowing quota/storage errors. The live refresh path reports a clear warning when the current data is available in memory but the browser cache could not be saved; the refresh itself remains usable for the current session.
- persistSyncMeta now reports its write result. The refresh status title includes a diagnostic when the synchronization metadata itself could not be persisted.
- Added injected-storage success/failure tests and assertions that cache persistence failure is kept separate from live feed readiness.
- **GitHub Actions Run #45449005862** on commit befb3f4045379bb618c8e740ba5374c8d097719a passed all three jobs: LUCKY 645 API/UI, Python 3.14 Ubuntu and Python 3.14 Windows.
- **Preview READY:** https://auto-one-lucky645-d1idvq1j5-ehdrlf2797-3377.vercel.app
- Research backup persistence was separately audited: at most five backups per user are retained; the global storage array preserves other-account entries, and backup creation rolls back in-memory changes when storage fails. No destructive global byte cap was added.
- Browser quota behavior remains covered by injected storage tests only; real device quota exhaustion and authenticated browser verification remain untested.