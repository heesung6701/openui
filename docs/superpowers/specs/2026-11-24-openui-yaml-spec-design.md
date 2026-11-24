# OpenUI 설계 — UI 컴포넌트 YAML 스펙 + 웹 에디터 검증 (Material 3)

## Context

- 목표: UI 컴포넌트를 OpenAPI처럼 YAML로 스펙화한다. **YAML이 SSOT**이고, **스펙(YAML 포맷) 정의가 메인 산출물**이다. 도구는 스펙을 검증하는 수단이다.
- 용도: 디자인↔개발 SSOT. 플랫폼별 렌더러(Compose, React…)는 이후 별도로 만든다. 렌더러는 스펙만 보고 코드를 만들 수 있어야 한다.
- 참고 자료:
  - **Figma REST API 스펙 문서** `figma/rest-api-spec`(`dist/api_types.ts`, `openapi/openapi.yaml`). Figma 개념(variables·modes, auto layout, variant, component property, SLOT)의 어휘와 매핑은 이 문서를 기준으로 삼는다.
  - 당근 seed-design `ecosystem/rootage` 벤치마킹.
- 방향 전환(2026-11-24):
  - Figma를 실제로 실행해 검증하는 것(플러그인, REST 호출, 왕복 비교)은 **하지 않는다**. 사용자가 Figma 구독을 해지했고, REST 스펙 문서만으로 충분하다고 판단함.
  - 검증 수단은 **웹 기반 YAML 에디터(텍스트 + 라이브 프리뷰)**와 **컴포넌트별 체크리스트(자동 + 수동)**다.
- 사용자 결정 요약:
  - 스펙: rootage 개념 차용 + 자체 스키마
  - 토큰: DTCG 2025.10 그대로
  - Material 소스: 토큰 + 구조
  - 에디터: 텍스트 + 라이브 프리뷰
  - 체크리스트: 자동 + 수동 혼합
  - 실행 방식: Native

## rootage에서 가져오는 것 / 채우는 것

| 가져옴 | 우리가 추가 |
|---|---|
| `kind / metadata / data` 리소스 모델 | `props`: 컴포넌트 공개 API(text/boolean/instance/slot) |
| variant 조합 × state × part × property 스타일 표 | `anatomy`: part 계층 트리 + layout(auto layout 어휘) |
| authoring YAML ↔ exchange JSON 분리, 렌더러 = generator 함수 | `slots`: Figma SLOT ↔ React children ↔ Compose 람다 |
| 첫 줄 `# yaml-language-server: $schema=` | `x-figma`: Figma 고유 정보(REST 필드명 그대로) |
| part 이름은 public contract, 최상위 part는 `root` | 웹 프리뷰 + 체크리스트로 검증 |

용어: rootage의 `slot`(=part)은 **`parts`**, Figma SLOT은 **`slots`**.

## 스펙 설계

세부 규칙은 M1 계획의 "Spec v0.1 결정"(§T, §C, §L/§P, §R)이 단일 원천이다. 여기에는 요점만 적는다.

### 1. 문서 구성

| 파일 | 내용 |
|---|---|
| `openui.yaml` | 루트 매니페스트. `openui: "0.1"`, `info`, `tokens`(resolver 경로), `components`(glob 목록), `checklists?`(glob 목록) |
| `tokens/*.tokens.yaml` | DTCG 2025.10 Format을 YAML로 표기 |
| `tokens/*.resolver.yaml` | DTCG Resolver 2025.10. 모드(light/dark)를 정의 |
| `components/*.yaml` | `kind: Component` |
| `checklists/*.yaml` | `kind: Checklist` (M2) |

### 2. 토큰 (DTCG 프로필)

- `$value / $type` 형식. 참조는 `"{a.b.c}"`(YAML에서는 반드시 따옴표).
- color는 `srgb` 객체만 허용한다.
- 지원 타입은 10종: color, dimension, number, duration, cubicBezier, fontFamily, fontWeight, shadow, typography, gradient.
- Figma 대응:
  - resolver의 set → 모드가 `default` 하나인 컬렉션
  - resolver의 modifier → context 이름들이 모드인 컬렉션
  - Figma 전용 정보는 `$extensions["com.figma"]`에 둔다.
- 웹 대응: 토큰 하나 = CSS 커스텀 프로퍼티 하나(`--md-sys-color-primary`). modifier context는 `data-<modifier>="<context>"` 속성으로 전환한다.

### 3. 컴포넌트 (`kind: Component`)

