# LUCKY 645 (AUTO-ONE module)

기존 LUCKY 645 v1.9 화면과 주요 사용 흐름을 보존해 AUTO-ONE 저장소 안에 독립 앱으로 편입한 모듈입니다.

## 보존한 기능

- 대시보드, 최신 회차 표시
- 완전 무작위 / 균형 / 통계 참고 / 혼합 / 직접 설정 번호 생성
- 번호 통계와 고급 분석, 조합 시뮬레이션
- 당첨 확인, 회차별 이력, CSV/PDF 내보내기
- 로컬 번호 보관함, 백업·복원
- Supabase 로그인 및 클라우드 동기화 UI

현재 페이지 HTML, CSS, JavaScript를 분리했습니다.
- `index.html`
- `assets/app.css`
- `assets/app.js`
- `api/lotto.js`

## 데이터 계약

| 요청 | 응답 | 기준 |
|---|---|---|
| `GET /api/lotto?type=latest` | 동행복권 공식 응답 형태 | 공식 조회 성공 때만 200 |
| `GET /api/lotto?type=all` | 정규화 회차 배열 | 1회부터 연속성 검사 통과 |
| `GET /api/lotto?type=round&round=N` | `data.list` 형식 | 검증된 누적 이력에서 조회 |
| `GET /api/lotto?type=status` | 캐시 상태 | 운영 진단용 |

### 데이터 공급원 정책

1. 최신 당첨 결과는 동행복권 공식 API를 우선 조회합니다.
2. 전체 이력은 공개 JSON 사본을 가져오되 회차 연속성, 번호 6개, 보너스 번호를 검증합니다.
3. 전체 이력 사본은 보조 데이터입니다. 공식 확인으로 표시하지 않습니다.
4. 공식 최신 조회 실패 시 최신 결과 API는 임의 번호나 이전 회차를 최신 공식 결과처럼 반환하지 않고 HTTP 503을 반환합니다.
5. 전체 이력은 6시간 메모리 캐시를 사용하며, upstream 장애 시 마지막 검증된 캐시만 제공하고 stale 표시를 붙입니다.
6. 데이터 검증 실패 결과는 캐시에 저장하지 않습니다.

## 로컬 테스트

Node.js가 설치된 환경에서 저장소 루트에서 실행합니다.

```powershell
node --check apps/lotto/lucky645/api/lotto.js
node --test apps/lotto/lucky645/tests/*.test.cjs
```

## Vercel 배포 연결

Vercel 프로젝트의 Root Directory를 `apps/lotto/lucky645`로 설정하고 Framework Preset은 Other로 선택합니다. 빌드 명령은 필요하지 않습니다. 현재 운영 중인 `lucky645-seven.vercel.app` 도메인과 기존 Supabase 프로젝트는 이 소스 추가만으로 변경되지 않습니다.

새 배포를 검증한 후에만 기존 도메인 전환을 검토합니다.

## 현재 알려진 제한

- Supabase 프로젝트 `lucky645-cloud`는 2026-11-18 기준 `ACTIVE_HEALTHY` 상태입니다. `lucky645_sync_records` 테이블에는 RLS와 사용자 소유권 정책이 적용되어 있으며, `anon` 권한은 제거하고 `authenticated`에는 SELECT/INSERT/UPDATE/DELETE만 부여했습니다.
- 데이터베이스 권한과 정책은 점검했지만, 실제 계정의 로그인·토큰 갱신·PC 간 동기화는 계정 소유자의 브라우저 테스트가 필요합니다.
- 브라우저 세션 토큰은 현재 `localStorage`에 저장됩니다. 장기적으로 서버 측 HttpOnly 쿠키 세션 방식으로 개선해야 합니다.
- Supabase 조직은 Free 요금제입니다. 유출 비밀번호 차단 기능은 Pro 이상에서 제공되므로 현재 경고가 남아 있습니다.
- 기존 화면의 계정 토큰 저장 방식은 후속 보안 개선 대상입니다. 브라우저 localStorage에 세션 토큰을 보관하므로 XSS 방어, 서버 세션 전환, RLS 검증을 별도 작업해야 합니다.
- 판매점 전국 지도는 아직 이 모듈에 편입되지 않았습니다. 기존 UI가 제공하지 않는 데이터를 추정해 표시하지 않습니다.
- 사이트 배포본의 Node 런타임 경고 `DEP0169 url.parse()`는 런타임 경고 로그에서 발견했지만, 현재 소스 일부가 배포 API에서 잘려 제공되어 발원 dependency까지 특정하지 못했습니다. 이 경고를 수정 완료로 표시하지 않습니다.
## Vercel 배포 연결 상태

- Vercel 프로젝트: `auto-one-lucky645`
- GitHub 저장소: `ehdrlf2797-create/AUTO-ONE`
- 프로젝트 Root Directory: `apps/lotto/lucky645`
- Node.js 런타임: `24.x`
- 배포 대상 브랜치: `main`
- 빌드 명령: 별도 명령 없이 Vercel 기본 정적 배포 설정 사용
- GitHub 저장소 연결 및 Git 배포 기능이 활성화되어 있습니다. `main` 브랜치에 변경 사항이 push되면 Vercel이 이 앱을 배포하도록 구성했습니다.
- 기존 `lucky645-seven.vercel.app` 서비스 및 기존 Supabase 프로젝트는 별개의 리소스로 유지합니다.

