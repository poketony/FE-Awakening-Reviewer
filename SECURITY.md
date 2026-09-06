# Security

- GitHub PAT를 저장소 파일이나 소스 코드에 넣지 않습니다.
- 모바일 편의를 위해 PAT는 개인 기기의 `localStorage` 키 `fe-awakening-reviewer:github-token:v1`에 저장합니다. 입력칸을 비우면 저장된 토큰도 삭제됩니다.
- 브라우저 저장소는 비밀 금고가 아니므로, 이 기능은 본인 소유의 신뢰하는 휴대폰에서 쓰는 것을 전제로 합니다.
- Fine-grained PAT는 `poketony/FE-Awakening` 하나에 한정하고 **Contents: Read and write**만 추가로 허용합니다. PR 권한은 필요하지 않습니다.
- 모바일 반영은 `main` 직접 커밋이지만, 번역 파일의 원래 blob SHA를 최신 `main`과 다시 비교합니다.
- `Awakening/review-progress.json`은 최신 원격본과 MID별 `updatedAt`으로 병합한 뒤 기록합니다.
- 최종 `main` ref 갱신은 `force: false`이며, 동시 변경으로 fast-forward가 아니면 실패하도록 둡니다.
- Content-Security-Policy는 새 외부 의존성을 추가하지 않는 한 현재 범위를 유지합니다.
