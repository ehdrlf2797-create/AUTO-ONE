# AUTO-ONE

**AI-powered unified automation system**

PC와 웹에서 함께 사용하는 통합형 AI 자동화 시스템입니다. AI가 요청과 상황을 분석해 작업 계획을 제안하고, 정책 검증과 필요한 사용자 승인을 거친 뒤 허용된 작업을 수행하는 구조를 목표로 합니다.

## 개발 원칙
- **PC + Web:** 웹 대시보드와 PC 데스크톱 앱이 공통 기능과 API 계약을 사용합니다.
- **AI 판단 + 통제된 실행:** AI는 실행 계획을 만들고, 별도 정책 엔진이 권한·위험도·승인 조건을 검사합니다.
- **단계별 확장:** 작동하는 최소 기능부터 구현하고 테스트가 통과된 기능만 확장합니다.
- **보안 우선:** 비밀키는 저장소에 올리지 않으며, 파일·프로그램·외부 서비스 접근은 최소 권한으로 제한합니다.
- **검증 가능성:** 자동 테스트, 감사 로그, 오류 기록, 실행 취소 가능성을 설계에 포함합니다.

## 프로젝트 모듈

| 모듈 | 역할 | 상태 |
|---|---|---|
| API / Control Plane | 공통 API 및 제어 기반 | Phase 0 기반 |
| Web UI | 작업 설정, 승인, 모니터링 | 설계 단계 |
| Desktop UI / Local Agent | PC 연결 및 승인된 로컬 작업 | 설계 단계 |
| **LUCKY 645** | 로또 결과, 통계, 번호 보관함 및 분석 | 기존 v1.9 화면·기능 편입, API 검증 추가 |
| AI Planner / Policy Engine | AI 계획과 권한·승인 검증 | 후속 단계 |

## 빠른 시작 (Windows PowerShell)

Python 3.14 권장. 지원 범위는 Python 3.12 이상, 3.16 미만입니다.

```powershell
py -3.14 --version
py -3.14 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
python scripts/check_env.py
python -m uvicorn auto_one.api.main:app --reload
```

- API 상태: http://127.0.0.1:8000/healthz
- API 문서: http://127.0.0.1:8000/docs

## 테스트

```powershell
python -m pytest
python -m ruff check .
python -m ruff format --check .
node --check apps/lotto/lucky645/api/lotto.js
node --test apps/lotto/lucky645/tests/api.test.cjs
```

## 문서
- [Phase 0 개발 환경 구성 및 점검](docs/setup/phase-0.md)
- [시스템 아키텍처 개요](docs/architecture/overview.md)
- [자동화 안전 및 승인 원칙](docs/security/automation-safety.md)
- [LUCKY 645 통합 모듈](apps/lotto/lucky645/README.md)
- [DOTTO 벤치마킹](docs/benchmark/PROJECT-DOTTO-ASSESSMENT.md)
- [웹 앱 계획](apps/web/README.md)
- [데스크톱 앱 계획](apps/desktop/README.md)
- [로컬 에이전트 계획](apps/agent/README.md)
- [공통 API 계약](packages/contracts/README.md)

## 범위 안내
LUCKY 645 기존 운영 사이트와 Supabase 프로젝트는 별도로 유지됩니다. 이 저장소의 LUCKY 645 모듈은 별도 배포 검증을 거치기 전까지 운영 도메인을 변경하지 않습니다. AUTO-ONE의 PC 조작, 로그인 자동화 및 AI 실행 엔진은 각 단계의 보안·권한 테스트 이후 추가합니다.
