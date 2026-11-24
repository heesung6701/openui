# OpenUI M1 스펙 v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OpenUI YAML 스펙 v0.1을 완성한다. 산출물은 스펙 문서 + zod 스키마 + JSON Schema + `openui validate` + conformance 픽스처이고, 코어는 브라우저와 CLI가 함께 쓴다.

**Architecture:**
- 토큰은 DTCG 2025.10 파일과 Resolver 문서, 컴포넌트는 `kind: Component` YAML이고, 루트에 `openui.yaml`을 둔다.
- 모든 로더는 `ProjectIO`(list/read)를 받는다. 파일시스템을 직접 만지지 않으므로 M2 웹 에디터가 같은 코드를 재사용할 수 있다.
- 검증 흐름: YAML 파싱 → zod 구조 검증 → 의미 검증 → `Diagnostic[]`.
- 스타일 해석 규칙은 `resolveStyles` 참조 구현으로 고정한다.

**Tech Stack:** Bun 1.2.19+ (실행·테스트), TypeScript strict, `zod@^4`, `yaml@^2`.

**Spec:** `docs/superpowers/specs/2026-11-24-openui-yaml-spec-design.md`

## Global Constraints

- 런타임/테스트: Bun ≥ 1.2.19, `bun test`. TS `strict: true`, ESM.
- 의존성:
  - runtime: `zod@^4`, `yaml@^2`
  - dev: `typescript`, `@types/bun`
  - 이 밖의 의존성 추가 금지.
- YAML 파싱은 `yaml` 패키지(YAML 1.2, 중복 키 오류 켬)만 사용한다.
- `src/`는 브라우저에서도 돌아야 한다. `node:fs` 사용은 `src/io.ts`의 `fsIO`와 `src/cli.ts`에만 허용하고, `Bun.*` API는 `src/`에서 쓰지 않는다.
- 식별자 규칙:
  - props, parts, variant 축, states 이름: `^[a-z][a-zA-Z0-9]*$`
  - variant 값: `^[a-z0-9][a-zA-Z0-9-]*$`
  - `metadata.id`: `^[a-z][a-z0-9-]*$`
- 진단은 오류만 있다. `Diagnostic.path`는 `(string|number)[]`(문서 루트 기준). CLI 출력 형식은 `file: a.b.c: message`.
- Figma는 실행하지 않는다. Figma 어휘와 매핑은 `figma/rest-api-spec`의 `dist/api_types.ts` 문서만 참고한다.
- 작업 브랜치는 `m1-spec-v0.1`(main 직접 커밋 금지). 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **따옴표 없는 alias**: `fill: {md.sys.color.primary}`는 `{ "md.sys.color.primary": null }` mapping으로 파싱된다. 이때 `alias must be a quoted string: "{md.sys.color.primary}"` 진단이 나와야 한다. → Task 5
2. **YAML 중복 키**: 같은 맵에 키가 두 번 나오면 뒤의 것이 조용히 이기면 안 되고 파일명이 포함된 오류가 나야 한다. → Task 5
3. **alias 대상 오류**: 없는 토큰, group, `a → b → a` 순환을 가리키면 해당 alias를 짚는 오류가 나야 한다. 무한 루프 금지. → Task 1
4. **모드 누락**: `light`에는 있고 `dark`에는 없는 토큰은 오류. → Task 1
5. **스타일 키 오타와 잘못된 part 종류**: 축/값/state 오타, 없는 part, part 종류에 맞지 않는 속성은 무시되지 않고 오류가 나야 한다. → Task 3

---

## Spec v0.1 결정 (모든 Task의 기준. Task 6이 문서화)

### §T 토큰 (DTCG 2025.10 프로필)

- **파일**: `*.tokens.yaml`은 DTCG JSON을 YAML로 표기한 것이다.
  - `$value`가 있는 객체는 token, 없는 객체는 group이다. `$value`와 자식이 함께 있으면 오류.
  - 이름은 `$`로 시작할 수 없고 `{`, `}`, `.`를 포함할 수 없다.
- **`$type` 결정 순서**: 직접 지정 → (값이 alias면) 대상 토큰의 타입 → 가장 가까운 부모 group의 `$type` → 아무것도 없으면 오류.
- **지원 `$type`**과 `$value` 형식:

  | `$type` | `$value` 형식 |
  |---|---|
  | `color` | `{colorSpace: "srgb", components: [r,g,b], alpha?, hex?}`. 성분은 0..1. v0.1은 `srgb`만. hex 문자열 단독 사용 금지 |
  | `dimension` | `{value: number, unit: "px"\|"rem"}` |
  | `number` | number |
  | `duration` | `{value, unit: "ms"\|"s"}` |
  | `cubicBezier` | `[x1, y1, x2, y2]`, x는 0..1 |
  | `fontFamily` | string 또는 string[] |
  | `fontWeight` | 1..1000 또는 DTCG 이름(`thin`, `hairline`, `extra-light`, `ultra-light`, `light`, `normal`, `regular`, `book`, `medium`, `semi-bold`, `demi-bold`, `bold`, `extra-bold`, `ultra-bold`, `black`, `heavy`, `extra-black`, `ultra-black`) |
  | `shadow` | 단일 객체 또는 배열. 필드 `{color, offsetX, offsetY, blur, spread, inset?}` |
  | `typography` | `{fontFamily, fontSize, fontWeight, letterSpacing, lineHeight: number}`. lineHeight는 fontSize의 배수 |
  | `gradient` | `[{color, position: 0..1}]` |

- **alias**: 값 전체가 `"{a.b.c}"`인 문자열. 복합 값의 하위 필드에도 쓸 수 있다. 대상은 token이어야 하고(group 불가) 타입이 같아야 한다.
- **v0.1 미지원(오류 메시지 `unsupported in openui 0.1`)**: `$ref` JSON Pointer, `$extends`, `$root`, 그 밖의 `$type`, string/boolean 변수.
- **`$extensions["com.figma"]`**: `{scopes?: string[], codeSyntax?: {WEB?, ANDROID?, iOS?: string}, hiddenFromPublishing?: boolean}`. 나머지 `$extensions` 키는 검사 없이 보존한다.
- **Resolver**(`*.resolver.yaml`):
  - `version: "2025.10"` 필수.
  - `sets.<name>.sources`와 `modifiers.<name>.contexts.<ctx>`는 `[{$ref: "<resolver 기준 상대경로>"}]` 형식만 허용.
  - `modifiers.<name>.default`는 생략하면 첫 context.
  - `resolutionOrder`는 `{$ref: "#/sets/x" | "#/modifiers/x"}`이며 모든 set과 modifier가 한 번씩 나와야 한다.
