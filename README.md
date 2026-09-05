# FE Awakening Reviewer

`poketony/FE-Awakening`의 **파이어 엠블렘 각성 지원회화**를 휴대폰에서 읽고 교정한 뒤, 수정 파일을 한 커밋/PR로 안전하게 반영하기 위한 개인용 PWA입니다.

## 현재 MVP 기능

- `Awakening/Messages (J)` ↔ `Awakening/Messages (K)` 본편 지원회화 자동 페어링
- 각성 지원 DLC 22/23/24의 J/K 파일 자동 페어링
- 일본어 원문과 현재 한국어를 나란히 표시
- MID 단위 이동(C/B/A/S 포함)
- **대사 전용 안전 편집기**: 실제 대사 문자만 입력 가능
- 화자/표정/음성/분기/페이지/게임 줄바꿈 등 제어코드는 편집 UI에서 잠금
- 원본 한국어 대비 제어코드와 `\n` 시퀀스가 달라지면 이중으로 저장 차단
- 전체 게임 스크립트는 읽기 전용 보조 탭에서 확인
- FE-Awakening 라이브 렌더러 자산을 이용한 인게임 미리보기
- 로컬 초안 누적(토큰과 분리)
- 원격 main에서 같은 파일이 바뀌었는지 커밋 직전 재검증
- 수정 파일들을 한 번에 새 `mobile-review/...` 브랜치 + 단일 커밋으로 생성
- 자동 Pull Request 생성
- PWA 설치 가능

## 보안 원칙

이 앱은 공개 FE Support Archive의 숨겨진 관리자 메뉴가 아닙니다. 별도 앱으로 쓰는 것을 전제로 합니다.

- GitHub 토큰을 소스 코드에 넣지 않습니다.
- 입력한 토큰은 `localStorage`, `sessionStorage`, IndexedDB에 저장하지 않고 **현재 페이지의 JS 메모리에만** 둡니다.
- 로컬에 저장되는 것은 수정한 텍스트 초안뿐입니다.
- main에 직접 쓰지 않고 매번 새 브랜치와 PR을 만듭니다.
- 커밋 직전에 각 수정 파일의 blob SHA를 다시 확인하여, 검수 도중 main에서 같은 파일이 바뀌었으면 커밋을 중단합니다.

권장 GitHub Fine-grained PAT 권한:

- Repository access: `poketony/FE-Awakening` 하나만
- Contents: Read and write
- Pull requests: Read and write
- Metadata: Read-only (자동)

토큰은 GitHub 비밀번호 관리자 등에 보관하고 필요할 때만 붙여넣는 방식을 권장합니다.

## 실행

정적 사이트라 빌드가 필요 없습니다. 로컬 테스트:

```bash
python -m http.server 4173
```

그 뒤 `http://localhost:4173`으로 접속합니다.

Node.js가 있다면:

```bash
npm test
npm run check
```

## 배포

새 저장소(예: `FE-Awakening-Reviewer`)의 루트에 그대로 올리고 GitHub Pages를 활성화하면 됩니다. GitHub Pages는 HTTPS이므로 PWA/service worker도 정상 동작합니다.

## 검수 흐름

1. 본편/DLC에서 회화 파일 선택
2. MID 선택
3. 일본어 원문과 현재 한국어 확인
4. `대사만 편집`에서 교정할 문장만 수정
5. `구조 잠금 정상` 표시 확인 (필요하면 `스크립트 확인` 탭에서 원문 구조 열람)
6. 인게임 미리보기에서 프레임 이동하며 확인
7. `로컬 초안 저장`
8. 여러 파일을 검수한 뒤 Fine-grained PAT 입력
9. `커밋 + PR 만들기`
10. 생성된 PR에서 최종 diff 확인 후 merge

## 대사 전용 안전 편집기

기본 편집 화면은 MID 스크립트를 **잠긴 제어 토큰 + 편집 가능한 대사 조각**으로 분해합니다. `$Ws`, `$Wm`, `$E`, `$Svp`, `$k`, `$p`, `$Nu`, `$G`, `\n` 등은 사용자가 입력칸에서 직접 건드릴 수 없습니다. `$Nu`나 성별 분기처럼 문장 중간에 끼는 토큰이 있으면 대사 입력칸이 둘 이상으로 나뉘며, 토큰은 그대로 보존됩니다.

입력칸에는 `$`, 실제 Enter 줄바꿈, `\n`을 넣을 수 없고 저장 직전에도 전체 제어 토큰 시퀀스를 원본과 다시 비교합니다. 따라서 일반 맞춤법/문장 교정 작업으로 게임 스크립트 구조가 바뀌지 않도록 이중 방어합니다. 줄바꿈이나 제어코드 자체를 수정해야 하는 특수 검수는 이 MVP의 범위 밖이며 PC에서 기존 도구를 쓰는 것을 전제로 합니다.

인게임 렌더러는 FE-Awakening `main`의 `Awakening/Awakening-Live-Renderer/assets/awakening/` 자산을 직접 읽습니다. 따라서 폰트/초상화 자산이 갱신되면 Reviewer도 최신 자산을 사용합니다.

## 라이선스

인게임 렌더링 로직은 FE Support Archive / Awakening Live Renderer의 구조를 참고해 작성되었으며, 해당 계보의 GPL-3.0 조건을 따르는 것을 전제로 합니다. 별도 배포 시 원 프로젝트의 라이선스 고지를 함께 유지하세요.
