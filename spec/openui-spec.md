# OpenUI YAML 스펙 v0.1

> 상태: 초안(v0.1). UI 컴포넌트를 OpenAPI처럼 YAML로 기술하는 스펙이다.
> 참조 구현: 이 저장소의 `src/`(검증기·스타일 해석기)와 `examples/conformance/`(적합성 픽스처).

## 1. 소개

### 1.1 목적

OpenUI는 디자인 토큰과 UI 컴포넌트를 YAML 문서로 기술한다. **YAML 문서가 단일 원천(SSOT)**이다.
- Figma 컴포넌트, 웹·Compose·React 구현은 모두 이 문서에서 파생되거나 이 문서와 대조된다.
- 플랫폼별 렌더러는 이 스펙만 읽고 구현할 수 있어야 한다.

### 1.2 용어

| 용어 | 뜻 |
|---|---|
| 토큰(token) | 이름이 붙은 디자인 값. DTCG 형식 |
| 컬렉션(collection) | 토큰 묶음. 하나 이상의 모드를 가진다 |
| 모드(mode) | 같은 토큰의 맥락별 값(예: light/dark) |
| part | 컴포넌트 해부도(anatomy)의 한 요소. 예: `root`, `label`, `icon` |
| slot | 사용 측이 임의 콘텐츠를 넣는 자리. Figma SLOT, React children, Compose `@Composable` 람다에 해당 |
| prop | 컴포넌트 공개 API. text / boolean / instance / slot |
| variant | 작성 시점에 고르는 외형 축. 예: `style=filled` |
| state | 런타임 상호작용 상태. 예: `enabled`, `pressed` |

rootage에서 `slot`은 part를 뜻하지만, OpenUI에서는 **part와 slot을 구분**한다.

### 1.3 참고 자료와 차용한 것

- **당근 seed-design `rootage`**:
  - `kind / metadata / data` 리소스 모델
  - variant 조합 × state × part × property 스타일 표
  - authoring(사람이 쓰는 형식)과 exchange(렌더러용 형식)의 분리
  - `# yaml-language-server: $schema=` 관례