- **컬렉션 대응**(Figma와 웹 공통):
  - set → 컬렉션 하나, 모드는 `["default"]`.
  - modifier → 컬렉션 하나, 모드는 context 이름들.
  - 토큰 경로는 정확히 한 set, 또는 정확히 한 modifier의 **모든** context에 정의되어야 한다.

### §C 컴포넌트 문서

```
kind: Component
metadata: {id, name, description?}
data: {props?, variants?, states?, anatomy, styles?, x-figma?, x-*?}
```
`data`와 각 part 객체에는 정의된 키와 `x-`로 시작하는 키만 허용한다. JSON Schema에서는 `additionalProperties: false` + `patternProperties: {"^x-": {}}`로 표현한다.

- **props**(type으로 구분):

  | type | 필드 | Figma |
  |---|---|---|
  | `text` | `default: string` | TEXT |
  | `boolean` | `default: boolean` | BOOLEAN |
  | `instance` | `default?: componentId`, `preferred?: componentId[]` | INSTANCE_SWAP |
  | `slot` | `min?: int≥0`, `max?: int≥1`, `preferred?: componentId[]`, `preferredOnly?: boolean` | SLOT |

  공통 필드는 `description?`. 모든 prop은 어떤 part에든 바인딩되어야 하고, 안 되어 있으면 오류.
- **variants**: `<axis>: {values: {<value>: {description?}}, default, description?}`. 축 이름 `state`는 금지.
- **states**: 고유한 이름의 배열. 첫 항목이 기본 state이고, 생략하면 `["enabled"]`. **state 식은 이름 하나뿐**이다(조합 없음). 토글 상태는 variant 축으로 표현.
- **anatomy**:
  - 최상위 키는 정확히 `root` 하나이고 `kind: frame`이어야 한다.
  - part 이름은 트리 전체에서 고유하다.
  - part 필드:

    | 필드 | 설명 |
    |---|---|
    | `kind` | `frame \| text \| instance \| slot \| vector \| image` |
    | `layout?` | frame/slot 전용. §L/§P에서 layout 열이 ✓인 키만 허용 |
    | `children?` | frame/slot 전용. 키 순서가 곧 레이어 순서 |
    | `text?` | text 전용. `string` 또는 `{prop: <text prop>}` |
    | `prop?` | instance → instance prop, slot → slot prop (slot은 필수) |
    | `component?` | instance 전용. `prop`과 `component` 중 정확히 하나 |
    | `svg` | vector 필수. `{viewBox: string, d: string \| string[]}` |
    | `src` | image 필수. 문자열(URL, data URI, 프로젝트 기준 상대경로) |
    | `visible?` | `{prop: <boolean prop>}` |
    | `description?` | 설명 |

  - 하나의 slot prop은 정확히 한 slot part에 바인딩된다.
  - componentId(`component`, `default`, `preferred`)는 프로젝트에 실제로 있는 `metadata.id`여야 한다.
- **styles**:
  - 구조는 `<variantExpr> → <state> → <part> → <property>: <value>`.
  - variantExpr은 `base` 또는 `axis=value(,axis=value)*`이며 축은 한 번씩만.
- **x-figma**:
  - `{parts?: {<part>: {<REST 노드 필드명>: any}}}` 형식.
  - part 이름은 실제로 있어야 하고, 키가 §P 속성명과 같으면 오류.

### §L/§P 속성 어휘 (`STYLE_PROPERTIES` 표, 단일 원천)

| 속성 | 값 | 토큰 타입 | 허용 part | layout |
|---|---|---|---|---|
| `direction` | `row\|column\|grid\|none` | – | frame, slot | ✓ |
| `gap`, `crossGap` | dim | dimension | frame, slot | ✓ |
| `padding` | dim \| [dim,dim] \| [dim,dim,dim,dim] (CSS 순서) | dimension | frame, slot | ✓ |
| `align` | `{main?: start\|center\|end\|space-between, cross?: start\|center\|end\|baseline}` | – | frame, slot | ✓ |
| `wrap` | boolean | – | frame, slot | ✓ |
| `grid` | `{columns: int≥1, rows: int≥1}` | – | frame, slot | ✓ |
| `width`, `height` | `hug\|fill\|dim` | dimension | 전부 | ✓ |
| `minWidth`, `maxWidth`, `minHeight`, `maxHeight` | dim | dimension | 전부 | ✓ |
| `position` | `auto\|absolute` | – | 전부 | ✓ |
| `x`, `y` | dim | dimension | 전부 | ✓ |
| `fill` | color | color, gradient | frame, slot, vector, instance(벡터 자손의 fill을 덮어씀) | |
| `fillOpacity` | number 0..1 | number | frame, slot, vector, instance | |
| `strokeColor` | color | color | frame, slot, vector | |
| `strokeWidth` | dim | dimension | frame, slot, vector | |
| `strokeAlign` | `inside\|outside\|center` (기본 inside) | – | frame, slot, vector | |
| `cornerRadius` | dim \| [dim×4] | dimension | frame, slot, image | |
| `opacity` | number 0..1 | number | 전부 | |
| `shadow` | alias만 | shadow | frame, slot | |
| `visible` | boolean | – | 전부 | |
| `color` | color | color | text | |
| `typography` | alias만 | typography | text | |
| `textAlign` | `left\|center\|right\|justified` | – | text | |

- 값 shorthand(컴포넌트 YAML 전용):
  - dim: `^-?\d+(\.\d+)?(px|rem)$`
  - color: `#rrggbb`, `#rrggbbaa`, `transparent`
  - 둘 다 alias `"{…}"` 사용 가능.
- `x`/`y`는 `position: absolute`이거나 부모 direction이 `none`일 때만 의미가 있다.
- `position: absolute`이면서 width/height가 `fill`이면 부모 크기에 맞춰 늘어난다. 상태 레이어, 컨테이너 레이어용.

