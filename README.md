# openui

UI 컴포넌트를 OpenAPI처럼 YAML로 기술하는 스펙(v0.1)과, 그 스펙을 검증하는 도구 모음이다. **YAML이 단일 원천(SSOT)**이다.

- **스펙**: [spec/openui-spec.md](spec/openui-spec.md)
  - 토큰은 DTCG 2025.10 형식이다.
  - 컴포넌트는 props / variants / states / anatomy(auto layout) / styles / slots로 기술한다.
  - Figma 매핑과 웹(CSS) 매핑은 스펙 부록에 있다.
- **웹 에디터**: <https://heesung6701.github.io/openui/>
  - YAML을 편집하면 실시간으로 검증한다.
  - variant×state 그리드로 프리뷰하고 light/dark를 전환할 수 있다.
  - 컴포넌트별 체크리스트를 자동 측정 + 수동 체크로 확인한다.
- **예제**:
  - [examples/material3](examples/material3): Material 3 파일럿 5종. 토큰은 material-web v0.192에서 변환했다.
  - [examples/conformance](examples/conformance): 스펙 개념별 최소 픽스처.

## 실행

```bash
bun install
bun test                                        # 단위 테스트
bun src/cli.ts validate examples/material3      # 스키마·의미 검증 → ok: 768 tokens, 9 components
bun editor/server.ts examples/material3         # 로컬 에디터 http://127.0.0.1:4173 (⌘S로 디스크에 저장)
bun run deploy:pages                            # 정적 빌드 → gh-pages 브랜치 (GitHub Pages)
```

Pages 버전은 서버가 없어서 저장 방식이 두 가지다.
- 예제 프로젝트: Save를 누르면 파일을 다운로드한다.
- **Open folder…**(Chromium의 File System Access API): 로컬 폴더의 YAML을 직접 고쳐 쓴다.

## Material 3 검증 결과

컴포넌트별 체크리스트(`examples/material3/checklists/*.yaml`)의 자동 항목 결과. 렌더된 DOM의 computed style을 기대값과 비교하며, light와 dark 모두 검사한다.

| 컴포넌트 | 자동 | 수동 | 스크린샷 |
|---|---|---|---|
| Button (filled/outlined/text/elevated/tonal × withIcon) | 33/33 | 4 | [light](docs/screenshots/button-light.png) · [dark](docs/screenshots/button-dark.png) |
| Icon button (standard/filled/tonal/outlined) | 21/21 | 4 | [light](docs/screenshots/icon-button-light.png) · [dark](docs/screenshots/icon-button-dark.png) |
| Checkbox (unselected/selected/indeterminate × error) | 27/27 | 4 | [light](docs/screenshots/checkbox-light.png) · [dark](docs/screenshots/checkbox-dark.png) |
| Filter chip (selected) | 24/24 | 3 | [light](docs/screenshots/filter-chip-light.png) · [dark](docs/screenshots/filter-chip-dark.png) |
| Card (elevated/filled/outlined) | 19/19 | 2 | [light](docs/screenshots/card-light.png) · [dark](docs/screenshots/card-dark.png) |

- 수동 항목(포커스 링, 리플, 터치 타깃, 긴 라벨 등)은 v0.1 어휘로 표현하지 못하는 부분이다. 에디터 체크리스트 패널에서 체크한다.
- 에디터 콘솔에서 `await window.__openui.runAll()`을 실행하면 자동 항목을 다시 돌릴 수 있다.

## 구조

```
spec/            스펙 문서 (메인 산출물)
schema/          JSON Schema (yaml-language-server용, zod에서 생성)
src/             검증기·스타일 해석·체크리스트·웹 렌더러 (브라우저/CLI 공용)
editor/          웹 에디터 (Bun 서버 / 정적 Pages 빌드)
scripts/         gen-schema, material-web 토큰 변환, Pages 빌드·배포
examples/        material3, conformance
docs/superpowers 설계 문서와 실행 계획
```
