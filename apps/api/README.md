# API 서비스

FastAPI 기반 AUTO-ONE 제어 API입니다.

현재 제공 기능:
- `GET /healthz`: API 프로세스의 기본 상태 확인
- `GET /docs`: 개발 환경용 OpenAPI 문서

저장소 루트에서 가상환경을 활성화하고 의존성을 설치한 뒤 실행합니다.

```powershell
python -m pip install -e ".[dev]"
python -m uvicorn auto_one.api.main:app --reload
```

인증, 작업 실행, AI 모델 호출, 사용자 데이터 접근 API는 아직 제공하지 않습니다. 권한·위험 정책과 테스트를 함께 설계한 뒤 추가합니다.