### §R 스타일 해석 (`resolveStyles` 의미)

`(variant V, state s)`에 대해 다음 순서로 계산한다.

1. 시작값은 각 part의 anatomy `layout` 값.
2. 적용할 레이어 목록을 만든다.
   - variantExpr이 V에 포함되는 항목만 남긴다(`base`는 항상 포함).
   - 남은 항목을 (축 개수 오름차순, 문서 순서)로 정렬한다.
3. 정렬된 각 레이어에서 `[기본 state]` 블록을 순서대로 덮어쓴다.
4. `s ≠ 기본 state`이면, 정렬된 레이어들을 다시 돌며 `[s]` 블록을 덮어쓴다.

즉 **state 계층이 variant 구체성보다 우선**한다. V에서 빠진 축은 default 값을 쓴다.

---

### Task 1: 프로젝트 골격 + IO + DTCG 토큰 로더/검증

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`
- Create: `src/diagnostics.ts`, `src/io.ts`, `src/tokens/values.ts`, `src/tokens/tree.ts`, `src/tokens/resolver.ts`
- Test: `test/helpers.ts`, `test/tokens.test.ts`

**Interfaces:**
- Produces:
  - `src/diagnostics.ts`:
    - `type Diagnostic = { file: string; path: (string | number)[]; message: string }`
    - `fromZod(err: z.ZodError, file: string, base?: (string | number)[]): Diagnostic[]`
    - `formatDiagnostic(d: Diagnostic): string` → `file: a.b.c: message`
  - `src/io.ts`:
    - `type ProjectIO = { list(): Promise<string[]>; read(path: string): Promise<string> }`. 경로는 프로젝트 루트 기준 posix 상대경로.
    - `memoryIO(files: Record<string, string>): ProjectIO`
    - `fsIO(root: string): ProjectIO`. `node:fs/promises`를 쓰고, `*.yaml`을 재귀로 수집하되 `node_modules`와 `.`으로 시작하는 디렉터리는 제외.
    - `resolvePath(fromFile: string, rel: string): string`. posix 정규화, `..` 처리.
  - `src/tokens/values.ts`:
    - `type TokenType = "color"|"dimension"|"number"|"duration"|"cubicBezier"|"fontFamily"|"fontWeight"|"shadow"|"typography"|"gradient"`
    - `valueSchemas: Record<TokenType, z.ZodType>`. 최상위와 복합 하위 필드에서 alias 문자열 허용.
    - `aliasTarget(v: unknown): string | null`
    - `collectAliases(v: unknown): string[]`
  - `src/tokens/tree.ts`:
    - `type TokenDef = { path: string; type: TokenType | null; value: unknown; description?: string; extensions?: Record<string, unknown>; file: string }`. `type: null`은 alias로부터 타입을 상속한다는 뜻이며 resolver가 채운다.
    - `walkTokenTree(doc: unknown, file: string): { tokens: TokenDef[]; diagnostics: Diagnostic[] }`
  - `src/tokens/resolver.ts`:
    - `type Collection = { name: string; kind: "set" | "modifier"; modes: string[]; defaultMode: string }`
    - `type TokenEntry = { collection: string; type: TokenType; byMode: Record<string, TokenDef> }`
    - `type TokenSet = { collections: Collection[]; tokens: Map<string, TokenEntry> }`
    - `loadTokens(io: ProjectIO, resolverPath: string): Promise<{ tokens: TokenSet; diagnostics: Diagnostic[] }>`
    - 이 Task에서는 `yaml.parse`를 직접 쓴다. Task 5에서 `parseYaml`로 교체.
    - 오류가 나도 중단하지 않고 끝까지 진단을 모은다.
  - `test/helpers.ts`: `msgs(d: { message: string }[]): string`. 메시지들을 개행으로 이어 붙임.

- [ ] **Step 1: 브랜치와 골격**
  - `git checkout -b m1-spec-v0.1`
  - `bun init -y`
  - `bun add zod@^4 yaml@^2`, `bun add -d typescript @types/bun`
  - `.gitignore`에 `node_modules`, `.cache/`
- [ ] **Step 2: 실패하는 테스트 작성** — `test/tokens.test.ts`

```ts
import { expect, test } from "bun:test";
import { walkTokenTree } from "../src/tokens/tree";
import { loadTokens } from "../src/tokens/resolver";
import { memoryIO, resolvePath } from "../src/io";
import { msgs } from "./helpers";

const c = (r: number, g: number, b: number) => ({ colorSpace: "srgb", components: [r, g, b] });

test("resolvePath", () => {
  expect(resolvePath("tokens/m3.resolver.yaml", "../x/a.tokens.yaml")).toBe("x/a.tokens.yaml");
  expect(resolvePath("r.yaml", "./a.yaml")).toBe("a.yaml");
});
test("group $type is inherited; token path is dot-joined", () => {
  const r = walkTokenTree({ md: { ref: { $type: "color", primary40: { $value: c(0.4, 0.31, 0.64) } } } }, "a");
  expect(r.diagnostics).toEqual([]);
  expect(r.tokens[0]).toMatchObject({ path: "md.ref.primary40", type: "color" });
});
test("$value with children is an error", () => {
  expect(msgs(walkTokenTree({ a: { $type: "number", $value: 1, b: { $value: 2 } } }, "a").diagnostics)).toContain("$value");
});
test("forbidden names and missing $type", () => {
  expect(walkTokenTree({ "a.b": { $type: "number", $value: 1 } }, "a").diagnostics.length).toBe(1);
  expect(msgs(walkTokenTree({ a: { $value: 1 } }, "a").diagnostics)).toContain("$type");
});
test("color: hex string and non-srgb rejected; srgb object accepted", () => {
  expect(walkTokenTree({ a: { $type: "color", $value: "#ff0000" } }, "a").diagnostics.length).toBe(1);
  expect(walkTokenTree({ a: { $type: "color", $value: { colorSpace: "oklch", components: [0.5, 0.1, 20] } } }, "a").diagnostics.length).toBe(1);
  expect(walkTokenTree({ a: { $type: "color", $value: { ...c(1, 0, 0), alpha: 0.5, hex: "#ff0000" } } }, "a").diagnostics).toEqual([]);
});
test("dimension needs {value, unit px|rem}", () => {
  expect(walkTokenTree({ a: { $type: "dimension", $value: 8 } }, "a").diagnostics.length).toBe(1);
  expect(walkTokenTree({ a: { $type: "dimension", $value: { value: 8, unit: "em" } } }, "a").diagnostics.length).toBe(1);
  expect(walkTokenTree({ a: { $type: "dimension", $value: { value: 8, unit: "px" } } }, "a").diagnostics).toEqual([]);
});
test("alias allowed top-level and inside composite", () => {
  const shadow = { color: "{a}", offsetX: { value: 0, unit: "px" }, offsetY: { value: 1, unit: "px" }, blur: { value: 2, unit: "px" }, spread: { value: 0, unit: "px" } };
  expect(walkTokenTree({ a: { $type: "color", $value: c(0, 0, 0) }, b: { $value: "{a}" }, s: { $type: "shadow", $value: shadow } }, "f").diagnostics).toEqual([]);
});
test("unsupported features say so", () => {
  for (const doc of [{ a: { $type: "border", $value: {} } }, { g: { $extends: "{x}" } }, { g: { $root: { $type: "number", $value: 1 } } }])
    expect(msgs(walkTokenTree(doc, "a").diagnostics)).toContain("unsupported in openui 0.1");
});

