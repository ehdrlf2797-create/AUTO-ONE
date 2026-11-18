# AUTO-ONE

AI-powered unified automation system

AUTO-ONE is a modular automation platform for PC and web workflows. AI planning is separated from policy checks and execution so that permissions, approvals, and auditability remain explicit.

## Project modules

| Module | Purpose |
|---|---|
| API | Shared HTTP API and control plane foundation |
| Web | Browser dashboard and task approvals |
| Desktop | Windows desktop client foundation |
| Agent | Local PC agent foundation |
| LUCKY 645 | Lotto results, statistics, number combinations, history, and saved-number utilities |

## Windows quick start

Python 3.14 is the recommended development version. Supported versions are Python 3.12 through 3.15.

```powershell
py -3.14 --version
py -3.14 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
python scripts/check_env.py
python -m uvicorn auto_one.api.main:app --reload
```

- API health: http://127.0.0.1:8000/healthz
- API docs: http://127.0.0.1:8000/docs

## LUCKY 645 module

The previous LUCKY 645 v1.9 interface is included as a separate app module. The integration preserves the dashboard, number generation modes, statistics, analytics, checker, history, saved combinations, and backup/export screens.

- Module guide: [apps/lotto/lucky645/README.md](apps/lotto/lucky645/README.md)
- Preview entry point: [apps/lotto/lucky645/index.html](apps/lotto/lucky645/index.html)
- API endpoint: `/api/lotto?type=latest`
- Additional endpoints: `all`, `round`, and `status`

For a separate Vercel deployment, set Root Directory to `apps/lotto/lucky645`, use Framework Preset `Other`, and do not add a build command. Verify a Preview deployment before changing any production domain.

## Quality checks

```powershell
python -m pytest
python -m ruff check .
python -m ruff format --check .
node --check apps/lotto/lucky645/api/lotto.js
node --test apps/lotto/lucky645/tests/api.test.cjs
```

## Core engineering principles

- AI proposes plans; the policy layer checks permissions and risk before execution.
- Secrets belong in environment variables or managed secret stores, never in Git.
- Automation actions must be scoped, auditable, and reversible where possible.
- Existing production services are not replaced until a separate deployment is verified.
- Lottery statistics are descriptive only and do not predict or guarantee future results.

## Documentation

- [Phase 0 setup](docs/setup/phase-0.md)
- [Architecture](docs/architecture/overview.md)
- [Automation safety](docs/security/automation-safety.md)
- [Web app](apps/web/README.md)
- [Desktop app](apps/desktop/README.md)
- [Local agent](apps/agent/README.md)
- [Contracts](packages/contracts/README.md)