- 구성: `props`, `variants`, `states`(v0.1은 단일 state 식), `anatomy`(part 트리 + layout), `styles`(variant 식 → state → part → property), `x-figma`, `x-*`.
- part 종류는 `frame | text | instance | slot | vector | image`.
  - vector는 `svg: {viewBox, d}`를 가진다. 아이콘은 Material Symbols path.
  - image는 `src`를 가진다.
- 속성 어휘는 Figma auto layout과 paint를 플랫폼 중립 이름으로 옮긴 것이다.
  - 레이아웃: direction, gap, crossGap, padding, align, wrap, grid, width/height(`hug|fill|dim`), min/max, position, x, y
  - 시각: fill, fillOpacity, strokeColor, strokeWidth, strokeAlign, cornerRadius, opacity, shadow, visible
  - 텍스트: color, typography, textAlign
- 스타일 해석: anatomy layout → 기본 state 계층 → 현재 state 계층. 같은 계층 안에서는 축 개수가 적은 것부터 문서 순서로 덮어쓴다(state 계층이 variant 구체성보다 우선).

### 4. Exchange 포맷 (0.2)

- 모드별 resolved 값을 담는다.
- 스타일 표를 variant × state 전체 조합으로 펼친 정규화 JSON이다.
- 렌더러용. 웹 프리뷰는 0.1에서 authoring 문서를 직접 해석한다(`resolveStyles`).

### 5. 체크리스트 (`kind: Checklist`)

- 컴포넌트당 파일 하나. 항목은 두 종류다.
  - **자동**: `check: {variant?, state?, mode?, part, property, expect}`
    - 렌더된 DOM에서 `getComputedStyle(part)[property]`를 읽어 `expect`와 비교한다.
    - `expect`는 리터럴(`40px`) 또는 토큰 참조(`"{md.sys.color.primary}"`)다.
    - variant/state/mode를 생략하면 모든 값에 대해 검사한다.
  - **수동**: `manual: true`. 사람이 프리뷰를 보고 체크한다. 리플, 포커스 링, 터치 타깃 같은 항목.
- 기대값은 **M3 공식 스펙**에서 가져온다(sys 토큰 또는 리터럴). 컴포넌트 YAML은 comp 토큰을 쓰므로, 체크리스트는 "comp→sys 매핑 + YAML 작성 + 렌더러"를 교차 검증하게 된다.

### 6. Figma 매핑 부록

스펙 문서 안에 `개념 | REST 필드(api_types.ts) | Plugin API` 표를 둔다. REST 스펙 문서 기준이며, 실제 Figma로 검증하지는 않는다.

## 웹 에디터 (M2)

- 형태: 로컬 웹앱 하나. `bun editor/server.ts <projectDir>`로 실행.
- 레이아웃:
  - 왼쪽: 파일 목록
  - 가운데: CodeMirror 6 YAML 편집기
  - 오른쪽: 프리뷰와 체크리스트 패널
  - 툴바: modifier별 모드 선택(light/dark), 저장(⌘S)
- **YAML → YAML**: 편집한 텍스트 그대로 디스크에 저장한다(주석 보존). 비주얼 편집은 비범위(다음 단계).
- 진단:
  - 편집할 때마다 200ms debounce 후 프로젝트 전체를 브라우저에서 재검증한다. M1과 같은 zod 스키마 + 의미 검증기를 사용한다.
  - 진단은 CodeMirror lint로 해당 줄에 표시한다.
  - 자동완성: `"{`를 입력하면 토큰 경로. 속성명 오타는 진단이 잡으므로 속성명 자동완성은 다음 단계로 미룸.
- 프리뷰:
  - variant 조합(행) × state(열) 그리드.
  - props 컨트롤: text 입력, boolean 체크, instance 선택.
  - slot은 점선 placeholder로, instance는 대상 컴포넌트를 재귀 렌더한다(순환 방지).
- 렌더러:
  - 순수 함수로 스펙을 DOM + CSS로 바꾼다. 토큰은 CSS 변수 시트로 둔다.
  - 매핑 표는 M2 계획 §W가 원천이다.
- 서버(Bun.serve):
  - HTML을 번들해서 서빙한다.
  - `GET /api/files`, `GET /api/file?path=`, `PUT /api/file?path=`
  - `127.0.0.1`에만 바인딩한다. 경로는 프로젝트 루트 밖으로 못 나가게 막고 `.yaml`만 허용한다. Host 헤더를 검사한다(DNS rebinding 방지).

## Material 3 데이터 (M3)

