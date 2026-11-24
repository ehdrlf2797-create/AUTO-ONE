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
| Sales/payout field mapping | Implemented and audited across 1,251 rounds | Historical source comparison and regression tests | Maintain official source precedence |
| Duplicate-prize rejection | Implemented in API and frontend normalization | Duplicate-rank regression; Run #45443096100 passed | None known |
| Account-switch refresh guard | Implemented | Delayed refresh response regression; full CI | Preserve in later auth changes |
| CSV formula injection | Fixed and extracted to export-utils.js | Prefix vectors and export module tests | None known |
| Backup restore consistency | Staged multi-key writes with rollback | Commit/rollback tests | Real-browser quota failure test outstanding |
| Saved data bounds | 10,000 combinations / 50,000 history rows | Import/save/cloud-merge boundary tests | Review old oversized local data with export-first recovery |
| Account storage module | Extracted to storage-scope.js | First-account migration, isolation, migration-failure tests | None known |
| Monte Carlo simulation | Typed-array scratch buffers; seeded output preserved | 25k equivalence; 1M smoke; CI ≈1,380ms | Target Android performance not measured |
| Data-source adapter | Extracted to data-source.js with 16MiB JSON / 8MiB text limits | Source order, request options, timeouts, malformed/oversize responses, CSV edge tests; Run #45443096100 | Live source freshness reconciliation remains a separate operational check |
| HTML sink source review | No executable DOM XSS reproduced in reviewed paths | Source review only | Authenticated browser penetration testing remains open |
| Supabase tenant isolation | RLS, policies, grants and indexes inspected read-only | Owner-only authenticated policies on both tables | Leaked-password protection warning remains; no connector setting-write action |
| Authenticated browser verification | Not completed | TinyFish wallet -$0.312; host web inspection inaccessible | Requires a working authorized browser session |
| Merge / production release | Not attempted | PR #32 Draft/open/unmerged | Release gate after authenticated verification and full review |

## Latest verified acceptance evidence

- **CI Run #45443096100** on commit 6ca8be92291a3d794d72bdea704627f96d0ee769: all three jobs passed (LUCKY 645 API/frontend, Python 3.14 Ubuntu, Python 3.14 Windows).
- **Vercel Preview:** READY — https://auto-one-lucky645-ongse7ae8-ehdrlf2797-3377.vercel.app
- 16 MiB JSON and 8 MiB text/CSV response caps; Content-Length and decoded body length checks; malformed CSV quote rejection; original source order retained.
- Supabase RLS remains enabled with authenticated owner-only policies on both LUCKY 645 tables. Security Advisor's leaked-password protection warning remains; official guidance: https://supabase.com/docs/guides/auth/password-security
- HTML review remains source-level. No browser penetration test or authenticated UI test is claimed.
- PR #32 remains Draft/open/unmerged. No production deployment or Supabase schema/RLS/Auth-setting mutation was performed.

## Next concrete actions

1. Add a deterministic historical-feed integrity smoke test for continuous rounds, duplicate IDs/rounds, field presence and latest-round reconciliation, using locally stored fixtures rather than live external dependencies.
2. Extract draw normalization and trust-ranked merge logic as a separate pure module, preserving official sales/payout mapping and duplicate-rank rejection.
3. Measure 100-strategy research and the 1,000,000-draw simulation on representative Android devices; profile time and memory with reproducible seeds.
4. Review legacy oversized localStorage records and define an export-first, no-data-loss recovery path before adding a byte budget.
5. Keep authenticated browser verification, merge, production deploy and Supabase Auth setting changes as separately evidenced release gates; the current connector has no Auth-setting write action.

[Explore Plan & Ship in Codelit](https://codelit.io/plan-and-ship)