- **W3C DTCG 2025.10** (Format, Color, Resolver 모듈): 토큰 파일 형식과 모드 정의를 그대로 쓴다.
- **Figma REST API 스펙** (`figma/rest-api-spec`의 `dist/api_types.ts`):
  - 레이아웃·paint·component property·variable 개념의 어휘를 가져왔다.
  - 매핑은 [부록 A](#부록-a-figma-매핑)에 있다.

## 2. 문서 구성과 매니페스트

프로젝트 루트에 `openui.yaml`을 둔다.

```yaml
# yaml-language-server: $schema=../../schema/manifest.schema.json
openui: "0.1"                         # 필수, 고정값
info: { title: …, version: …, description?: … }
tokens: tokens/<name>.resolver.yaml   # DTCG Resolver 문서 경로(루트 기준)
components: ["components/*.yaml"]     # 컴포넌트 문서 glob 목록(1개 이상)
checklists?: ["checklists/*.yaml"]    # 체크리스트 문서 glob 목록(8장)
```

- glob 문법: `*`는 슬래시를 제외한 문자열, `?`는 한 글자, `**/`는 0개 이상의 디렉터리.
- 파일 배치는 자유이고, 예시는 `examples/conformance/`를 따른다.
- 모든 문서는 **YAML 1.2**로 해석한다.
  - 같은 맵에 중복 키가 있으면 오류다.
  - 따옴표 없는 `{a.b}`는 YAML에서 mapping이 된다. 검증기는 이를 감지해 `alias must be a quoted string` 힌트를 낸다.
- 편집기 지원용 JSON Schema: `schema/manifest.schema.json`, `schema/component.schema.json`, `schema/checklist.schema.json`(zod 스키마에서 생성).
- **흔한 YAML 실수 두 가지**는 검증기가 직접 힌트를 준다.
  - 따옴표 없는 alias: `{a.b}`
  - `{ }` 안의 따옴표 없는 쉼표: `{ description: a, b }`는 `b`를 값 없는 키로 만든다.

## 3. 토큰

### 3.1 토큰 파일 (DTCG 2025.10 프로필)

`*.tokens.yaml`은 DTCG Format 2025.10의 JSON을 YAML로 표기한 것이다.

- `$value`가 있는 객체는 **token**, 없는 객체는 **group**이다. `$value`와 자식이 함께 있으면 오류.
- 이름은 `$`로 시작할 수 없고 `{`, `}`, `.`를 포함할 수 없다.
- 토큰 경로는 이름을 `.`으로 이은 것이다. 예: `md.sys.color.primary`
- `$type` 결정 순서: 직접 지정 → (값이 alias면) 대상 토큰의 타입 → 가장 가까운 부모 group의 `$type` → 없으면 오류.
- `$description`, `$deprecated`, `$extensions`를 허용한다.

### 3.2 지원 타입과 값

| `$type` | `$value` |
|---|---|
| `color` | `{colorSpace: "srgb", components: [r, g, b], alpha?, hex?}`. 성분과 alpha는 0..1, hex는 `#rrggbb`. **v0.1은 `srgb`만 지원**하고 hex 문자열 단독 사용은 금지 |
| `dimension` | `{value: number, unit: "px" \| "rem"}` |
| `number` | number |
| `duration` | `{value: number, unit: "ms" \| "s"}` |
| `cubicBezier` | `[x1, y1, x2, y2]`, x는 0..1 |
| `fontFamily` | string 또는 string[] |
| `fontWeight` | 1..1000 또는 DTCG 이름(`thin`, `hairline`, `extra-light`, `ultra-light`, `light`, `normal`, `regular`, `book`, `medium`, `semi-bold`, `demi-bold`, `bold`, `extra-bold`, `ultra-bold`, `black`, `heavy`, `extra-black`, `ultra-black`) |
| `shadow` | `{color, offsetX, offsetY, blur, spread, inset?}` 또는 그 배열 |
| `typography` | `{fontFamily, fontSize, fontWeight, letterSpacing, lineHeight}`. lineHeight는 fontSize의 배수(number) |
| `gradient` | `[{color, position: 0..1}]` |

**alias**:
- 값 전체가 `"{a.b.c}"`인 문자열이다. 복합 값의 하위 필드(예: shadow의 `color`)에도 쓸 수 있다.
- 대상은 group이 아닌 token이어야 하고, 그 위치가 기대하는 타입과 같아야 한다.
- 순환 참조는 오류다.

**v0.1 미지원**(검증기 메시지 `unsupported in openui 0.1`):
- JSON Pointer `$ref`, `$extends`, `$root`
- 위 표에 없는 `$type`(`border`, `strokeStyle`, `transition` 등)
- string/boolean 변수

**`$extensions["com.figma"]`**: `{scopes?: string[], codeSyntax?: {WEB?, ANDROID?, iOS?}, hiddenFromPublishing?: boolean}`. 그 밖의 `$extensions` 키는 검사하지 않고 보존한다.

### 3.3 Resolver와 모드

모드는 DTCG Resolver 2025.10 문서(`*.resolver.yaml`)로 정의한다.

```yaml
version: "2025.10"
sets:      { base: { sources: [{ $ref: base.tokens.yaml }] } }
modifiers: { theme: { contexts: { light: [{ $ref: light.tokens.yaml }], dark: [{ $ref: dark.tokens.yaml }] }, default: light } }
resolutionOrder: [{ $ref: "#/sets/base" }, { $ref: "#/modifiers/theme" }]
```

- `version: "2025.10"` 필수.
- source는 `{$ref: <resolver 파일 기준 상대경로>}`만 허용한다. 인라인 토큰 객체는 v0.1에서 미지원.
- `modifiers.<m>.default`를 생략하면 첫 context가 기본값이다.
- `resolutionOrder`에는 모든 set과 modifier가 정확히 한 번씩 나와야 한다.
- 같은 source 목록 안에서는 뒤의 파일이 이긴다.

### 3.4 컬렉션 대응 규칙

| resolver | 컬렉션 | 모드 |
|---|---|---|
| set `s` | 컬렉션 `s` | `["default"]` |
| modifier `m` | 컬렉션 `m` | context 이름들. 기본 모드 = `default` |

- 토큰 경로 하나는 **정확히 한 set**, 또는 **정확히 한 modifier의 모든 context**에 정의되어야 한다.
- 한 context에서 빠진 토큰은 오류다. 예: `"bg" missing in context "dark" of modifier "theme"`
- 이 규칙 덕분에 Figma variable collection/mode로도, 웹의 CSS 변수 + `data-<modifier>` 속성으로도 손실 없이 옮길 수 있다.

## 4. 컴포넌트

### 4.1 문서 구조

```yaml
# yaml-language-server: $schema=../../../schema/component.schema.json
kind: Component
metadata: { id: button, name: Button, description?: … }   # id: ^[a-z][a-z0-9-]*$
data:
  props?:    …
  variants?: …
  states?:   …
  anatomy:   …   # 필수
  styles?:   …
  x-figma?:  …
  x-*:       …   # 확장
```

- `data`와 각 part 객체에는 정의된 키와 `x-`로 시작하는 키만 올 수 있다.
- 식별자 규칙:
  - props, part, variant 축, state 이름: `^[a-z][a-zA-Z0-9]*$`
  - variant 값: `^[a-z0-9][a-zA-Z0-9-]*$`
- `metadata.id`는 프로젝트 안에서 고유해야 한다.

### 4.2 props

| type | 필드 | 바인딩 위치 |
|---|---|---|
| `text` | `default: string` | text part의 `text: {prop}` |
| `boolean` | `default: boolean` | part의 `visible: {prop}` |
| `instance` | `default?: componentId`, `preferred?: componentId[]` | instance part의 `prop` |
| `slot` | `min?: int≥0`, `max?: int≥1`, `preferred?: componentId[]`, `preferredOnly?: boolean` | slot part의 `prop` |

- 모든 prop에 `description?`을 둘 수 있다.
- 모든 prop은 최소 한 part에 바인딩되어야 한다.
- slot prop은 정확히 한 slot part에 바인딩된다.
- componentId는 프로젝트에 실제로 있는 `metadata.id`여야 한다.

### 4.3 variants와 states

```yaml
variants:
  style: { values: { filled: { description: … }, outlined: {} }, default: filled, description?: … }
states: [enabled, hovered, pressed, disabled]   # 생략하면 [enabled]
```

**variants**:
- 각 축의 `default`는 그 축의 `values` 중 하나여야 한다.
- 축 이름 `state`는 예약어라 쓸 수 없다(Figma에서 state 축과 충돌).

**states**:
- 배열의 **첫 항목이 기본 state**다. 이름은 고유해야 한다.
- **v0.1에서 state 식은 state 이름 하나뿐이다.** `enabled,selected` 같은 조합은 없다.
- 선택/해제 같은 토글 상태는 variant 축으로 표현한다. 예: `selected: { values: { "false": {}, "true": {} } }`
- 이렇게 하면 Figma의 `state` variant 축 하나와 1:1로 대응한다.

### 4.4 anatomy

```yaml
anatomy:
  root:                                   # 키는 정확히 root 하나, kind는 frame
    kind: frame
    layout: { direction: row, gap: 8px, padding: [0, 24px], width: hug, height: 40px }
    children:                             # 키 순서 = 레이어 순서(앞쪽이 아래)
      icon:  { kind: instance, prop: icon, visible: { prop: showIcon } }
      label: { kind: text, text: { prop: label } }
```

part 이름은 트리 전체에서 고유하다. 스타일은 이름으로 part를 가리킨다.

| kind | 필드 |
|---|---|
| `frame` | `layout?`, `children?` |
| `slot` | `prop`(slot prop, 필수), `layout?`, `children?`(기본 콘텐츠) |
| `text` | `text?: string \| {prop}` |
| `instance` | `prop`(instance prop)과 `component`(componentId) 중 **정확히 하나** |
| `vector` | `svg: {viewBox: string, d: string \| string[]}` 필수 |
| `image` | `src: string` 필수(URL, data URI, 프로젝트 기준 상대경로) |

모든 part는 `visible?: {prop}`(boolean prop), `description?`, `x-*`를 가질 수 있다.

### 4.5 styles

```yaml
styles:
  <variantExpr>:        # base | axis=value(,axis=value)*
    <state>:            # 선언된 state 이름 하나
      <part>:
        <property>: <value>
```

- variantExpr의 축과 값은 선언된 것이어야 하고, 한 식 안에 같은 축이 두 번 나올 수 없다.
- property는 4.6의 어휘만 쓸 수 있고, 그 part 종류에 허용된 것이어야 한다.

### 4.6 속성 어휘

| 속성 | 값 | 허용 토큰 타입 | 허용 part | layout |
|---|---|---|---|---|
| `direction` | `row \| column \| grid \| none` | – | frame, slot | ✓ |
| `gap`, `crossGap` | dim | dimension | frame, slot | ✓ |
| `padding` | dim \| [세로, 가로] \| [위, 오른쪽, 아래, 왼쪽] | dimension | frame, slot | ✓ |
| `align` | `{main?: start\|center\|end\|space-between, cross?: start\|center\|end\|baseline}` | – | frame, slot | ✓ |
| `wrap` | boolean | – | frame, slot | ✓ |
| `grid` | `{columns: int≥1, rows: int≥1}` | – | frame, slot | ✓ |
| `width`, `height` | `hug \| fill \| dim` | dimension | 전부 | ✓ |
| `minWidth`, `maxWidth`, `minHeight`, `maxHeight` | dim | dimension | 전부 | ✓ |
| `position` | `auto \| absolute` | – | 전부 | ✓ |
| `x`, `y` | dim | dimension | 전부 | ✓ |
| `fill` | color | color, gradient | frame, slot, vector, instance | |
| `fillOpacity` | 0..1 | number | frame, slot, vector, instance | |
| `strokeColor` | color | color | frame, slot, vector | |
| `strokeWidth` | dim | dimension | frame, slot, vector | |
| `strokeOpacity` | 0..1 | number | frame, slot, vector | |
| `strokeAlign` | `inside \| outside \| center`(기본 inside) | – | frame, slot, vector | |
| `cornerRadius` | dim \| [좌상, 우상, 우하, 좌하] | dimension | frame, slot, image | |
| `opacity` | 0..1 | number | 전부 | |
| `shadow` | alias만 | shadow | frame, slot | |
| `visible` | boolean | – | 전부 | |
| `color` | color | color | text | |
| `typography` | alias만 | typography | text | |
| `textAlign` | `left \| center \| right \| justified` | – | text | |

**의미 규칙**:
- `layout` 블록(anatomy)에는 layout 열이 ✓인 속성만 쓸 수 있다. 이 값들이 스타일 해석의 시작값이 된다(5장).
- `hug`는 내용 크기에 맞추고, `fill`은 부모의 남는 공간을 채운다(부모 주축이면 늘어나고, 교차축이면 stretch).
- `x`/`y`는 `position: absolute`이거나 부모 `direction: none`일 때만 의미가 있다.
- `position: absolute`이면서 `width`/`height`가 `fill`이면 부모 크기에 맞춰 늘어난다. 상태 레이어 같은 오버레이용.
- instance part의 `fill`은 그 instance 안 벡터들의 fill을 덮어쓴다(아이콘 색). instance 내부의 다른 속성은 덮어쓸 수 없다.
- `fillOpacity`와 `strokeOpacity`는 각각 칠과 선(paint)에만 적용된다. 예: M3의 disabled 컨테이너 12%, 외곽선 12%.
- `opacity`는 part와 그 자손 전체에 적용된다.

**값 shorthand**(컴포넌트 문서 전용. 토큰 파일은 DTCG 객체 형식을 쓴다):
- dim: `8px`, `1.5rem`, 단위 없는 `0`, 또는 alias `"{…}"`
- color: `#rrggbb`, `#rrggbbaa`, `transparent`, 또는 alias `"{…}"`
- alias는 반드시 따옴표로 감싼다.

## 5. 스타일 해석

`resolveStyles(component, variant V, state s)`는 part별 최종 속성 맵을 계산한다. 참조 구현: `src/component/resolve.ts`.

1. **시작값**: 각 part의 anatomy `layout`.
2. **적용 레이어**: styles 항목 중 variantExpr이 V에 포함되는 것만 남긴다(`base`는 항상 포함). 남은 항목을 **축 개수 오름차순, 같으면 문서 순서**로 정렬한다.
3. **기본 state 계층**: 정렬된 레이어마다 기본 state(states 첫 항목) 블록을 차례로 덮어쓴다.
4. **현재 state 계층**: `s`가 기본 state가 아니면, 정렬된 레이어마다 `s` 블록을 차례로 덮어쓴다.

V에 없는 축은 그 축의 `default` 값을 쓴다. 선언되지 않은 state나 값이 들어오면 오류다.

**state 계층이 variant 구체성보다 우선한다.** 예시(`test/resolve.test.ts`):
- `base.enabled.root.fill`이 있고 `size=small.enabled.root.fill`이 있으면, `size=small`의 enabled에서는 후자가 이긴다(같은 state 계층에서는 구체적인 쪽이 이김).
- `base.pressed.root.fill`은 `size=small.enabled.root.fill`을 이긴다(pressed 계층이 enabled 계층 뒤에 적용됨).
- 축 두 개짜리 식(`size=small,tone=b`)은 문서상 위치와 관계없이 축 하나짜리 식(`size=small`)을 이긴다.
- variant를 지정하지 않으면 각 축의 default로 해석하고, 어느 레이어에도 없는 속성은 anatomy layout 값을 그대로 쓴다.

Figma 컴포넌트로 옮길 때는 variant 조합 × state 하나하나를 이 규칙으로 해석해 각 variant 컴포넌트를 만든다.

## 6. 확장

- **`x-*`**: `data`와 part 객체에 임의 키 `x-<이름>`을 둘 수 있다. 도구는 모르는 확장을 보존해야 한다.
- **`x-figma`**: Figma 고유 정보.

  ```yaml
  x-figma:
    parts:
      root: { blendMode: PASS_THROUGH, clipsContent: true }   # 키 = Figma REST 노드 필드명
  ```

  - part 이름은 실제로 있어야 한다.
  - 4.6 어휘와 이름이 같은 키는 금지한다(core와 중복 금지).
  - 플랫폼 렌더러는 `x-figma`를 무시한다.

## 7. Exchange 포맷 (0.2에서 정의)

렌더러용 정규화 JSON이다. v0.2에서 정의할 내용:
- 모든 alias는 유지하되 모드별 resolved 값을 함께 담는다.
- 스타일 표를 variant 조합 × state 전체로 펼친다(5장 해석 결과).
- 값은 DTCG 객체 형식으로 정규화한다.

v0.1의 렌더러와 도구는 authoring 문서를 직접 읽고 `resolveStyles`로 해석한다.

## 8. 체크리스트

`kind: Checklist` 문서는 한 컴포넌트가 의도대로 구현되었는지 확인하는 항목 목록이다. 참조 구현은 `src/checklist/`이고, 웹 에디터가 실행한다.

```yaml
# yaml-language-server: $schema=../../../schema/checklist.schema.json
kind: Checklist
metadata: { id: button, component: button, source?: "<출처>", description?: "" }
items:
  - id: height                       # kebab-case, 파일 안에서 고유
    title: 컨테이너 높이 40dp
    check:                           # 자동 항목
      variant?: { style: filled | [filled, tonal] }   # 생략한 축 = 모든 값
      state?: enabled | [enabled, hovered]            # 생략 = 모든 state
      mode?: { theme: light | [light, dark] }         # 생략 = 모든 modifier context
      part: root
      property: height               # CSS longhand(사용자 정의 속성 --x 포함)
      expect: 40px                   # 문자열 안의 "{a.b}"는 토큰 값으로 치환, 또는 number
  - id: ripple
    title: pressed 리플
    manual: true                     # 수동 항목
    hint?: { variant?: {...}, state?: pressed }       # 프리뷰에서 강조할 셀
```

**검증 규칙**
- `metadata.component`, part, 축/값, state, modifier/context는 실제로 있어야 한다.
- `expect` 안의 alias는 존재하는 토큰이어야 한다.
- item id는 고유하고, `check`와 `manual`은 정확히 하나만 둔다.
- `property`는 CSS shorthand(`background`, `border`, `border-radius`, `padding`, `margin`, `font`, `gap`, `inset`, `outline`, `flex`, `grid`, `place-items`, `overflow`, `transition`, `animation`)가 아니어야 한다. shorthand의 computed 값은 비교하기 어렵기 때문.
- 컴포넌트당 체크리스트는 최대 1개다.

**판정**
- 각 케이스(variant × state × mode)를 렌더하고 part의 computed `property` 값을 읽는다.
- 기대값은 같은 컨텍스트에 둔 프로브 요소에 `expect`를 설정해서 얻은 computed 값이다. 양쪽을 브라우저가 같은 방식으로 정규화하게 하려는 것.
- 문자열이 같으면 통과한다. 둘 다 px 길이면 차이가 0.05px 미만일 때 통과한다(레이아웃 반올림 허용).

**기대값 작성 원칙**: 컴포넌트가 참조하는 comp 토큰을 그대로 기대값으로 쓰지 않는다. 대신 sys 토큰이나 공식 스펙의 리터럴을 쓴다. 그래야 comp→sys 연결, YAML 작성, 렌더러가 한꺼번에 교차 검증된다.

## 부록 A. Figma 매핑

필드 이름은 `figma/rest-api-spec`의 `dist/api_types.ts` 기준이다. Plugin API 열은 생성할 때 쓰는 호출이다.

| OpenUI | REST (`api_types.ts`) | Plugin API |
|---|---|---|
| 컬렉션 / 모드 | `VariableCollection.modes`, `defaultModeId` | `figma.variables.createVariableCollection`, `addMode` |
| 토큰(color/dimension/number) | `Variable.resolvedType`(`COLOR` / `FLOAT`), `valuesByMode` | `createVariable`, `setValueForMode` |
| 토큰 alias | `VariableAlias` | `createVariableAlias` |
| `com.figma.scopes` / `codeSyntax` | `Variable.scopes` / `codeSyntax` | `variable.scopes` / `setVariableCodeSyntax` |
| typography 토큰 | `TypeStyle`(`fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeightPx`) | `createTextStyle` |
| shadow 토큰 | `DropShadowEffect` / `InnerShadowEffect`(`inset`) | `createEffectStyle` |
| gradient 토큰 | `GradientPaint.gradientStops` | `GradientPaint` |
| Component | `COMPONENT_SET`. 자식 `COMPONENT` 이름은 `axis=value, …, state=s` | `figma.combineAsVariants` |
| variant 축, state | `ComponentPropertyType` `VARIANT` | variant 이름 |
| prop `text` | `ComponentPropertyType` `TEXT`, `componentPropertyReferences.characters` | `addComponentProperty(…, "TEXT")` |
| prop `boolean` | `BOOLEAN`, `componentPropertyReferences.visible` | `addComponentProperty(…, "BOOLEAN")` |
| prop `instance` | `INSTANCE_SWAP`, `preferredValues`, `componentPropertyReferences.mainComponent` | `addComponentProperty(…, "INSTANCE_SWAP")` |
| prop `slot` | `SLOT`, `SlotSettings`(`minChildren`, `maxChildren`, `allowPreferredValuesOnly`). REST에는 별도 SLOT 노드 타입이 없다 | `component.createSlot()`, `slotSettings` |
| `direction` | `layoutMode`: row→`HORIZONTAL`, column→`VERTICAL`, grid→`GRID`, none→`NONE` | 같음 |
| `gap` / `crossGap` | `itemSpacing` / `counterAxisSpacing`. grid에서는 `gridColumnGap` / `gridRowGap` | 같음 |
| `grid` | `gridColumnCount`, `gridRowCount` | 같음 |
| `padding` | `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft` | 같음 |
| `align.main` / `align.cross` | `primaryAxisAlignItems`(`MIN\|CENTER\|MAX\|SPACE_BETWEEN`) / `counterAxisAlignItems`(`MIN\|CENTER\|MAX\|BASELINE`) | 같음 |
| `wrap` | `layoutWrap`(`WRAP` / `NO_WRAP`) | 같음 |
| `width` / `height` | `layoutSizingHorizontal` / `layoutSizingVertical`(`HUG\|FILL\|FIXED`) + 크기 | 같음 + `resize` |
| min / max | `minWidth`, `maxWidth`, `minHeight`, `maxHeight` | 같음 |
| `position`, `x`, `y` | `layoutPositioning`(`AUTO\|ABSOLUTE`), 상대 위치 | 같음 |
| `fill` / `fillOpacity` | `fills[]`(`SolidPaint.color`, `opacity`) | `fills`, `setBoundVariableForPaint` |
| `strokeColor` / `strokeWidth` / `strokeAlign` / `strokeOpacity` | `strokes[]` / `strokeWeight` / `strokeAlign`(`INSIDE\|OUTSIDE\|CENTER`) / `strokes[].opacity` | 같음 |
| `cornerRadius` | `cornerRadius` / `rectangleCornerRadii` | `cornerRadius`, `topLeftRadius` 등 |
| `opacity` / `visible` | `opacity` / `visible` | 같음 |
| `shadow` | `effects[]` | `effects`, `effectStyleId` |
| `color`, `typography`, `textAlign` | 텍스트 `fills`, `style: TypeStyle`, `textAlignHorizontal` | `fills`, `textStyleId`, `textAlignHorizontal` |
| 토큰 참조 | `boundVariables` | `setBoundVariable` |
| vector `svg` | `fillGeometry` / `strokeGeometry`(`?geometry=paths`) | `vectorPaths`, `createNodeFromSvg` |
| image `src` | `ImagePaint.imageRef` | `figma.createImage` |
| `x-figma.parts.<p>.<field>` | 해당 노드의 같은 이름 필드 | 같은 이름 속성 |

## 부록 B. 미해결 과제

- **state 조합**(`enabled,selected`): Figma state 축 하나와 대응하지 않아 v0.1에서 제외했다. 토글은 variant로 표현한다.
- **string/boolean 토큰**: DTCG에 타입이 없다. Figma STRING/BOOLEAN 변수 대응 방법이 필요하다.
- **variant 조합 제외**: 존재하지 않는 조합(예: 특정 style에는 없는 size)을 표현할 방법이 없다.
- **리플·포커스 링 오프셋·모션**: 어휘가 없다. 체크리스트의 수동 항목으로 확인한다.
- **variant 식의 OR**: `type=selected|indeterminate` 같은 표현이 없어서 같은 블록을 반복해야 한다(Material 3 checkbox).
- **prop에 따라 달라지는 스타일**: 스타일 표는 variant×state 기준이라, "아이콘 표시 여부에 따른 패딩"은 prop이 아닌 variant 축(`withIcon`)으로 모델링했다.
- **instance 내부 덮어쓰기**: v0.1은 벡터 fill(아이콘 색)만 덮어쓸 수 있다.
- **슬롯 기본 콘텐츠의 미리보기**: 프리뷰는 빈 slot을 placeholder로만 그린다.
- **Exchange 포맷**(7장): 0.2에서 정의한다.
- **주석을 보존하는 병합**: 도구가 YAML을 갱신할 때 사람이 단 주석을 유지하는 방법.
- **이름**: "OpenUI"는 W3C Open UI Community Group과 겹친다. 공개 전에 재검토한다.

## 부록 C. 웹(CSS) 매핑

참조 렌더러는 `src/render/`(`tokenSheet`, `partStyle`, `buildComponent`)다. 모든 part는 `data-part`를 갖고, 루트는 `data-component`도 갖는다.

**토큰 → CSS 변수**
- 이름 규칙: `--` + 경로의 `.`을 `-`로 바꾼 것. 예: `md.sys.color.primary` → `--md-sys-color-primary`
- alias는 `var(--대상)`이 된다.
- 시트 구성:
  - `.ou-root`에 set 토큰과 각 modifier의 기본 context를 둔다.
  - modifier context마다 `.ou-root[data-<modifier>="<context>"]` 규칙을 하나씩 만든다.

| `$type` | CSS 값 |
|---|---|
| color | `rgb(R G B / A)` |
| dimension, duration | `${value}${unit}` |
| number | 숫자 |
| cubicBezier | `cubic-bezier(…)` |
| fontFamily | 큰따옴표 목록 |
| fontWeight | 숫자(이름은 DTCG 표대로 변환) |
| shadow | box-shadow 목록 |
| gradient | `linear-gradient(180deg, …)` |
| typography | `-font-family`, `-font-size`, `-font-weight`, `-letter-spacing`, `-line-height` 하위 변수 5개 |

**part → CSS**

| 스펙 | CSS |
|---|---|
| direction row/column | `display:flex; flex-direction` |
| direction grid | `display:grid; grid-template-columns:repeat(c, max-content); grid-template-rows:repeat(r, auto)` |
| direction none | `display:block`. 컨테이너는 항상 `position:relative` |
| gap / crossGap | 주축 gap / 교차축 gap(`column-gap`·`row-gap`). direction none이면 무시 |
| align.main / cross | `justify-content` / `align-items` |
| width·height: dim / hug | 해당 값 또는 `max-content`, 그리고 `flex-shrink:0` |
| width·height: fill | 부모 주축이면 `flex:1 1 0`, 교차축이면 `align-self:stretch`, 부모가 none/grid이거나 루트면 `100%` |
| position absolute (+fill) | `position:absolute; left/top = x/y`. fill이면 `left:0; right:0` 또는 `top:0; bottom:0` |
| fill / fillOpacity (frame) | `background`, 또는 `background-color: color-mix(in srgb, C P%, transparent)` |
| fill (vector / instance) | `fill: var(--ou-icon-fill, C)` / 래퍼에 `--ou-icon-fill` (`-opacity`도 같은 방식) |
| stroke* (frame) | `box-shadow`: inside → `inset 0 0 0 W C`, outside → `0 0 0 W C`, center → 둘로 나눔. strokeOpacity는 color-mix |
| shadow | `box-shadow`에 stroke 그림자 뒤로 이어 붙임 |
| cornerRadius / opacity / visible:false | `border-radius` / `opacity` / `display:none` |
| text | `white-space:nowrap`, `color`, typography 하위 변수, `text-align` |
| vector / image | `<svg viewBox><path d>` / `<img object-fit:cover>` |