- **토큰**: material-web `tokens/versions/v0_192/*.scss`(Apache-2.0, 커밋 고정)를 변환한다.
  - `scripts/material-web-tokens.ts`가 정규식으로 파싱한다(SCSS를 실행하지 않음).
  - 출력은 `ref`, `sys`, `sys-color-light/dark`, `comp` 토큰 파일과 resolver.
  - typescale은 typography 복합 토큰으로 합성한다. lineHeight는 px/size 비율로 변환.
  - elevation 그림자는 material-web의 elevation SCSS를 보고 직접 옮겨 적는다.
- **컴포넌트(파일럿 5종)**: Button, Icon button, Checkbox, Filter chip, Card.
  - M3 스펙과 comp 토큰을 보고 직접 작성한다.
  - 아이콘은 `icon-add`, `icon-check`, `icon-remove`처럼 개별 컴포넌트(Material Symbols, Apache-2.0).
- **체크리스트 5종**: 아래 커버리지 규칙을 지킨다.
  - variant 값마다 자동 항목이 1개 이상
  - state마다 자동 항목이 1개 이상
  - light와 dark 모두 검사
  - 수동 항목은 포커스 링, 리플, 터치 타깃 48dp, 긴 라벨 처리

## 구현 구조 (단일 패키지, Bun)

- 의존성:
  - `zod@^4`, `yaml@^2`
  - 에디터: `codemirror`, `@codemirror/lang-yaml`, `@codemirror/lint`, `@codemirror/autocomplete`
  - dev: `typescript`, `@types/bun`

```
spec/openui-spec.md          # ★ 메인 산출물
schema/*.schema.json         # 생성물 (component, manifest, checklist)
src/                         # 코어: io, yaml, tokens/, component/, checklist/, project, cli — 브라우저/CLI 공용
src/render/                  # 웹 렌더러: tokens→CSS, part→CSS, DOM 빌드
editor/                      # index.html, app.ts, server.ts
scripts/                     # gen-schema, material-web-tokens
examples/conformance/        # 개념별 최소 픽스처
examples/material3/          # M3 토큰·컴포넌트·체크리스트
```

## 마일스톤

| # | 내용 | 완료 기준 |
|---|---|---|
| M1 스펙 v0.1 | 스펙 문서 + zod 스키마 + JSON Schema + `openui validate` + conformance 픽스처 | `bun test` 통과, conformance 검증 통과, 사용자 스펙 리뷰 |
| M2 웹 에디터 | 서버 + 편집기 + 진단 + 프리뷰 렌더러 + 체크리스트 러너 | conformance 4종이 에디터에서 렌더되고, 수정→저장→재검증 동작 |
| M3 Material 3 | 토큰 변환 + 파일럿 5종 YAML + 체크리스트 5종 | 5종 모두 자동 항목 전부 통과, 수동 항목은 사용자 확인 |

## 검증

1. `bun test`: 코어, 렌더러 순수 함수, 서버 경로 가드, 토큰 변환기.
2. `bun src/cli.ts validate examples/conformance` / `examples/material3` → `ok:`.
3. 에디터 E2E:
   - `bun editor/server.ts examples/material3` 실행 후 gstack `/browse`로 연다.
   - 각 컴포넌트에서 `window.__openui.checklist` 결과를 확인한다. 자동 항목 실패가 0이어야 한다.
   - 스크린샷으로 light/dark 그리드를 확인한다.

## 비범위

- Figma 플러그인, REST 호출, Figma 왕복 비교. `x-figma`는 향후 왕복을 위해 남겨둠.
- Compose/React 프로덕션 렌더러. 웹 프리뷰는 검증용이다.
- 비주얼(인스펙터) 편집. 다음 단계.
- exchange 포맷 확정(0.2), 리플 애니메이션 같은 모션.

## 리스크

- **리플, 포커스 링 오프셋**은 v0.1 어휘로 표현하지 못한다. → 수동 체크리스트로 확인하고, 미해결 과제에 기록.
- **variant 조합 중 존재하지 않는 것**(예: chip에서 쓰지 않는 조합)을 제외할 방법이 없다. → 미해결 과제.
- **material-web은 유지보수 모드**다. → v0.192 커밋을 고정한다.
- **M3 elevation 그림자**는 직접 옮겨 적은 값이라 오차 가능성이 있다. → 체크리스트 수동 항목으로 확인.
- **이름 충돌**: "OpenUI"는 W3C Open UI CG와 겹친다. → 공개 전에 재검토.