const resolver = `version: "2025.10"
sets: { base: { sources: [{ $ref: base.tokens.yaml }] } }
modifiers: { theme: { contexts: { light: [{ $ref: light.tokens.yaml }], dark: [{ $ref: dark.tokens.yaml }] } } }
resolutionOrder: [{ $ref: "#/sets/base" }, { $ref: "#/modifiers/theme" }]
`;
const base = `gray: { $type: color, w: { $value: { colorSpace: srgb, components: [1, 1, 1] } }, k: { $value: { colorSpace: srgb, components: [0, 0, 0] } } }
space: { $type: dimension, s: { $value: { value: 4, unit: px } } }
`;
const load = (files: Record<string, string>) => loadTokens(memoryIO(files), "t/r.resolver.yaml");
const tree = (light: string, dark: string, r = resolver, b = base) =>
  ({ "t/r.resolver.yaml": r, "t/base.tokens.yaml": b, "t/light.tokens.yaml": light, "t/dark.tokens.yaml": dark });

test("set → mode default; modifier → modes = contexts, default = first; $ref relative to resolver", async () => {
  const { tokens, diagnostics } = await load(tree(`bg: { $value: "{gray.w}" }`, `bg: { $value: "{gray.k}" }`));
  expect(diagnostics).toEqual([]);
  expect(tokens.collections).toEqual([
    { name: "base", kind: "set", modes: ["default"], defaultMode: "default" },
    { name: "theme", kind: "modifier", modes: ["light", "dark"], defaultMode: "light" },
  ]);
  expect(tokens.tokens.get("bg")).toMatchObject({ collection: "theme", type: "color" });
});
test("token missing in one context", async () => {
  expect(msgs((await load(tree(`bg: { $value: "{gray.w}" }`, `fg: { $value: "{gray.k}" }`))).diagnostics))
    .toContain('"bg" missing in context "dark" of modifier "theme"');
});
test("alias: missing, group target, type mismatch, cycle (terminates)", async () => {
  const l = `bg: { $value: "{gray.nope}" }\ngrp: { $value: "{gray}" }\nbad: { $type: dimension, $value: "{gray.w}" }\nx: { $value: "{y}" }\ny: { $value: "{x}" }`;
  const m = msgs((await load(tree(l, l))).diagnostics);
  expect(m).toContain("{gray.nope}");
  expect(m).toContain("{gray}");
  expect(m).toContain("type mismatch");
  expect(m).toContain("cycle");
});
test("token in two collections and wrong resolver version are both reported", async () => {
  const m = msgs((await load(tree(`bg: { $value: "{gray.w}" }`, `bg: { $value: "{gray.k}" }`,
    resolver.replace("2025.10", "2024.01"), base + `bg: { $value: "{gray.w}" }`))).diagnostics);
  expect(m).toContain("2025.10");
  expect(m).toContain('"bg"');
});
test("missing source file is a diagnostic, not a throw", async () => {
  const files = tree(`bg: { $value: "{gray.w}" }`, `bg: { $value: "{gray.k}" }`);
  delete (files as Record<string, string>)["t/dark.tokens.yaml"];
  expect(msgs((await load(files)).diagnostics)).toContain("t/dark.tokens.yaml");
});
```

- [ ] **Step 3: 실패 확인**
  - Run: `bun test test/tokens.test.ts`
  - Expected: FAIL (module not found)
- [ ] **Step 4: 구현** — `diagnostics.ts`, `io.ts`, `values.ts`, `tree.ts`, `resolver.ts`
  - 값 검사는 §T 표를 그대로 zod로 옮긴다.
  - 순환 검출은 모드별 alias 그래프(복합 하위 alias 포함)에 대한 DFS. 방문 색칠로 종료를 보장한다.
  - `memoryIO.read`는 없는 경로면 `Error(path)`를 throw하고, resolver는 그 오류를 진단으로 바꾼다.
- [ ] **Step 5: 통과 확인**
  - Run: `bun test test/tokens.test.ts`
  - Expected: PASS
- [ ] **Step 6: Commit** (설계 문서와 계획 문서 포함)

```bash
git add package.json bun.lock tsconfig.json .gitignore src test docs
git commit -m "feat(tokens): DTCG 2025.10 token + resolver loader with validation"
```

---

### Task 2: 컴포넌트·매니페스트 zod 스키마 + JSON Schema 생성

**Files:**
- Create: `src/component/schema.ts`, `src/manifest.ts`, `scripts/gen-schema.ts`
- Create(생성물): `schema/component.schema.json`, `schema/manifest.schema.json`
- Modify: `test/helpers.ts` (`CHIP_YAML` 추가)
- Test: `test/schema.test.ts`

**Interfaces:**
- Consumes: `TokenType` (Task 1)
- Produces:
  - `src/component/schema.ts`:
    - `type PartKind = "frame"|"text"|"instance"|"slot"|"vector"|"image"`
    - `STYLE_PROPERTIES: Record<string, { schema: z.ZodType; tokenTypes: TokenType[]; parts: PartKind[] | "all"; layout: boolean }>`. §L/§P 표 그대로.
    - `Component` zod 스키마와 `type Component = z.infer<typeof Component>`
  - `src/manifest.ts`:
    - `Manifest` zod: `{ openui: "0.1", info: { title, version, description? }, tokens: string, components: string[] (min 1) }`
    - `type Manifest`
  - `scripts/gen-schema.ts`:
    - `genSchemas(): Record<string, string>`. 키는 파일명(`component.schema.json`, `manifest.schema.json`), 값은 2칸 들여쓰기 JSON + 개행.
    - 직접 실행하면 `schema/`에 기록한다.

- [ ] **Step 1: 실패하는 테스트 작성** — `test/helpers.ts`에 공용 픽스처를 추가하고(Task 3도 사용), 그다음 `test/schema.test.ts`

```ts
// test/helpers.ts 에 추가
export const CHIP_YAML = `kind: Component
metadata: { id: chip, name: Chip }
data:
  props: { label: { type: text, default: Chip }, trailing: { type: slot, max: 1 } }
  variants: { size: { values: { small: {}, large: {} }, default: small } }
  anatomy:
    root:
      kind: frame
      layout: { direction: row, gap: 8px, padding: [0, 12px], width: hug, height: "{h}" }
      children:
        label: { kind: text, text: { prop: label } }
        tail: { kind: slot, prop: trailing }
  styles:
    base: { enabled: { root: { fill: "#6750A4", cornerRadius: 8px }, label: { color: "{c}" } } }
  x-figma: { parts: { root: { blendMode: PASS_THROUGH } } }
  x-note: anything
`;
```

```ts
// test/schema.test.ts
import { expect, test } from "bun:test";
import { parse } from "yaml";
import { Component } from "../src/component/schema";
import { genSchemas } from "../scripts/gen-schema";
import { CHIP_YAML as ok } from "./helpers";

