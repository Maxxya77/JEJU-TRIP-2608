# Firebase → Supabase 마이그레이션 노트

이 문서는 Claude.ai 채팅에서 논의한 내용을 정리한 것입니다.
Claude Code에서 이 파일을 참고해서 이어서 작업해주세요.

## 현재 상태

- 앱: 제주 3박4일 여행 계획 앱 (index.html 단일 파일, PWA)
- 현재 백엔드: Firebase Firestore (실시간 동기화, 오프라인 캐싱 사용 중)
- 사용자: 2명 (승현, 소영), 인증 없이 localStorage로 신원만 구분
- 목표: Firebase Firestore → Supabase Postgres로 전체 마이그레이션

## Supabase 프로젝트 정보

- Organization: Maxxya77's Org (Free)
- Project name: Maxxya77's Project
- Region: Northeast Asia (Seoul)
- GitHub 연동: 하지 않음 (대시보드에서 직접 테이블 생성하기로 결정)
- Project URL: https://cabdioiaotivisfbgnhc.supabase.co (실제 anon key/DB 비밀번호는 별도 보관 중, 이 파일에 넣지 말 것)

## 현재 Firestore 컬렉션 → 목표 Supabase 테이블 매핑

| Firestore 컬렉션 | 역할 | → Supabase 테이블 | 비고 |
|---|---|---|---|
| `ALL_PLACES` (코드에 하드코딩, ~40개) + `custom_places` | 장소 전체 | `places` | 하드코딩된 장소도 seed 데이터로 테이블에 이관 |
| `hidden_places` | 숨긴 장소 | `places.is_hidden` 컬럼으로 통합 | 별도 테이블 만들지 않기로 결정 |
| `trip_schedule_v6` | 일정에 넣은 장소 | `schedule` | place_id로 places 참조(FK) |
| `packing_items_v3` | 준비물 체크리스트 | `packing_items` | |
| `presence` | 승현/소영 접속 상태 | `presence` | |

### 예상 테이블 컬럼

- **places**: id, name, category, lat, lng, desc, url, is_hidden, created_at
- **schedule**: id, day, place_id (FK → places.id), time, memo, order
- **packing_items**: id, text, seunghyun (bool), soyoung (bool), order
- **presence**: who (seunghyun/soyoung), last_seen

## 진행 상황

- [x] 테이블 스키마 확정 및 생성 (SQL Editor에서 `supabase/schema.sql`, `supabase/seed_places.sql` 실행 완료 — places 49개, schedule/packing_items 초기 데이터 포함)
- [x] RLS: 켜고 anon 허용 정책 추가 (2인 전용 + 인증 없음, 나중에 인증 추가 시 정책만 교체하면 됨)
- [x] index.html의 Firebase SDK 코드를 Supabase JS 클라이언트로 전환 — `js/supabaseClient.js`, `js/places.js`, `js/schedule.js`, `js/packing.js`, `js/presence.js`, `js/map.js`로 기능별 분리
- [x] 실시간 동기화: onSnapshot → `.channel().on('postgres_changes', ...)`로 교체
- [x] 마이그레이션 후 기존 Firebase 코드/설정 제거 (index.html에서 firebaseConfig, SDK import 전부 삭제 확인 완료)
- [x] 로컬 서버로 데이터 흐름(장소/일정/준비물/presence) 테스트 완료 — 카카오맵은 로컬 주소가 카카오 도메인 화이트리스트에 없어서 미확인, 추후 Vercel 배포 시 최종 확인 예정
- [x] 오프라인 캐싱(enableIndexedDbPersistence) 대안 — 구현하지 않기로 결정 (온라인 전용으로 운영)
- [x] Vercel 재배포 후 카카오맵 포함 최종 확인 (git 재연결 → 커밋/푸시 → 자동 배포 → 실기기 테스트까지 완료)
- [x] **실제 Firestore 데이터 이관** (최초 마이그레이션 때 빠뜨렸던 부분, 뒤늦게 발견해서 별도로 진행)
  - custom_places 35개, hidden_places 4개, 실제 편집된 schedule 17개(메모 포함), packing_items 16개, presence 2개를 읽기 전용으로 확인 후 Supabase에 반영
  - 기존 49개 기본 장소는 `created_at`을 2025-01-01로 백데이트해서 "최근 추가순" 정렬 시 커스텀 장소가 위로 오도록 조정
  - 1일차 숙소 체크인 메모는 Firestore 값("신신호텔 천지연점")이 오래된 정보라 최신 정보인 "호텔 징크 서귀포 체크인"으로 수동 반영
  - 이 작업에 쓴 임시 읽기 스크립트는 사용 후 삭제, git에는 커밋되지 않음
  - 커스텀 장소 35개 중 5개(아방닭강정, 협재해수욕장, 안전식당, 서귀포매일올레시장, 사려니숲길)는 Firestore에 생성시각 기록이 없었음 → 이관 직후 "지금" 시각으로 잘못 채워져서 최근 추가순 맨 위에 뜨는 문제 발견, 실제 기록이 남은 것 중 가장 오래된 시각(2026-07-16)보다 이른 2026-07-15로 수동 보정

## 사용자 선호 사항 (Claude Code 작업 시 반드시 지킬 것)

- 코드를 많이 수정해야 하면 먼저 물어보고 진행할 것
- 기능별로 모듈화할 것 (index.html 하나에 다 넣지 말 것)
- 요청이 불명확하면 추측해서 실행하지 말고, 먼저 이해한 내용을 확인받을 것
