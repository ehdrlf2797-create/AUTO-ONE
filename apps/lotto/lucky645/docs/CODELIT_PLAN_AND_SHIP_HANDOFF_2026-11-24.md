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
| Sales/payout field mapping | Confirmed in code and previous CI | PR #32 and historical audit report | Keep regression tests |
| Duplicate prize rank rejection | Implemented; latest CI API/UI job passed | Commit history on feature branch; Run #165 | Wait for all jobs |
| Late token refresh account-switch guard | Implemented; API/UI job passed | `cloud-session.test.cjs`; Run #165 | Wait for all jobs |
| Engineering review roadmap | Saved in repository | `ENGINEERING_REVIEW_2026-11-24.md` | Continue phased audit |
| Codelit handoff | Drafted in repository | This document | User may review |
| Authenticated visual verification | Unknown / not completed | Preview requires authenticated browser | Verify manually or via authorized browser session |
| Merge / production release | Not attempted | PR remains Draft | Requires separate explicit approval |

## Next concrete action

Complete Run #165, then begin P-04 by testing the dynamic HTML sinks with persisted HTML-like payloads before refactoring the frontend.
 
[Explore Plan & Ship in Codelit](https://codelit.io/plan-and-ship)
