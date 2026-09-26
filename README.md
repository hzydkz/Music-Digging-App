# 디깅 노트 (Music-Digging-App)

앨범을 검색하면 MusicBrainz·Wikipedia·Discogs 자료를 모아 **출처가 붙은 한국어 조사 노트**를 만들어 저장하는 개인용 웹앱.
기획서: v0.2 (1단계 MVP 구현 중)

## 처음 설정 (아이패드에서, 한 번만)

화면 이름은 서비스 업데이트로 바뀔 수 있습니다. 비슷한 메뉴를 찾으면 됩니다.

### 1. Turso DB 2개 만들기
1. turso.tech 로그인 → Databases → Create Database → 이름 `digging-prod`
2. 같은 방법으로 `digging-preview` 생성
3. 각 DB 화면에서 **URL**(`libsql://…`)을 복사하고, **토큰 생성**(Create Token / Generate Token)으로 토큰을 만들어 둔다

### 2. Vercel 프로젝트 연결
1. vercel.com → Add New → Project → 이 GitHub 저장소 Import (프레임워크는 Next.js 자동 인식, 빌드 설정은 기본값 그대로)
2. Settings → Environment Variables 에 아래 값을 넣는다. **Environment 체크박스를 구분하는 게 중요합니다.**

| 이름 | Production | Preview | 설명 |
|---|---|---|---|
| `TURSO_DATABASE_URL` | prod URL | preview URL | 환경마다 다른 값 |
| `TURSO_AUTH_TOKEN` | prod 토큰 | preview 토큰 | 환경마다 다른 값 |
| `APP_PASSWORD` | ✓ | ✓ | 로그인 비밀번호. 인터넷에 공개되므로 길게 |
| `SESSION_SECRET` | ✓ | ✓ | 아무 긴 랜덤 문자열(40자 이상 권장). 바꾸면 모두 로그아웃됨 |
| `ANTHROPIC_API_KEY` | ✓ | ✓ | Anthropic Console에서 발급 (구독과 별도 과금) |
| `DISCOGS_TOKEN` | ✓ | ✓ | Discogs → Settings → Developers → Generate token |
| `MB_CONTACT` | ✓ | ✓ | MusicBrainz User-Agent에 들어갈 연락처(이메일 등). MusicBrainz 요청 규칙 |
| `MONTHLY_BUDGET_USD` | 선택 | 선택 | 예: `10`. 이번 달 추정 비용이 넘으면 생성 전에 경고 |
| `LLM_MODEL` | 선택 | 선택 | 기본 `claude-sonnet-5`. 품질이 부족하면 `claude-opus-5` |
| `LLM_EFFORT` | 선택 | 선택 | 기본 `medium` (`low`/`medium`/`high`) |
| `LLM_FALLBACKS` | 선택 | 선택 | 기본 꺼짐. `on`이면 요청이 거절될 때 다른 모델로 재시도 (Opus 5에서 권장) |
| `LLM_PRICE_INPUT_PER_MTOK`, `LLM_PRICE_OUTPUT_PER_MTOK` | 선택 | 선택 | 단가가 바뀌었을 때 비용 추정 보정용 |

3. 환경변수를 넣은 뒤 Deployments → 최신 배포 → Redeploy.
   빌드할 때 DB 테이블이 자동으로 만들어집니다(`scripts/migrate.ts`).

### 3. 홈 화면에 추가
Safari로 프로덕션 주소 접속 → 공유 버튼 → 홈 화면에 추가. 홈 화면 앱은 Safari와 로그인 쿠키가 분리될 수 있어서 한 번 더 로그인해야 할 수 있습니다.

## 쓰는 법
1. 검색창에 앨범 이름 → MusicBrainz 후보 중 선택 (이때는 메타데이터·커버만 가져옴, API 요금 없음)
2. **노트 만들기** → Wikipedia·Discogs 수집 → Claude로 한국어 노트 작성. 진행 중엔 화면을 열어 두세요. 닫으면 멈추고, 다시 열면 이어서 합니다.
3. 어느 문서가 이 앨범인지 애매하면 멈추고 후보를 보여줍니다. 직접 고르거나 "해당 없음"을 누르세요.

## 구조
- `src/sources/` 소스별 모듈 (musicbrainz, wikipedia, discogs)
- `src/lib/pipeline.ts` job 기반 수집·요약 (job 1개 = API 호출 1번)
- `src/lib/llm.ts` Claude 호출, 프롬프트, 비용 계산
- `src/lib/rate-limit.ts` DB 기반 호출 간격 제한 (MusicBrainz 1.1초, Discogs 1초)
- `src/db/schema.ts` → `npm run db:generate`로 `drizzle/` 마이그레이션 생성
- `tests/` fixture 기반 테스트 (`npm test`). **fixture는 실제 응답이 아니라 문서 기준으로 손으로 만든 샘플** — `tests/fixtures/README.md` 참고