const y = (s: string) => parse(s);
test("valid component parses", () => expect(Component.safeParse(y(ok)).success).toBe(true));
test("unknown non-x key at data and part level rejected", () => {
  expect(Component.safeParse(y(ok.replace("x-note", "note"))).success).toBe(false);
  expect(Component.safeParse(y(ok.replace("kind: text,", "kind: text, colour: red,"))).success).toBe(false);
});
test("prop rules", () => {
  expect(Component.safeParse(y(ok.replace("default: Chip", "default: 3"))).success).toBe(false);
  expect(Component.safeParse(y(ok.replace("max: 1", "max: 0"))).success).toBe(false);
});
test("value shorthand", () => {
  expect(Component.safeParse(y(ok.replace("gap: 8px", "gap: 8"))).success).toBe(false);
  expect(Component.safeParse(y(ok.replace('"#6750A4"', "red"))).success).toBe(false);
  expect(Component.safeParse(y(ok.replace('"#6750A4"', '"#6750A4CC"'))).success).toBe(true);
});
test("layout block rejects non-layout keys", () => {
  expect(Component.safeParse(y(ok.replace("gap: 8px,", "gap: 8px, fill: '#000000',"))).success).toBe(false);
});
test("vector needs svg, image needs src", () => {
  const vec = ok.replace("tail: { kind: slot, prop: trailing }", "tail: { kind: slot, prop: trailing }\n        v: { kind: vector }");
  expect(Component.safeParse(y(vec)).success).toBe(false);
  expect(Component.safeParse(y(vec.replace("{ kind: vector }", '{ kind: vector, svg: { viewBox: "0 0 24 24", d: "M0 0h24v24H0z" } }'))).success).toBe(true);
  expect(Component.safeParse(y(vec.replace("{ kind: vector }", "{ kind: image }"))).success).toBe(false);
});
test("JSON Schema: x- extension rule and committed files fresh", async () => {
  const out = genSchemas();
  expect(out["component.schema.json"]).toContain('"^x-"');
  for (const [name, text] of Object.entries(out)) expect(await Bun.file(`schema/${name}`).text()).toBe(text);
});
```

- [ ] **Step 2: 실패 확인**
  - Run: `bun test test/schema.test.ts`
  - Expected: FAIL (module not found)
- [ ] **Step 3: 구현** — `src/component/schema.ts`, `src/manifest.ts`, `scripts/gen-schema.ts`
  - `x-` 허용 객체: `catchall(z.unknown())` + `x-`가 아닌 추가 키를 거부하는 refine.
  - JSON Schema 변환: `z.toJSONSchema`의 `override`로 해당 객체에 `additionalProperties: false`와 `patternProperties: {"^x-": {}}`를 넣는다.
  - part는 `kind`로 구분하는 discriminated union.
- [ ] **Step 4: 스키마 생성 후 통과 확인**
  - Run: `bun scripts/gen-schema.ts && bun test test/schema.test.ts`
  - Expected: PASS
- [ ] **Step 5: Commit**

```bash
git add src/component/schema.ts src/manifest.ts scripts schema test
git commit -m "feat(schema): component/manifest zod schemas and generated JSON Schema"
```

---

### Task 3: 컴포넌트 의미 검증

**Files:**
- Create: `src/component/validate.ts`
- Test: `test/validate.test.ts`

**Interfaces:**
- Consumes: `Component`, `STYLE_PROPERTIES`, `PartKind` (Task 2); `TokenSet`, `TokenType`, `Diagnostic` (Task 1)
- Produces:
  - `type ValidateContext = { tokens: TokenSet; componentIds: Set<string> }`
  - `validateComponent(doc: Component, file: string, ctx: ValidateContext): Diagnostic[]`
  - §C/§L/§P 규칙 전부를 검사한다. 진단 `path` 예: `["data","styles","size=small","enabled","root","fill"]`.
  - 이 Task가 내보내는 헬퍼(Task 4·M2 재사용):
    - `variantAxes(doc: Component): Record<string, { values: string[]; default: string }>`
    - `statesOf(doc: Component): string[]`
    - `partsOf(doc: Component): Map<string, { kind: PartKind; part: unknown; parent: string | null }>`

- [ ] **Step 1: 실패하는 테스트 작성** — `test/validate.test.ts`
  - 정상 문서는 `good = parse(CHIP_YAML)`. states를 생략했으므로 `["enabled"]`.
  - `ctx`는 테스트 안에서 직접 만든다.
    - TokenSet: set `base` 하나에 `c`(color), `h`(dimension), `t`(typography), `sh`(shadow). `byMode`는 비워도 됨.
    - componentIds: `{"icon", "chip"}`
  - 정상 케이스는 `[]`. 각 오류 케이스는 정상 문서를 한 군데만 바꾼다.

```ts
const cases: [string, (d: any) => void, string][] = [
  ["unknown axis",             d => (d.data.styles["sise=small"] = {}),                         "sise"],
  ["unknown variant value",    d => (d.data.styles["size=huge"] = {}),                          "huge"],
  ["axis twice",               d => (d.data.styles["size=small,size=large"] = {}),              "size"],
  ["unknown state",            d => (d.data.styles.base.hover = {}),                            "hover"],
  ["state combo not allowed",  d => (d.data.styles.base["enabled,pressed"] = {}),               "enabled,pressed"],
  ["unknown part",             d => (d.data.styles.base.enabled.lable = {}),                    "lable"],
  ["typography on frame",      d => (d.data.styles.base.enabled.root.typography = "{t}"),       "typography"],
  ["alias type mismatch",      d => (d.data.styles.base.enabled.root.fill = "{h}"),             "{h}"],
  ["missing token",            d => (d.data.styles.base.enabled.root.fill = "{nope}"),          "{nope}"],
  ["shadow literal",           d => (d.data.styles.base.enabled.root.shadow = "#000000"),       "shadow"],
  ["text prop wrong type",     d => (d.data.anatomy.root.children.label.text = { prop: "trailing" }), "trailing"],
  ["unbound prop",             d => (d.data.props.extra = { type: "boolean", default: false }), "extra"],
  ["slot bound twice",         d => (d.data.anatomy.root.children.tail2 = { kind: "slot", prop: "trailing" }), "trailing"],
  ["unknown component ref",    d => (d.data.props.icon = { type: "instance", default: "ghost" }), "ghost"],
  ["duplicate part name",      d => (d.data.anatomy.root.children.wrap = { kind: "frame", children: { label: { kind: "text", text: "x" } } }), "label"],
  ["root not frame",           d => (d.data.anatomy.root.kind = "text"),                        "root"],
  ["axis named state",         d => (d.data.variants.state = { values: { a: {} }, default: "a" }), "state"],
  ["x-figma duplicates core",  d => (d.data["x-figma"] = { parts: { root: { fill: "#000000" } } }), "fill"],
  ["fillOpacity on text",      d => (d.data.styles.base.enabled.label.fillOpacity = 0.5),       "fillOpacity"],
];
for (const [name, mutate, needle] of cases)
  test(name, () => { const d = structuredClone(good); mutate(d); expect(msgs(validateComponent(d, "f", ctx))).toContain(needle); });
