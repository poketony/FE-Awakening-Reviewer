# FE Awakening Reviewer

`poketony/FE-Awakening`의 **파이어 엠블렘 각성 지원회화**를 휴대폰에서 읽고 교정하고, PC의 `Awakening-Live-Renderer`와 같은 검수 진행 기록을 공유하기 위한 개인용 PWA입니다.

## 현재 검수 모델

두 도구는 `FE-Awakening/Awakening/review-progress.json`을 공용 검수 기록으로 사용합니다.

- 상태: **미검수 / 확인 완료 / 수정 필요 / 보류**
- 식별자: 한국어 파일 경로 + 실제 MID
- `_PCM2`, `_PCM3`, `_PCF2`, `_PCF3` 등 진행도 제외 변형은 완료율에서 제외
- 큰 퍼센트: **검수 완료 파일 / 전체 파일**
- 보조 퍼센트: **확인 완료 MID / 전체 검수 대상 MID**
- `확인 완료`가 파일의 모든 검수 대상 MID에 찍혀야 파일 자체가 완료됩니다.
- 상태마다 `updatedAt`을 저장하므로 PC/폰 기록을 합칠 때 MID별 최신 상태가 이깁니다.
- `미검수`로 되돌린 것도 tombstone으로 남겨 오래된 `확인 완료`가 다른 기기에서 되살아나는 일을 막습니다.

## 주요 기능

- 본편 `Awakening/Messages (J)` ↔ `Awakening/Messages (K)` 자동 페어링
- 지원 DLC 22/23/24 J/K 자동 페어링
- 일본어/한국어 인게임 렌더링과 장면 번호 동기화
- 한국어 대사만 수정하는 안전 편집기
- 화자·표정·음성·페이지·분기 등 제어코드 잠금
- 기존 게임 줄바꿈 구조가 바뀌면 저장 차단
- 로컬 초안 누적
- 4상태 검수 기록과 파일 완료율
- 공용 `review-progress.json`을 PC 라이브 렌더러와 동기화
- 최신 `main`과 각 수정 파일 SHA를 다시 확인한 뒤 **main에 직접 fast-forward 커밋**
- 번역 수정이 없어도 검수 기록만 GitHub에 반영 가능
- PWA 설치 가능

## Fine-grained PAT

이 도구는 개인용으로 `main`에 직접 반영합니다. PAT는 다음처럼 최소 권한으로 발급합니다.

- **Resource owner**: `poketony`
- **Repository access**: `Only select repositories`
- 저장소: **`FE-Awakening` 하나만**
- **Contents: Read and write**
- **Metadata: Read-only**

Pull requests, Actions, Administration, Workflows, Pages, Secrets 권한은 필요하지 않습니다.

입력한 PAT는 편의를 위해 이 기기의 브라우저 `localStorage`에 저장합니다. 다음에 앱을 열면 자동으로 입력칸에 복원되므로 매번 다시 붙여넣을 필요가 없습니다. 저장된 토큰을 지우려면 PAT 입력칸의 내용을 모두 삭제하면 됩니다.

이 방식은 개인 휴대폰처럼 신뢰하는 기기를 전제로 합니다. 브라우저 사이트 데이터에 접근할 수 있는 사람이나 동일 출처에서 실행되는 악성 스크립트가 있다면 저장된 토큰도 읽을 수 있으므로, 토큰은 계속 **FE-Awakening 하나에만 제한된 Fine-grained PAT**를 사용하세요.

## 휴대폰 검수 순서

1. 본편 또는 DLC를 고릅니다.
2. 지원회화를 선택합니다.
3. C/B/A/S 또는 DLC 회화 단계를 선택합니다.
4. 일본어 원문과 한국어 번역을 같은 장면 번호로 비교합니다.
5. 수정이 필요하면 한국어 대사만 고칩니다.
6. 구조 검증이 정상인지 확인하고 `현재 수정 저장`으로 로컬 초안에 저장합니다.
7. 상태를 `확인 완료`, `수정 필요`, `보류`, `미검수` 중 하나로 지정합니다.
8. 검수한 파일들을 계속 누적합니다.
9. 작업 묶음이 끝나면 **`GitHub에 반영`**을 누릅니다. 저장된 PAT가 있으면 자동으로 사용합니다.
10. 도구가 최신 `main`, 번역 파일 SHA, 공용 검수 기록을 다시 읽어 충돌을 검사합니다.
11. 문제가 없으면 번역 수정 + `Awakening/review-progress.json`을 한 커밋으로 `main`에 직접 반영합니다.

반영 직전에는 브라우저 확인창으로 번역 수정 파일 수와 검수 기록 변경 여부를 보여 줍니다. `main`이 그 사이 움직이면 force push하지 않고 중단합니다.

## PC와 이어서 작업하기

폰에서 `GitHub에 반영`한 뒤 PC에서 FE-Awakening 저장소를 Pull합니다.

`Awakening-Live-Renderer`는 `Awakening/review-progress.json`을 연결해 두면 같은 MID 상태를 사용합니다. PC에서 검수 상태를 바꾸면 이 JSON이 로컬 저장소의 변경 파일로 잡히므로, 평소처럼 commit/push하면 휴대폰에서도 다음 로드 때 같은 상태를 읽습니다.

즉 동기화 흐름은 다음과 같습니다.

`폰 검수 → main 반영 → PC Pull → PC 검수 → commit/push → 폰 새로고침`

별도 서버는 사용하지 않습니다.

## 안전장치

모바일에서 `main`에 직접 쓰지만 무조건 덮어쓰지는 않습니다.

- 검수 시작 당시 번역 파일 blob SHA와 최신 `main` SHA가 다르면 반영 중단
- 공용 진행 기록은 최신 원격본과 MID별 `updatedAt` 기준으로 병합
- 최종 ref 갱신은 `force: false`
- 커밋 생성 후 그 사이 `main`이 움직이면 fast-forward가 아니므로 GitHub가 갱신을 거부
- PAT는 저장소나 소스 코드에 넣지 않고, 개인 기기의 브라우저 저장소에만 보관

## 로컬 데이터

휴대폰에는 다음이 남습니다.

- 번역 초안: `fe-awakening-reviewer:drafts:v1`
- 공용 검수 기록 캐시: `fe-awakening-reviewer:review-progress:v2`
- GitHub PAT: `fe-awakening-reviewer:github-token:v1`

기존 v1 완료 체크는 파일을 열 때 실제 MID에 맞춰 가능한 범위에서 v2 `확인 완료` 상태로 마이그레이션합니다.

**Chrome 사이트 데이터 삭제는 초안, 로컬 검수 기록, 저장된 PAT까지 지울 수 있으므로 캐시 문제 해결용으로 사용하지 않는 것을 권장합니다.**

## 특수 스크립트 수정

모바일 편집기는 일반 번역/맞춤법/문장 교정용입니다. 화자, 표정, 음성, 성별 분기, `$k`, `$p`, `$Nu`, `$G` 같은 제어코드 자체를 바꾸는 작업은 PC 도구에서 처리하는 편이 안전합니다.

## 개발

정적 사이트라 별도 빌드는 없습니다.

```bash
python -m http.server 4173
npm test
npm run check
```

## 라이선스

인게임 렌더링 로직은 FE Support Archive / Awakening Live Renderer 계보의 GPL-3.0 조건을 따릅니다. 별도 배포 시 원 프로젝트의 라이선스 고지를 유지하세요.