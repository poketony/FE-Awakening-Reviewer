# Security

- GitHub PAT를 저장소 파일이나 소스 코드에 넣지 않습니다.
- 앱은 PAT를 `localStorage`, `sessionStorage`, IndexedDB에 저장하지 않고 현재 페이지 메모리에서만 사용합니다.
- Fine-grained PAT는 `poketony/FE-Awakening` 하나에 한정하고 **Contents: Read and write**만 추가로 허용합니다. PR 권한은 필요하지 않습니다.
- 모바일 반영은 `main` 직접 커밋이지만, 번역 파일의 원래 blob SHA를 최신 `main`과 다시 비교합니다.
- `Awakening/review-progress.json`은 최신 원격본과 MID별 `updatedAt`으로 병합한 뒤 기록합니다.
- 최종 `main` ref 갱신은 `force: false`이며, 동시 변경으로 fast-forward가 아니면 실패하도록 둡니다.
- Content-Security-Policy는 새 외부 의존성을 추가하지 않는 한 현재 범위를 유지합니다.