```

- [ ] **Step 2: 실패 확인**
  - Run: `bun test test/validate.test.ts`
  - Expected: FAIL
- [ ] **Step 3: 구현** `validateComponent`와 헬퍼 3개
  - alias 타입 검사는 `STYLE_PROPERTIES[prop].tokenTypes`와 `ctx.tokens.tokens.get(path)?.type`를 비교한다.
- [ ] **Step 4: 통과 확인**
  - Run: `bun test test/validate.test.ts`
  - Expected: PASS
- [ ] **Step 5: Commit**

```bash
git add src/component/validate.ts test/validate.test.ts
git commit -m "feat(validate): semantic checks for component specs"
```

---

### Task 4: 스타일 해석 참조 구현

**Files:**
- Create: `src/component/resolve.ts`
- Test: `test/resolve.test.ts`

**Interfaces:**
- Consumes: `Component` (Task 2), `variantAxes`, `statesOf` (Task 3)
- Produces:
  - `resolveStyles(doc: Component, variant: Record<string, string>, state: string): Record<string, Record<string, unknown>>`
  - 반환값은 part 이름 → 속성 맵. §R 알고리즘을 따른다.
  - 선언되지 않은 state나 variant 값이 들어오면 `throw new Error`.
  - `variantCombos(doc: Component): Record<string, string>[]`. 축 선언 순서대로 데카르트 곱을 만든다(축이 없으면 `[{}]`). M2 프리뷰가 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성** — `test/resolve.test.ts`

```ts
const doc = parse(`kind: Component
metadata: { id: b, name: B }
data:
  variants:
    size: { values: { small: {}, large: {} }, default: large }
    tone: { values: { a: {}, b: {} }, default: a }
  states: [enabled, pressed]
  anatomy: { root: { kind: frame, layout: { direction: row, gap: 8px } } }
  styles:
    size=small,tone=b: { enabled: { root: { fill: "#000004" } } }
    base:
      enabled: { root: { fill: "#000001", cornerRadius: 4px } }
      pressed: { root: { fill: "#000002" } }
    size=small: { enabled: { root: { fill: "#000003", gap: 4px } } }
`);
test("variant layer overrides base within same state", () =>
  expect(resolveStyles(doc, { size: "small" }, "enabled").root).toEqual({ direction: "row", gap: "4px", fill: "#000003", cornerRadius: "4px" }));
test("state layer beats variant specificity", () =>
  expect(resolveStyles(doc, { size: "small" }, "pressed").root.fill).toBe("#000002"));
test("missing axis uses default; anatomy layout is the base", () =>
  expect(resolveStyles(doc, {}, "pressed").root).toEqual({ direction: "row", gap: "8px", fill: "#000002", cornerRadius: "4px" }));
test("more axes win regardless of document order", () =>
  expect(resolveStyles(doc, { size: "small", tone: "b" }, "enabled").root.fill).toBe("#000004"));
test("unknown state throws", () => expect(() => resolveStyles(doc, {}, "hover")).toThrow());
test("variantCombos is the cartesian product in axis order", () =>
  expect(variantCombos(doc)).toEqual([{ size: "small", tone: "a" }, { size: "small", tone: "b" }, { size: "large", tone: "a" }, { size: "large", tone: "b" }]));
