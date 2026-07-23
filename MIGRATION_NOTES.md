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

## 아직 결정 안 된 것 / Claude Code에서 이어서 논의할 것

- [ ] 위 테이블 스키마 최종 확정 (Supabase 대시보드에서 직접 만들지, SQL로 만들지)
- [ ] Row Level Security(RLS) 정책 필요 여부 (2인 전용 앱이라 지금은 불필요할 수 있음)
- [ ] index.html의 Firebase SDK 코드 (onSnapshot, addDoc, updateDoc 등)를 Supabase JS 클라이언트로 전환
- [ ] 실시간 동기화: onSnapshot → `.channel().on('postgres_changes', ...)`로 교체
- [ ] 오프라인 캐싱(enableIndexedDbPersistence)은 Supabase에 동급 기능이 약해서 대안 필요할 수도 있음
- [ ] 마이그레이션 후 기존 Firebase 코드/설정 제거

## 사용자 선호 사항 (Claude Code 작업 시 반드시 지킬 것)

- 코드를 많이 수정해야 하면 먼저 물어보고 진행할 것
- 기능별로 모듈화할 것 (index.html 하나에 다 넣지 말 것)
- 요청이 불명확하면 추측해서 실행하지 말고, 먼저 이해한 내용을 확인받을 것
