# Phase 0: 개발 환경 구성 및 점검

## 목표
새 개발 PC에서 프로젝트를 실행하고 기본 API 테스트를 수행할 수 있는 최소 환경을 마련합니다.

## 권장 환경
- Windows 10/11 64-bit 또는 최신 지원 데스크톱 OS
- Python 3.14.x 권장
- 지원 범위: Python 3.12 이상, 3.16 미만
- Git 및 GitHub 계정
- 코드 편집기 (VS Code 권장)

Python 공식 릴리스: https://www.python.org/downloads/

Python 3.10은 2026-10-01 지원 종료 상태이므로 새 환경에 사용하지 않습니다:
https://www.python.org/downloads/release/python-31022/

## 1. 환경 확인
PowerShell에서 실행합니다.

```powershell
py --list
py -3.14 --version
git --version
```

Python 3.14를 찾지 못하면 Python 공식 사이트에서 3.14.x를 설치한 뒤 새 PowerShell 창을 엽니다.

## 2. 저장소 받기

```powershell
git clone https://github.com/ehdrlf2797-create/AUTO-ONE.git
cd AUTO-ONE
git checkout phase0/bootstrap
```

## 3. 가상환경 및 패키지 설치

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
```

PowerShell이 스크립트 실행을 막는 경우 현재 창에서만 임시 허용합니다.

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

## 4. 환경 점검

```powershell
python scripts/check_env.py
```

Python 지원 버전과 FastAPI, Uvicorn, pytest, Ruff 설치 여부를 확인합니다.

## 5. 테스트 및 코드 검사

```powershell
python -m pytest
python -m ruff check .
python -m ruff format --check .
```

세 명령이 모두 성공해야 합니다.

## 6. API 실행

```powershell
python -m uvicorn auto_one.api.main:app --reload
```

브라우저 확인 주소:
- http://127.0.0.1:8000/healthz
- http://127.0.0.1:8000/docs

헬스 체크 응답 예시:

```json
{
  "status": "ok",
  "service": "auto-one-api",
  "version": "0.1.0"
}
```

## 7. 종료
API 실행 창에서 Ctrl+C를 누른 다음 가상환경을 종료합니다.

```powershell
deactivate
```

## Phase 0 완료 기준
- [ ] 지원되는 Python이 설치되어 있음
- [ ] 가상환경이 만들어지고 의존성이 설치됨
- [ ] 환경 점검 스크립트가 통과함
- [ ] pytest가 통과함
- [ ] Ruff 검사와 포맷 검사가 통과함
- [ ] API 헬스 체크가 HTTP 200을 반환함
- [ ] GitHub Actions CI가 통과함

사용자 PC에서의 설치·실행 확인은 문서만 추가한 것으로 완료 처리하지 않습니다. 실제 PC에서 명령을 실행한 뒤 결과를 기록해야 합니다.