```

- [ ] **Step 2: 실패 확인**
  - Run: `bun test test/resolve.test.ts`
  - Expected: FAIL
- [ ] **Step 3: 구현** `resolveStyles`, `variantCombos`. §R 그대로.
- [ ] **Step 4: 통과 확인**
  - Run: `bun test test/resolve.test.ts`
  - Expected: PASS
- [ ] **Step 5: Commit**

```bash
git add src/component/resolve.ts test/resolve.test.ts
git commit -m "feat(resolve): reference style resolution (state layer over variant specificity)"
```

---

### Task 5: YAML 파싱 + 프로젝트 로더 + CLI + conformance 픽스처

**Files:**
- Create: `src/yaml.ts`, `src/glob.ts`, `src/project.ts`, `src/cli.ts`
- Modify: `src/tokens/resolver.ts`. `yaml.parse` 직접 호출을 `parseYaml`로 교체.
- Create: `examples/conformance/openui.yaml`
- Create: `examples/conformance/tokens/{conformance.resolver,base.tokens,light.tokens,dark.tokens}.yaml`
- Create: `examples/conformance/components/{button,icon,card,gallery}.yaml`
- Create: `test/fixtures/broken/openui.yaml` (내용: `openui: "0.1"`)
- Test: `test/project.test.ts`

**Interfaces:**
- Consumes: `ProjectIO`, `memoryIO`, `fsIO` (Task 1); `loadTokens` (Task 1); `Component`, `Manifest` (Task 2); `validateComponent` (Task 3); `fromZod`, `formatDiagnostic` (Task 1)
- Produces:
  - `src/yaml.ts`: `parseYaml(text: string, file: string): { doc: unknown; diagnostics: Diagnostic[] }`
    - 중복 키 → diagnostic.
    - 따옴표 없는 alias 감지: 값이 키 1개짜리 mapping이고 그 키에 `.`가 있고 값이 null이면, 메시지 `alias must be a quoted string: "{<key>}"`.
  - `src/glob.ts`: `globToRegExp(glob: string): RegExp`
    - `*` = 슬래시를 제외한 임의 문자열
    - `**/` = 0개 이상의 디렉터리
    - 나머지 문자는 리터럴
  - `src/project.ts`:
    - `type Project = { manifest: Manifest; tokens: TokenSet; components: Map<string, { file: string; doc: Component }> }`
    - `loadProject(io: ProjectIO): Promise<{ project?: Project; diagnostics: Diagnostic[] }>`
    - 하는 일: `openui.yaml` 검증 → tokens 로드 → components glob 매칭 → zod → `metadata.id` 중복 검사 → `validateComponent`.
    - 매니페스트가 무효면 `project`는 undefined.
  - `src/cli.ts`: `bun src/cli.ts validate <dir>`
    - 진단이 있으면 `formatDiagnostic`으로 한 줄씩 출력하고 exit 1.
    - 없으면 `ok: <N> tokens, <M> components`를 출력하고 exit 0.

- [ ] **Step 1: 실패하는 테스트 작성** — `test/project.test.ts`

```ts
test("duplicate YAML key is an error with file name", () => {
  const r = parseYaml("styles:\n  size=small: {}\n  size=small: {}\n", "c/a.yaml");
  expect(r.diagnostics.length).toBe(1);
  expect(r.diagnostics[0].file).toBe("c/a.yaml");
});
test("unquoted alias gets a hint", () =>
  expect(parseYaml("fill: {md.sys.color.primary}\n", "a.yaml").diagnostics[0].message).toContain('"{md.sys.color.primary}"'));
test("globToRegExp", () => {
  expect(globToRegExp("components/*.yaml").test("components/button.yaml")).toBe(true);
  expect(globToRegExp("components/*.yaml").test("components/x/button.yaml")).toBe(false);
  expect(globToRegExp("components/**/*.yaml").test("components/x/button.yaml")).toBe(true);
  expect(globToRegExp("components/**/*.yaml").test("components/button.yaml")).toBe(true);
});
const conformance = async () => { const io = fsIO("examples/conformance"); const files: Record<string, string> = {}; for (const p of await io.list()) files[p] = await io.read(p); return files; };
test("conformance project is clean and covers every token type and part kind", async () => {
  const { project, diagnostics } = await loadProject(fsIO("examples/conformance"));
  expect(diagnostics).toEqual([]);
  expect(project!.components.size).toBe(4);
  expect(new Set([...project!.tokens.tokens.values()].map((t) => t.type))).toEqual(
    new Set(["color", "dimension", "number", "duration", "cubicBezier", "fontFamily", "fontWeight", "shadow", "typography", "gradient"]));
  const kinds = new Set<string>();
  const walk = (p: any) => { kinds.add(p.kind); Object.values(p.children ?? {}).forEach(walk); };
  for (const { doc } of project!.components.values()) walk(doc.data.anatomy.root);
  expect(kinds).toEqual(new Set(["frame", "text", "instance", "slot", "vector", "image"]));
});
test("duplicate metadata.id across files", async () => {
  const files = await conformance();
  files["components/icon2.yaml"] = files["components/icon.yaml"];
  expect(msgs((await loadProject(memoryIO(files))).diagnostics)).toContain('duplicate metadata.id "icon"');
});
test("unknown instance component across files", async () => {
  const files = await conformance();
  files["components/button.yaml"] = files["components/button.yaml"].replace("default: icon", "default: ghost");
  expect(msgs((await loadProject(memoryIO(files))).diagnostics)).toContain("ghost");
});
test("CLI exit codes", () => {
  const good = Bun.spawnSync(["bun", "src/cli.ts", "validate", "examples/conformance"]);
  expect(good.exitCode).toBe(0);
  expect(good.stdout.toString()).toContain("ok:");
  expect(Bun.spawnSync(["bun", "src/cli.ts", "validate", "test/fixtures/broken"]).exitCode).toBe(1);
});
```

- [ ] **Step 2: 실패 확인**
  - Run: `bun test test/project.test.ts`
  - Expected: FAIL
- [ ] **Step 3: 구현** — `src/yaml.ts`, `src/glob.ts`, `src/project.ts`, `src/cli.ts`. resolver의 파싱을 `parseYaml`로 교체.
- [ ] **Step 4: conformance 픽스처 작성**
  - 모든 컴포넌트 파일 첫 줄: `# yaml-language-server: $schema=../../../schema/component.schema.json`
  - 커버리지 요구:
    - **tokens**: button.yaml이 참조하는 경로를 모두 정의. 지원 `$type` 10종이 각각 1개 이상. light/dark에 시맨틱 색 alias. `com.figma` 확장 1개 이상.
    - **button.yaml**: 아래 내용을 그대로 쓴다.
    - **icon.yaml**: vector part(`svg`는 Material Symbols `add`의 path). `fill` alias.
    - **card.yaml**:
      - slot prop(`min: 1`, `max: 3`, `preferred: [button]`, `preferredOnly: true`)
      - column layout, `width: fill`, padding 4값, `shadow`, `strokeAlign: outside`
      - absolute 상태 레이어(`position: absolute`, `width: fill`, `height: fill`)
    - **gallery.yaml**:
      - `direction: grid` + `grid`
      - `wrap: true` + `crossGap`
      - 배지: `position: absolute` + `x`/`y`
      - image part(`src`는 data URI SVG)
      - `x-figma` 1개

