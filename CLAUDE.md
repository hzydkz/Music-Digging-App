# 작업 규칙 (Claude용)

기획서 v0.2 기반 개인용 음악 디깅 노트 앱. 사용자는 아이패드만 쓴다 (로컬 PC 없음).

## 흐름
- 작업 단위마다 브랜치 → PR. PR 설명에 **아이패드에서 확인할 항목**(화면, 가로/세로) 체크리스트를 쓴다.
- **머지는 Claude가 직접 한다** (사용자 지시, 2026-09-26). 조건:
  - `npm run lint`, `npm test`, `npm run build` 통과
  - PR head 커밋의 Vercel 상태가 success
  - 사용자에게 먼저 물어볼 만한 결정(데이터 삭제, DB 스키마를 깨는 변경, 비용이 드는 설정 변경)이 없을 것. 있으면 머지 전에 묻는다.
- 머지 후 사용자에게 무엇이 바뀌었고 정식 주소에서 무엇을 확인하면 되는지 짧게 알린다.
- 머지된 PR의 브랜치에 커밋을 더 쌓지 않는다. 새 작업은 최신 main에서 브랜치를 다시 만든다.

## 환경
- 정식: https://music-digging-app.vercel.app (Turso `digging-prod`)
- 미리보기: `music-digging-app-git-<브랜치>-hzydkz.vercel.app` (Turso `digging-preview`)
- 빌드 시 `scripts/migrate.ts`가 해당 DB에 마이그레이션 적용. 스키마 변경은 `npm run db:generate`로 `drizzle/`에 마이그레이션을 만들어 커밋한다.
- 비밀 값은 Vercel 환경변수에만. 저장소에 커밋 금지.
- 작업 샌드박스에서는 MusicBrainz·Wikipedia·Discogs·Turso로 나가는 연결이 막혀 있다. 테스트는 `tests/fixtures`로만 돈다 (fixture는 손으로 만든 샘플).

## 사용자 안내
- 한국어로, 화면 기준으로 짧게. 로컬에서 실행하라는 안내는 하지 않는다.
- 노트 작성 기본은 수동 모드(claude.ai 붙여넣기). `ANTHROPIC_API_KEY`는 아직 없음.