```yaml
# yaml-language-server: $schema=../../../schema/component.schema.json
kind: Component
metadata: { id: button, name: Button, description: "Conformance: props, variants, states, styles" }
data:
  props:
    label:    { type: text, default: Button }
    showIcon: { type: boolean, default: false }
    icon:     { type: instance, default: icon, preferred: [icon] }
  variants:
    style: { values: { filled: {}, outlined: {} }, default: filled }
    size:  { values: { small: {}, medium: {} }, default: medium }
  states: [enabled, pressed, disabled]
  anatomy:
    root:
      kind: frame
      layout: { direction: row, gap: "{space.gap}", padding: [0, 24px], align: { main: center, cross: center }, width: hug, height: 40px }
      children:
        icon:  { kind: instance, prop: icon, visible: { prop: showIcon } }
        label: { kind: text, text: { prop: label } }
  styles:
    base:
      enabled:
        root:  { fill: "{color.primary}", cornerRadius: "{radius.full}", shadow: "{elevation.1}" }
        label: { color: "{color.on-primary}", typography: "{type.label}" }
      pressed:
        root: { opacity: "{opacity.pressed}" }
      disabled:
        root:  { fill: "{color.disabled}", fillOpacity: 0.12 }
        label: { color: "{color.on-disabled}", opacity: 0.38 }
    style=outlined:
      enabled:
        root:  { fill: transparent, strokeColor: "{color.outline}", strokeWidth: 1px }
        label: { color: "{color.primary}" }
        icon:  { fill: "{color.primary}" }
    size=small:
      enabled:
        root: { height: 32px, padding: [0, 16px] }
    style=outlined,size=small:
      enabled:
        root: { strokeWidth: 0.5px }
```

- [ ] **Step 5: 통과 확인**
  - Run: `bun test && bun src/cli.ts validate examples/conformance`
  - Expected: 전체 PASS, `ok: <N> tokens, 4 components`
- [ ] **Step 6: Commit**

```bash
git add src test examples
git commit -m "feat(cli): project loader, openui validate, conformance fixtures"
```

---

### Task 6: 스펙 문서 v0.1

**Files:**
- Create: `spec/openui-spec.md`
- Modify: `README.md` (스펙 링크 1줄)

**Interfaces:**
- Consumes: 위 "Spec v0.1 결정" 전체와 conformance 픽스처.
- 전체 예시는 `examples/conformance/` 파일 링크로만 둔다. 문서 안에 예시를 복제하지 않는다.

- [ ] **Step 1: 문서 작성** — 다음 순서의 장 제목을 정확히 사용:
  1. `## 1. 소개` — 목적, YAML SSOT, 용어(part와 slot 구분), 참고 자료(rootage, DTCG 2025.10, Figma REST API 스펙)와 각각에서 차용한 것.
  2. `## 2. 문서 구성과 매니페스트`
  3. `## 3. 토큰` — §T 전부. 컬렉션 대응 규칙.
  4. `## 4. 컴포넌트` — §C 전부, §L/§P 표, 값 shorthand.
  5. `## 5. 스타일 해석` — §R 알고리즘. `test/resolve.test.ts`의 예시들을 문장으로.
  6. `## 6. 확장` — `x-figma`, `x-*`.
  7. `## 7. Exchange 포맷 (0.2에서 정의)`
  8. `## 부록 A. Figma 매핑` — 표 형식 `개념 | REST 필드(api_types.ts) | Plugin API`. 행 목록:
     - collection, mode, token → variable(`VariableResolvedDataType`)
     - typography → TextStyle
     - shadow → EffectStyle
     - component → `COMPONENT_SET` / `COMPONENT`(이름 `axis=value, state=s`)
     - text, boolean, instance, slot prop → `ComponentPropertyType`, `SlotSettings`
     - layout 각 키 → `layoutMode`, `itemSpacing`, `counterAxisSpacing`, `padding*`, `primaryAxisAlignItems`, `counterAxisAlignItems`, `layoutWrap`, `layoutSizingHorizontal/Vertical`, `min/max*`, `layoutPositioning`, grid 필드
     - `fill`, `fillOpacity` → `fills[].color`, `fills[].opacity`
     - `strokeColor`, `strokeWidth`, `strokeAlign` → `strokes`, `strokeWeight`, `strokeAlign`
     - 토큰 참조 → `boundVariables`
     - vector `svg` → `fillGeometry`
     - 필드 이름은 `https://raw.githubusercontent.com/figma/rest-api-spec/main/dist/api_types.ts`에서 확인해 정확히 쓴다.
  9. `## 부록 B. 미해결 과제` — state 조합, string/boolean 토큰, variant 조합 제외, 리플·포커스 링 오프셋, 주석 보존 병합, 이름("OpenUI" 충돌).
- [ ] **Step 2: 검증**
  - Run: `bun test && bun src/cli.ts validate examples/conformance`
  - Expected: PASS / `ok:`
  - 문서가 §T, §C, §L/§P, §R의 모든 소절을 다루는지 체크리스트로 확인한다.
- [ ] **Step 3: Commit**

```bash
git add spec README.md
git commit -m "docs(spec): OpenUI YAML spec v0.1"
```
