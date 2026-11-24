# OpenUI M2 웹 에디터 + M3 Material 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- 로컬 웹 YAML 에디터를 만든다: 텍스트 편집 + 실시간 진단 + variant×state 프리뷰 + 체크리스트 러너.
- Material 3 파일럿 5종(Button, Icon button, Checkbox, Filter chip, Card)을 YAML로 작성하고, 체크리스트 자동 항목이 전부 통과하게 한다.

**Architecture:**
- 코어(M1의 `src/`)는 브라우저와 CLI가 함께 쓴다.
- 웹 렌더러는 스펙을 VNode 트리와 CSS로 바꾸는 순수 함수다. 토큰은 CSS 변수 시트로 만든다.
- 에디터는 Bun.serve 하나로 동작한다: HTML 번들 + `.yaml` 파일 API, `127.0.0.1` 전용.
- 체크리스트 러너는 순수 오케스트레이션이고, 실제 측정(DOM `getComputedStyle`)은 에디터가 주입한다.

**Tech Stack:** Bun 1.2.19+ (`Bun.serve` routes + HTML import), TypeScript, `zod@^4`, `yaml@^2`, CodeMirror 6 (`codemirror`, `@codemirror/lang-yaml`, `@codemirror/lint`, `@codemirror/autocomplete`). UI 프레임워크는 쓰지 않는다(vanilla DOM).

**Spec:** `docs/superpowers/specs/2026-11-24-openui-yaml-spec-design.md`
**선행:** `docs/superpowers/plans/2026-11-24-openui-m1-spec-v0.1.md` 완료(브랜치 `m1-spec-v0.1` 위에서 이어서 작업).

## Global Constraints

- M1 계획의 Global Constraints를 전부 따른다.
- 의존성은 M1 목록 + `codemirror`, `@codemirror/lang-yaml`, `@codemirror/lint`, `@codemirror/autocomplete`만 추가한다.
- 서버 보안:
  - `hostname: "127.0.0.1"`, 기본 포트 4173.
  - `/api/*`는 Host 헤더가 `127.0.0.1:<port>` 또는 `localhost:<port>`가 아니면 403.
  - 파일 API는 프로젝트 루트 아래의 `.yaml`만 다룬다. 루트 밖 경로, symlink 탈출, 절대경로, NUL 문자가 오면 400.
- CSS 변수 이름: `cssVar(path) = "--" + path.replaceAll(".", "-")`. 예: `--md-sys-color-primary`.
- 프리뷰 루트에는 클래스 `ou-root`와 modifier별 `data-<modifier>="<context>"` 속성을 둔다.
- 자동화용 전역: `window.__openui = { runAll(): Promise<Record<string, ItemResult[]>>, diagnostics: Diagnostic[] }`
- Material 소스: material-web 커밋 `268681913e0a5cb2130c7d00623874ecc7faa5b5`의 `tokens/versions/v0_192/` (Apache-2.0).
  - 내려받은 파일은 `.cache/material-web/`(gitignore)에 두고, 스크립트에는 경로 인자로 넘긴다.
- 브라우저 검증은 gstack `/browse` 스킬로 한다(사용자 CLAUDE.md 규칙).

## Review Focus

1. **경로 탈출**: `PUT /api/file?path=../../.zshrc`, symlink, `%2e%2e` 인코딩 경로로 루트 밖에 쓰지 못해야 한다. → Task 3
2. **편집 중 문법 오류**: YAML이 반쯤 깨진 상태(따옴표 미완 등)에서도 에디터가 죽지 않아야 한다. 진단만 띄우고 프리뷰는 마지막 정상 렌더를 유지한다. → Task 4·5
3. **instance 순환**(A가 B를, B가 A를 instance로 참조): 프리뷰가 무한 재귀에 빠지지 않고 깊이 제한 메시지를 렌더해야 한다. → Task 2
4. **px 반올림 오차**(line-height 1.4285…×14px = 19.9999px): 기대값 20px과 비교할 때 오차 0.05px 이내면 통과로 본다. → Task 1
5. **저장하지 않은 변경**: 저장 안 한 파일이 있을 때 다른 파일로 이동해도 편집 내용이 사라지지 않아야 한다. 탭을 닫으려 하면 경고한다. → Task 4

---

## §K 체크리스트 스펙 (`kind: Checklist`)

```yaml
# yaml-language-server: $schema=../../../schema/checklist.schema.json
kind: Checklist
metadata: { id: button, component: button, source: "<출처>", description?: "" }
items:
  - id: height                       # kebab-case, 파일 안에서 고유
    title: 컨테이너 높이 40dp
    check:                           # 자동 항목
      variant?: { style: filled | [filled, tonal] }   # 생략한 축 = 모든 값
      state?: enabled | [enabled, hovered]            # 생략 = 모든 state
      mode?: { theme: light | [light, dark] }         # 생략 = 모든 modifier context
      part: root
      property: height               # CSS longhand만 허용
      expect: 40px                   # 문자열(안의 "{a.b}"는 var(--a-b)로 치환) 또는 number
  - id: ripple
    title: pressed 리플이 탭 위치에서 퍼짐
    manual: true                     # 수동 항목
    hint?: { variant?: {...}, state?: pressed }       # 프리뷰에서 강조할 셀
```

- **검증 규칙**:
  - `metadata.component`는 프로젝트에 있는 컴포넌트여야 한다.
  - part, 축/값, state, modifier/context가 실제로 존재해야 한다.
  - `expect` 안의 alias는 존재하는 토큰이어야 한다.
  - item id는 고유해야 한다.
  - `check`와 `manual`은 둘 중 정확히 하나.
  - `property`는 `^[a-z-]+$`이고 다음 shorthand가 아니어야 한다: `background border border-radius padding margin font gap inset outline flex grid place-items overflow transition animation`.
- **판정**:
  - 각 케이스(variant × state × mode)마다 `actual = getComputedStyle(part)[property]`를 읽는다.
  - `expected`는 프로브 요소에 `expectToCss(expect)`를 설정한 뒤 다시 읽은 computed 값이다. 브라우저가 양쪽을 같은 방식으로 정규화하게 하려는 것.
  - 문자열이 같으면 통과. 양쪽이 모두 `^-?[\d.]+px$`이면 차이가 0.05 미만일 때 통과.
- 매니페스트에 `checklists?: string[]`(glob)를 추가한다. 컴포넌트당 체크리스트는 최대 1개.

## §W 웹 매핑 (렌더러 단일 원천)

**토큰 → CSS 변수 값**:

| `$type` | CSS |
|---|---|
| color | `rgb(R G B / A)`, R = round(c×255), A = alpha ?? 1 |
| dimension, duration | `${value}${unit}` |
| number | `${n}` |
| cubicBezier | `cubic-bezier(a, b, c, d)` |
| fontFamily | 각 이름을 큰따옴표로 감싸 `, `로 연결 |
| fontWeight | 숫자. 이름은 DTCG 표대로 숫자로(thin/hairline=100 … extra-black/ultra-black=950) |
| shadow | `[inset ]X Y Blur Spread Color`를 `, `로 연결 |
| gradient | `linear-gradient(180deg, C P%, …)` |
| typography | 변수 5개: `--x-font-family`, `--x-font-size`, `--x-font-weight`, `--x-letter-spacing`, `--x-line-height` |

- 어디서든 alias는 `var(--target)`이 된다.
- 시트 구성:
  - `.ou-root { set 토큰 + 각 modifier의 default context }`
  - modifier context마다 `.ou-root[data-<modifier>="<ctx>"] { … }`

**part → CSS** (모든 part에 `box-sizing: border-box`):

| 스펙 | CSS |
|---|---|
| direction row/column | `display:flex; flex-direction:row/column` |
| direction grid + grid | `display:grid; grid-template-columns:repeat(c, max-content); grid-template-rows:repeat(r, auto)` |
| direction none 또는 생략(frame/slot) | `display:block; position:relative` |
| gap / crossGap | row 방향: `column-gap:gap; row-gap:crossGap??gap`. column 방향: 그 반대. grid: `column-gap:gap; row-gap:crossGap??gap` |
| padding | `padding` (값 개수 그대로) |
| align.main | `justify-content`: start→flex-start, center, end→flex-end, space-between |
| align.cross | `align-items`: start→flex-start, center, end→flex-end, baseline |
| wrap: true | `flex-wrap:wrap` |
| width/height: dim | 그 값 + `flex-shrink:0` |
| width/height: hug | `max-content` + `flex-shrink:0` |
| fill, 부모 주축 방향 | `flex:1 1 0; min-width:0` (column 부모면 `min-height:0`) |
| fill, 부모 교차축 방향 | `align-self:stretch` |
| fill, 부모가 none/grid이거나 root | `100%` |
| position: absolute | `position:absolute; left:x??0; top:y??0`. width가 fill이면 `left:0; right:0`, height가 fill이면 `top:0; bottom:0` |
| x/y (부모 direction none) | `position:absolute; left; top` |
| min/max | `min-width` 등 |
| fill (frame/slot) | `background`. `fillOpacity`가 있으면 `background-color: color-mix(in srgb, <c> <fo×100>%, transparent)` |
| fill (vector) | svg `fill: var(--ou-icon-fill, <c>)`, `fill-opacity: var(--ou-icon-fill-opacity, <fo??1>)` |
| fill (instance) | 래퍼에 `--ou-icon-fill: <c>`(+ `--ou-icon-fill-opacity`) |
| strokeColor/strokeWidth (frame/slot) | `box-shadow`: inside → `inset 0 0 0 W C`, outside → `0 0 0 W C`, center → `inset 0 0 0 W/2 C, 0 0 0 W/2 C` |
| stroke (vector) | `stroke`, `stroke-width` |
| shadow | `box-shadow`에 stroke 그림자 뒤로 `, var(--token)`를 이어 붙임 |
| cornerRadius | `border-radius` |
| opacity | `opacity` |
| visible: false | `display:none` |
| color / textAlign | `color` / `text-align` (justified → justify) |
| typography | `font-family/size/weight`, `letter-spacing`, `line-height`를 `var(--x-…)`로 |
| text part | `white-space:nowrap` |
| image | `<img>`, `object-fit:cover` |
| vector | `<svg viewBox>` + `d`마다 `<path>` |

---

### Task 1: 체크리스트 코어 (스키마·검증·전개·러너) + 매니페스트 확장

**Files:**
- Create: `src/checklist/schema.ts`, `src/checklist/validate.ts`, `src/checklist/run.ts`, `src/render/css-var.ts`
- Modify: `src/manifest.ts` (`checklists?: string[]`)
- Modify: `src/project.ts`
  - `Project.checklists: Map<string, { file: string; doc: Checklist }>` 추가. 키는 component id.
  - zod를 통과한 컴포넌트는 의미 오류가 있어도 `components`에 포함한다(프리뷰를 최대한 그리기 위함).
- Modify: `scripts/gen-schema.ts` (`checklist.schema.json` 추가), 재생성한 `schema/*.json`
- Test: `test/checklist.test.ts`

**Interfaces:**
- Consumes: `Project`, `loadProject` (M1 Task 5); `variantAxes`, `statesOf`, `partsOf` (M1 Task 3); `TokenSet` (M1 Task 1)
- Produces:
  - `src/render/css-var.ts`: `cssVar(path: string): string`, `aliasesToVars(s: string): string`(`{a.b}` → `var(--a-b)`)
  - `src/checklist/schema.ts`: `Checklist` zod, `type Checklist`, `type ChecklistItem`
  - `src/checklist/validate.ts`: `validateChecklist(cl: Checklist, file: string, project: Project): Diagnostic[]`
  - `src/checklist/run.ts`:
    - `type Case = { variant: Record<string, string>; state: string; mode: Record<string, string> }`
    - `expandCheck(check: NonNullable<ChecklistItem["check"]>, doc: Component, tokens: TokenSet): Case[]`. 순서: 축 순서 → state → modifier.
    - `expectToCss(expect: string | number): string`
    - `type Measure = (c: Case & { part: string; property: string; expectCss: string }) => Promise<{ actual: string; expected: string }>`
    - `type CaseResult = Case & { actual: string; expected: string; pass: boolean }`
    - `type ItemResult = { id: string; title: string; kind: "auto" | "manual"; pass: boolean | null; cases: CaseResult[] }`. manual이면 `pass: null`, `cases: []`.
    - `sameCss(a: string, b: string): boolean`. §K 판정 규칙.
    - `runChecklist(cl: Checklist, doc: Component, tokens: TokenSet, measure: Measure): Promise<ItemResult[]>`

- [ ] **Step 1: 실패하는 테스트 작성** — `test/checklist.test.ts`
  - conformance 프로젝트에 `checklists/button.yaml`(아래)을 추가하고 매니페스트에 `checklists: ["checklists/*.yaml"]`.

```yaml
# examples/conformance/checklists/button.yaml
# yaml-language-server: $schema=../../../schema/checklist.schema.json
kind: Checklist
metadata: { id: button, component: button, source: conformance }
items:
  - { id: height, title: "높이 40px", check: { variant: { size: medium }, part: root, property: height, expect: 40px } }
  - { id: filled-bg, title: "filled 배경", check: { variant: { style: filled }, state: enabled, part: root, property: background-color, expect: "{color.primary}" } }
  - { id: ripple, title: "리플", manual: true, hint: { state: pressed } }
```

```ts
test("conformance checklist loads clean", async () => {
  const { project, diagnostics } = await loadProject(fsIO("examples/conformance"));
  expect(diagnostics).toEqual([]);
  expect(project!.checklists.get("button")!.doc.items.length).toBe(3);
});
test("expandCheck: omitted axis/state/mode = all", async () => {
  const { project } = await loadProject(fsIO("examples/conformance"));
  const doc = project!.components.get("button")!.doc;
  const cases = expandCheck({ variant: { size: "medium" }, part: "root", property: "height", expect: "40px" }, doc, project!.tokens);
  expect(cases.length).toBe(2 /*style*/ * 3 /*states*/ * 2 /*theme*/);
  expect(cases[0]).toEqual({ variant: { style: "filled", size: "medium" }, state: "enabled", mode: { theme: "light" } });
});
test("expectToCss + sameCss", () => {
  expect(expectToCss("color-mix(in srgb, {md.sys.color.on-surface} 12%, transparent)"))
    .toBe("color-mix(in srgb, var(--md-sys-color-on-surface) 12%, transparent)");
  expect(expectToCss(0.38)).toBe("0.38");
  expect(sameCss("19.9999px", "20px")).toBe(true);
  expect(sameCss("19.9px", "20px")).toBe(false);
  expect(sameCss("rgb(1, 2, 3)", "rgb(1, 2, 3)")).toBe(true);
});
test("runChecklist with fake measure", async () => {
  const { project } = await loadProject(fsIO("examples/conformance"));
  const cl = project!.checklists.get("button")!.doc, doc = project!.components.get("button")!.doc;
  const r = await runChecklist(cl, doc, project!.tokens, async (c) => ({ actual: c.state === "pressed" ? "41px" : "40px", expected: "40px" }));
  expect(r[0]).toMatchObject({ id: "height", kind: "auto", pass: false });
  expect(r[0].cases.filter((x) => !x.pass).every((x) => x.state === "pressed")).toBe(true);
  expect(r[2]).toEqual({ id: "ripple", title: "리플", kind: "manual", pass: null, cases: [] });
});
const bad: [string, string, string][] = [
  ["unknown part", "part: root, property: height", "part: rooot, property: height"],
  ["shorthand", "property: height", "property: padding"],
  ["unknown state", "state: enabled", "state: hovered"],
  ["unknown token", "{color.primary}", "{color.nope}"],
];
for (const [name, from, to] of bad)
  test(`checklist invalid: ${name}`, async () => { /* conformance를 memoryIO로 복사 → checklists/button.yaml에 replace(from, to) → 진단 1개 이상, 메시지에 to의 핵심어(rooot|padding|hovered|color.nope) 포함 */ });
```

- [ ] **Step 2: 실패 확인**
  - Run: `bun test test/checklist.test.ts`
  - Expected: FAIL
- [ ] **Step 3: 구현** — 위 Interfaces 그대로. `bun scripts/gen-schema.ts`로 스키마 재생성.
- [ ] **Step 4: 통과 확인**
  - Run: `bun test`
  - Expected: 전체 PASS (M1 테스트 포함)
- [ ] **Step 5: Commit**

```bash
git add src scripts schema test examples
git commit -m "feat(checklist): checklist spec, validation, case expansion and runner"
```

---

### Task 2: 웹 렌더러 (순수 함수)

**Files:**
- Create: `src/render/tokens.ts`, `src/render/style.ts`, `src/render/vnode.ts`
- Test: `test/render.test.ts`

**Interfaces:**
- Consumes: `cssVar` (Task 1); `TokenSet` (M1 Task 1); `Project` (Task 1); `resolveStyles` (M1 Task 4); `partsOf`, `variantAxes`, `statesOf` (M1 Task 3); `PartKind` (M1 Task 2)
- Produces:
  - `src/render/tokens.ts`:
    - `tokenValueCss(type: TokenType, value: unknown): string | Record<string, string>`. typography만 하위 변수 5개 맵을 반환.
    - `tokenSheet(set: TokenSet): string`. §W 시트.
  - `src/render/style.ts`: `partStyle(kind: PartKind, props: Record<string, unknown>, ctx: { parentDirection: string | null; isRoot: boolean }): Record<string, string>`. kebab-case CSS 속성 맵, §W 표 그대로.
  - `src/render/vnode.ts`:
    - `type VNode = { tag: string; attrs: Record<string, string>; style: Record<string, string>; text?: string; children: VNode[] }`
    - `type RenderOptions = { variant: Record<string, string>; state: string; props: Record<string, string | boolean | null> }`
    - `buildComponent(project: Project, id: string, opts: RenderOptions, depth?: number): VNode`
    - 출력 규칙:
      - root는 `attrs["data-component"] = id`.
      - 모든 part는 `attrs["data-part"] = <name>`.
      - slot에 children이 없으면 점선 placeholder(`text = prop 이름`).
      - instance 래퍼에 width/height가 있으면 내부 root의 style width/height를 `100%`로 덮어쓴다.
      - `depth > 8`이면 `{tag:"div", text:"instance depth limit"}`.
      - text part의 `text: {prop}`는 `opts.props[prop] ?? default`.
      - `visible: {prop}`가 false이면 `display:none`.

- [ ] **Step 1: 실패하는 테스트 작성** — `test/render.test.ts` (표 기반, 대표 케이스)

```ts
const css = (k: PartKind, p: object, parentDirection: string | null = "row", isRoot = false) => partStyle(k, p as any, { parentDirection, isRoot });
test("layout mapping", () => {
  expect(css("frame", { direction: "row", gap: "8px", align: { main: "center", cross: "end" } })).toMatchObject({ display: "flex", "flex-direction": "row", "column-gap": "8px", "row-gap": "8px", "justify-content": "center", "align-items": "flex-end" });
  expect(css("frame", { width: "fill" }, "row")).toMatchObject({ flex: "1 1 0", "min-width": "0" });
  expect(css("frame", { width: "fill" }, "column")).toMatchObject({ "align-self": "stretch" });
  expect(css("frame", { width: "hug" })).toMatchObject({ width: "max-content", "flex-shrink": "0" });
  expect(css("frame", { position: "absolute", width: "fill", height: "fill" })).toMatchObject({ position: "absolute", left: "0", right: "0", top: "0", bottom: "0" });
});
test("paint mapping", () => {
  expect(css("frame", { fill: "{md.sys.color.on-surface}", fillOpacity: 0.12 })["background-color"]).toBe("color-mix(in srgb, var(--md-sys-color-on-surface) 12%, transparent)");
  expect(css("frame", { strokeColor: "#000000", strokeWidth: "1px", shadow: "{e.1}" })["box-shadow"]).toBe("inset 0 0 0 1px #000000, var(--e-1)");
  expect(css("frame", { strokeColor: "#000000", strokeWidth: "2px", strokeAlign: "center" })["box-shadow"]).toBe("inset 0 0 0 1px #000000, 0 0 0 1px #000000");
  expect(css("instance", { fill: "{c}" })).toMatchObject({ "--ou-icon-fill": "var(--c)" });
  expect(css("text", { typography: "{t.label}" })).toMatchObject({ "font-size": "var(--t-label-font-size)", "line-height": "var(--t-label-line-height)" });
  expect(css("frame", { visible: false })).toMatchObject({ display: "none" });
});
test("token values and sheet", () => {
  expect(tokenValueCss("color", { colorSpace: "srgb", components: [1, 0, 0.5], alpha: 0.5 })).toBe("rgb(255 0 128 / 0.5)");
  expect(tokenValueCss("dimension", { value: 0.875, unit: "rem" })).toBe("0.875rem");
  expect(tokenValueCss("fontWeight", "medium")).toBe("500");
  expect(tokenValueCss("color", "{a.b}")).toBe("var(--a-b)");
  // conformance 토큰으로 시트 생성: '.ou-root {' 와 '.ou-root[data-theme="dark"] {' 를 포함
});
test("buildComponent: conformance button", async () => {
  const { project } = await loadProject(fsIO("examples/conformance"));
  const v = buildComponent(project!, "button", { variant: { style: "outlined", size: "small" }, state: "enabled", props: { label: "Go", showIcon: true } });
  expect(v.attrs["data-component"]).toBe("button");
  const find = (n: VNode, part: string): VNode | undefined => n.attrs["data-part"] === part ? n : n.children.map((c) => find(c, part)).find(Boolean);
  expect(find(v, "label")!.text).toBe("Go");
  expect(v.style.height).toBe("32px");
  expect(find(v, "icon")!.style["--ou-icon-fill"]).toBe("var(--color-primary)");
  expect(find(v, "icon")!.style.display).toBeUndefined();
});
test("instance cycle stops at depth limit", async () => { /* memoryIO로 a↔b가 서로 instance로 참조하는 프로젝트 → JSON.stringify(build)에 "instance depth limit" 포함 */ });
```

- [ ] **Step 2: 실패 확인**
  - Run: `bun test test/render.test.ts`
  - Expected: FAIL
- [ ] **Step 3: 구현** — `tokens.ts`, `style.ts`, `vnode.ts`. 동작은 §W 표 그대로.
- [ ] **Step 4: 통과 확인**
  - Run: `bun test`
  - Expected: PASS
- [ ] **Step 5: Commit**

```bash
git add src/render test/render.test.ts
git commit -m "feat(render): spec→CSS/VNode web renderer and token stylesheet"
```

---

### Task 3: 에디터 서버

**Files:**
- Create: `editor/server.ts`, `editor/index.html`(이 Task에서는 빈 껍데기 `<div id="app">` + `<script type="module" src="./app.ts">`), `editor/app.ts`(빈 파일)
- Modify: `package.json` (`"scripts": { "editor": "bun editor/server.ts" }`)
- Test: `test/server.test.ts`

**Interfaces:**
- Produces (`editor/server.ts`):
  - `safePath(root: string, rel: string): string | null`. 허용되면 절대경로, 아니면 null. `decodeURIComponent` 이후의 값을 받는다.
  - `allowedHost(host: string | null, port: number): boolean`
  - `startServer(opts: { root: string; port: number }): import("bun").Server`
    - `GET /` → index.html 번들
    - `GET /api/files` → `{ files: string[] }`(`fsIO(root).list()`)
    - `GET /api/file?path=` → text/plain
    - `PUT /api/file?path=` → 본문을 UTF-8로 기록하고 204
  - 직접 실행: `bun editor/server.ts <projectDir> [--port N]` → `http://127.0.0.1:N` 출력

- [ ] **Step 1: 실패하는 테스트 작성** — `test/server.test.ts`

```ts
test("safePath", () => {
  const root = mkdtempSync(join(tmpdir(), "ou-"));
  mkdirSync(join(root, "components"));
  expect(safePath(root, "components/a.yaml")).toBe(join(root, "components/a.yaml"));
  for (const bad of ["../x.yaml", "/etc/passwd", "a.txt", "components/../../x.yaml", "a\0.yaml"]) expect(safePath(root, bad)).toBeNull();
  const outside = mkdtempSync(join(tmpdir(), "ou-out-"));
  symlinkSync(outside, join(root, "link"));
  expect(safePath(root, "link/a.yaml")).toBeNull();
});
test("allowedHost", () => {
  expect(allowedHost("127.0.0.1:4173", 4173)).toBe(true);
  expect(allowedHost("localhost:4173", 4173)).toBe(true);
  expect(allowedHost("evil.com:4173", 4173)).toBe(false);
  expect(allowedHost(null, 4173)).toBe(false);
});
test("file API round trip", async () => {
  const root = mkdtempSync(join(tmpdir(), "ou-"));
  writeFileSync(join(root, "openui.yaml"), "openui: \"0.1\"\n");
  const server = startServer({ root, port: 0 });
  const base = `http://127.0.0.1:${server.port}`;
  expect((await (await fetch(`${base}/api/files`)).json()).files).toEqual(["openui.yaml"]);
  expect((await fetch(`${base}/api/file?path=openui.yaml`, { method: "PUT", body: "x: 1\n" })).status).toBe(204);
  expect(readFileSync(join(root, "openui.yaml"), "utf8")).toBe("x: 1\n");
  expect((await fetch(`${base}/api/file?path=..%2Fx.yaml`, { method: "PUT", body: "" })).status).toBe(400);
  server.stop();
});
```

- [ ] **Step 2: 실패 확인**
  - Run: `bun test test/server.test.ts`
  - Expected: FAIL
- [ ] **Step 3: 구현** — `editor/server.ts`
  - symlink 검사: 존재하는 가장 가까운 상위 디렉터리의 `realpathSync`가 `realpathSync(root)` 아래인지 확인.
  - `/api/*`에서는 `allowedHost(req.headers.get("host"), port)`가 실패하면 403.
- [ ] **Step 4: 통과 확인**
  - Run: `bun test`
  - Expected: PASS
- [ ] **Step 5: Commit**

```bash
git add editor package.json test/server.test.ts
git commit -m "feat(editor): localhost-only file server with path guard"
```

---

### Task 4: 에디터 UI — 편집기·진단·저장

**Files:**
- Create: `editor/support.ts`(순수 함수), `editor/style.css`
- Modify: `editor/index.html`, `editor/app.ts`
- Test: `test/editor-support.test.ts`

**Interfaces:**
- Consumes: `loadProject`, `memoryIO` (M1), `Diagnostic` (M1), 서버 API (Task 3)
- Produces (`editor/support.ts`):
  - `rangeOf(text: string, path: (string | number)[]): { from: number; to: number }`
    - `yaml.parseDocument`로 path의 노드 범위를 찾는다.
    - 없으면 경로를 한 단계씩 위로 올라가며 찾은 노드의 범위.
    - 끝내 못 찾으면 `{from: 0, to: 0}`.
  - `tokenCompletion(textBefore: string, tokenPaths: string[]): { from: number; options: string[] } | null`
    - `textBefore`가 `/"\{([\w.-]*)$/`로 끝날 때만 동작. 접두사가 일치하는 토큰 경로를 반환하고, `from`은 접두사 시작 위치.
- 에디터 동작(`editor/app.ts`):
  - 레이아웃: 왼쪽 파일 목록, 가운데 CodeMirror, 오른쪽 프리뷰 영역(Task 5), 아래 Problems 패널.
  - 시작 시 `/api/files`와 모든 파일 내용을 읽어 `buffers: Map<path, {text, saved}>`에 둔다.
  - 편집하면 200ms debounce 후 `loadProject(memoryIO(buffers))` → `window.__openui.diagnostics` 갱신.
    - 현재 파일 진단은 CodeMirror lint(`rangeOf`)로 표시.
    - 전체 진단은 Problems 패널에 표시(클릭하면 해당 파일·위치로 이동).
  - 파일을 전환해도 버퍼는 유지된다. 저장 안 된 파일은 목록에 `●` 표시. `beforeunload`에서 미저장이 있으면 경고.
  - `⌘S`/`Ctrl+S` → `PUT`.
  - 자동완성은 `tokenCompletion`(토큰 경로)만 제공한다. 속성명 자동완성은 범위 밖.

- [ ] **Step 1: 실패하는 테스트 작성** — `test/editor-support.test.ts`

```ts
const t = "a:\n  b: 1\n  c: [x, y]\n";
test("rangeOf exact, array index, fallback to parent, root", () => {
  expect(rangeOf(t, ["a", "b"])).toEqual({ from: t.indexOf("1"), to: t.indexOf("1") + 1 });
  expect(rangeOf(t, ["a", "c", 1])).toEqual({ from: t.indexOf("y"), to: t.indexOf("y") + 1 });
  const parent = rangeOf(t, ["a"]);
  expect(rangeOf(t, ["a", "zz"])).toEqual(parent);
  expect(rangeOf(t, [])).toEqual({ from: 0, to: 0 });
});
test("rangeOf survives broken YAML", () => expect(rangeOf('a: "unterminated', ["a"])).toBeDefined());
test("tokenCompletion", () => {
  expect(tokenCompletion('fill: "{md.sys.co', ["md.sys.color.primary", "md.sys.shape.corner-full"]))
    .toEqual({ from: 'fill: "{'.length, options: ["md.sys.color.primary"] });
  expect(tokenCompletion("fill: md", ["md.sys.color.primary"])).toBeNull();
});
```

- [ ] **Step 2: 실패 확인**
  - Run: `bun test test/editor-support.test.ts`
  - Expected: FAIL
- [ ] **Step 3: 구현** — `editor/support.ts` → `editor/app.ts`, `index.html`, `style.css`
- [ ] **Step 4: 단위 테스트 통과 확인**
  - Run: `bun test`
  - Expected: PASS
- [ ] **Step 5: 브라우저 확인** — `bun editor/server.ts examples/conformance` 실행 후 `/browse`로 `http://127.0.0.1:4173`을 열어 순서대로 확인:
  1. `components/button.yaml`을 열고 `lable:` 오타 입력 → 해당 줄에 lint 표시, Problems에 1건.
  2. 원래대로 되돌림 → 진단 0.
  3. `"{co` 입력 → 자동완성에 `color.primary`.
  4. 따옴표를 닫지 않은 상태로 둠 → 앱이 멈추지 않음.
  5. 다른 파일로 갔다가 돌아옴 → 편집 내용 유지.
  6. `⌘S` → `git diff examples/conformance`에 변경이 반영됨(확인 후 `git checkout examples/conformance`).
- [ ] **Step 6: Commit**

```bash
git add editor test/editor-support.test.ts
git commit -m "feat(editor): CodeMirror YAML editing, live diagnostics, token completion, save"
```

---

### Task 5: 에디터 UI — 프리뷰 그리드·props·모드

**Files:**
- Create: `editor/preview.ts` (`toDOM`, 그리드, props 패널)
- Modify: `editor/app.ts`, `editor/style.css`

**Interfaces:**
- Consumes: `buildComponent`, `tokenSheet` (Task 2); `variantCombos` (M1 Task 4); `statesOf` (M1 Task 3)
- Produces (`editor/preview.ts`):
  - `toDOM(v: VNode): Element`. `svg`/`path`는 `createElementNS("http://www.w3.org/2000/svg", …)`.
  - `renderPreview(host: HTMLElement, project: Project, componentId: string, ui: { props: RenderOptions["props"]; modes: Record<string, string> }): void`
  - 동작:
    - 상단: modifier마다 `<select>`(context 목록).
    - props 패널: text → input, boolean → checkbox, instance → select(`preferred` 먼저, 그다음 전체 컴포넌트, `(none)`).
    - 그리드: 행 = `variantCombos`(라벨 `axis=value, …`), 열 = `statesOf`. 각 셀 = `.ou-root[data-<modifier>]` 안의 `toDOM(buildComponent(...))`.
    - `<style id="ou-tokens">`를 `tokenSheet`로 갱신.
    - 현재 파일이 컴포넌트면 그것을, 체크리스트면 `metadata.component`를 프리뷰.
    - 진단이 있어도 해당 컴포넌트가 project에 있으면 렌더한다. 렌더 중 예외가 나면 마지막 정상 DOM을 유지하고 오류 배너를 띄운다.

- [ ] **Step 1: 구현** — `editor/preview.ts`, `app.ts` 연결
- [ ] **Step 2: 회귀 확인**
  - Run: `bun test`
  - Expected: PASS
- [ ] **Step 3: 브라우저 확인** — `/browse`로 conformance 프로젝트에서:
  1. button: 그리드 4행(style×size) × 3열(states)이 보이고, outlined 행은 배경이 투명하고 테두리가 있음.
  2. theme을 dark로 → 색이 바뀜.
  3. label에 `Hello` 입력 → 모든 셀 라벨이 바뀜.
  4. showIcon 체크 → 아이콘 표시.
  5. card: slot placeholder 표시. gallery: grid와 absolute 배지 위치.
  6. 스크린샷을 남긴다.
- [ ] **Step 4: Commit**

```bash
git add editor
git commit -m "feat(editor): variant×state preview grid with props and mode switching"
```

---

### Task 6: 에디터 UI — 체크리스트 패널·자동 측정

**Files:**
- Create: `editor/checklist-panel.ts`
- Modify: `editor/app.ts`, `editor/style.css`

**Interfaces:**
- Consumes: `runChecklist`, `expectToCss`, `ItemResult`, `Measure` (Task 1); `buildComponent`, `toDOM` (Task 2, 5)
- Produces:
  - `domMeasure(project: Project, componentId: string): Measure`
    - 화면 밖(`position:fixed; left:-10000px`) `.ou-root` 컨테이너에 해당 케이스를 렌더한다.
    - `[data-part=<part>]`(root는 `[data-component]`)의 `getComputedStyle(el).getPropertyValue(property)`를 읽는다.
    - 같은 컨테이너의 프로브 `<div>`에 `style.setProperty(property, expectCss)`를 하고 computed 값을 읽는다.
    - 측정 후 정리한다.
  - `window.__openui.runAll()`: `project.checklists` 전부를 실행하고 `{ [componentId]: ItemResult[] }`를 반환한다.
  - 패널:
    - 자동 항목은 ✓/✗와 실패 케이스(`style=filled · hovered · dark: actual … ≠ expected …`)를 보여준다.
    - 수동 항목은 체크박스. 상태는 localStorage 키 `openui:check:<checklistId>:<itemId>`에 저장하며, 접근은 try/catch로 감싼다.
    - 항목을 클릭하면 `check`/`hint`에 맞는 프리뷰 셀에 outline 강조.
    - 상단 요약: `auto 12/14 · manual 2/4`.

- [ ] **Step 1: 구현** — `editor/checklist-panel.ts`, `app.ts` 연결
- [ ] **Step 2: 회귀 확인**
  - Run: `bun test`
  - Expected: PASS
- [ ] **Step 3: 브라우저 확인** — `/browse`로 conformance에서:
  1. `checklists/button.yaml`을 연다 → 패널에서 auto 2/2.
  2. 컴포넌트에서 `height: 40px`를 `41px`로 바꾼다 → height 항목 ✗, 실패 케이스에 `41px`이 보임 → 되돌림.
  3. JS `await window.__openui.runAll()`의 결과에서 button 자동 항목이 모두 `pass: true`.
  4. 수동 항목 체크 → 새로고침 후에도 유지.
- [ ] **Step 4: Commit**

```bash
git add editor
git commit -m "feat(editor): checklist panel with DOM-measured auto checks and manual ticks"
```

---

### Task 7: material-web 토큰 변환 + Material 3 프로젝트 골격

**Files:**
- Create: `scripts/material-web-tokens.ts`
- Create(생성물): `examples/material3/tokens/{ref,sys,comp,sys-color-light,sys-color-dark}.tokens.yaml`
- Create(직접 작성): `examples/material3/tokens/elevation.tokens.yaml`, `examples/material3/tokens/material3.resolver.yaml`, `examples/material3/openui.yaml`
- Create: `examples/material3/components/{icon-add,icon-check,icon-remove,icon-star}.yaml`
- Modify: `.gitignore` (`.cache/`)
- Test: `test/material-web-tokens.test.ts`

**Interfaces:**
- Produces (`scripts/material-web-tokens.ts`):
  - `parseScssTokens(scss: string): Record<string, Record<string, { alias?: string; literal?: string }>>`
    - 바깥 키는 함수명(`values`, `values-light`, `values-dark`).
    - `map.get($deps, 'md-sys-color', 'primary')`(여러 줄 포함) → `alias: "md.sys.color.primary"`. 변환 규칙: `md-(ref|sys|comp)-<rest>` → `md.<layer>.<rest>`.
    - `if($exclude-hardcoded-values, null, X)` → `literal: "X"`.
    - 괄호로 시작하는 복합 값(`'label-large': (…)`)은 건너뛴다.
  - `inferType(key: string, literal: string): TokenType | null`
    - `#hex` → color
    - `Npx`/`Nrem` → dimension
    - 숫자: 키에 `weight`가 있으면 fontWeight, 아니면 number
    - 따옴표 문자열 또는 typeface 파일의 식별자 → fontFamily
    - 나머지 → null(건너뛰고 stderr에 보고)
  - `convert(files: Record<string, string>): { outputs: Record<string, object>; skipped: string[] }`
    - 출력 파일과 대응 SCSS:

      | 출력 | SCSS |
      |---|---|
      | `ref.tokens.yaml` | `md-ref-palette`, `md-ref-typeface` |
      | `sys-color-light.tokens.yaml` / `sys-color-dark.tokens.yaml` | `md-sys-color`의 values-light / values-dark |
      | `sys.tokens.yaml` | `md-sys-shape`, `md-sys-state`, `md-sys-elevation`, `md-sys-typescale` |
      | `comp.tokens.yaml` | 파일럿 comp 파일 전부 |

    - typescale 합성: 스타일 S마다 `md.sys.typescale.S`(typography)를 만든다.
      - `fontFamily/fontSize/fontWeight/letterSpacing`은 각각 `{…S-font}`, `{…S-size}`, `{…S-weight}`, `{…S-tracking}` alias.
      - `lineHeight` = (S-line-height rem) ÷ (S-size rem). 반올림하지 않는다.
    - 대상이 skipped인 alias도 skipped로 처리한다.
  - CLI: `bun scripts/material-web-tokens.ts <srcDir> <outDir> <sha>`
    - 각 출력 파일 첫 줄: `# generated by scripts/material-web-tokens.ts from material-web@<sha> tokens/versions/v0_192 — do not edit`

- [ ] **Step 1: 원천 내려받기**

```bash
SHA=268681913e0a5cb2130c7d00623874ecc7faa5b5; mkdir -p .cache/material-web
for f in md-ref-palette md-ref-typeface md-sys-color md-sys-shape md-sys-state md-sys-typescale md-sys-elevation \
  md-comp-filled-button md-comp-outlined-button md-comp-text-button md-comp-elevated-button md-comp-filled-tonal-button \
  md-comp-icon-button md-comp-filled-icon-button md-comp-filled-tonal-icon-button md-comp-outlined-icon-button \
  md-comp-checkbox md-comp-filter-chip md-comp-elevated-card md-comp-filled-card md-comp-outlined-card; do
  curl -sfL "https://raw.githubusercontent.com/material-components/material-web/$SHA/tokens/versions/v0_192/_$f.scss" -o ".cache/material-web/_$f.scss" || echo "MISSING $f"; done
```

  - Expected: `MISSING` 출력 없음.
- [ ] **Step 2: 실패하는 테스트 작성** — `test/material-web-tokens.test.ts`

```ts
const scss = `@function values-light($deps: $_default) {
  @return (
    'primary': map.get($deps, 'md-ref-palette', 'primary40'),
    'hover-state-layer-opacity':
      map.get($deps, 'md-sys-state', 'hover-state-layer-opacity'),
    'container-height': if($exclude-hardcoded-values, null, 40px),
    'label-large': (
      'font': map.get($deps, 'md-ref-typeface', 'plain'),
    ),
  );
}`;
test("parseScssTokens", () => {
  expect(parseScssTokens(scss)["values-light"]).toEqual({
    primary: { alias: "md.ref.palette.primary40" },
    "hover-state-layer-opacity": { alias: "md.sys.state.hover-state-layer-opacity" },
    "container-height": { literal: "40px" },
  });
});
test("inferType", () => {
  expect(inferType("primary40", "#6750a4")).toBe("color");
  expect(inferType("label-large-size", "0.875rem")).toBe("dimension");
  expect(inferType("weight-medium", "500")).toBe("fontWeight");
  expect(inferType("disabled-container-opacity", "0.12")).toBe("number");
  expect(inferType("x", "solid")).toBeNull();
});
test("typescale synthesis keeps exact line-height ratio", () => {
  const out = convert({ "_md-sys-typescale.scss": `@function values($deps: $_default, $exclude-hardcoded-values: false) {
  @return (
    'label-large-font': map.get($deps, 'md-ref-typeface', 'plain'),
    'label-large-line-height': if($exclude-hardcoded-values, null, 1.25rem),
    'label-large-size': if($exclude-hardcoded-values, null, 0.875rem),
    'label-large-tracking': if($exclude-hardcoded-values, null, 0.00625rem),
    'label-large-weight': map.get($deps, 'md-ref-typeface', 'weight-medium'),
  );
}` }).outputs["sys.tokens.yaml"] as any;
  const t = out.md.sys.typescale["label-large"];
  expect(t.$type).toBe("typography");
  expect(t.$value.fontSize).toBe("{md.sys.typescale.label-large-size}");
  expect(t.$value.lineHeight).toBeCloseTo(1.25 / 0.875, 10);
});
```

- [ ] **Step 3: 실패 확인**
  - Run: `bun test test/material-web-tokens.test.ts`
  - Expected: FAIL
- [ ] **Step 4: 구현 후 생성**
  - Run: `bun scripts/material-web-tokens.ts .cache/material-web examples/material3/tokens 268681913e0a5cb2130c7d00623874ecc7faa5b5`
  - Expected: skipped 목록이 출력됨. 목록을 검토하고, 파일럿에 필요한 토큰이 빠졌으면 `inferType`을 보강한다.
- [ ] **Step 5: 직접 작성하는 파일**
  - **`elevation.tokens.yaml`**: group `md.sys.elevation-shadow`, 토큰 `level0`~`level5`(shadow 배열 2개).
    - 출처: material-web `elevation/internal/_elevation.scss`
    - key 그림자: `{color: {colorSpace: srgb, components: [0,0,0], alpha: 0.3}, offsetX: 0px, offsetY: Y, blur: B, spread: 0px}`
    - ambient 그림자: alpha 0.15, offsetY/blur/spread는 아래 표.

      | level | key Y/B | ambient Y/B/S |
      |---|---|---|
      | 1 | 1/2 | 1/3/1 |
      | 2 | 1/2 | 2/6/2 |
      | 3 | 1/3 | 4/8/3 |
      | 4 | 2/3 | 6/10/4 |
      | 5 | 4/4 | 8/12/6 |

    - level0은 모든 값이 0.
  - **`material3.resolver.yaml`**: sets `ref`(ref), `sys`(sys + elevation), `comp`(comp). modifier `theme`: light/dark, default light.
  - **`openui.yaml`**: `info.title: Material 3 (material-web v0.192)`, `components: ["components/*.yaml"]`, `checklists: ["checklists/*.yaml"]`.
  - **아이콘 4종**(Material Icons 24px, Apache-2.0):
    - 구조: root frame 24×24 `direction: none`, vector part `width: fill, height: fill`, `fill: "{md.sys.color.on-surface}"`.
    - path는 `google/material-design-icons`의 `src/*/<name>/materialicons/24px.svg`에서 복사한다.
    - `add`: `M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z`
    - `check`: `M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z`
    - `remove`: `M19 13H5v-2h14v2z`
    - `star`: 원본 파일에서 복사.
- [ ] **Step 6: 검증**
  - Run: `bun test && bun src/cli.ts validate examples/material3`
  - Expected: PASS, `ok: <N> tokens, 4 components`
- [ ] **Step 7: Commit**

```bash
git add scripts/material-web-tokens.ts test/material-web-tokens.test.ts examples/material3 .gitignore
git commit -m "feat(material3): material-web v0.192 tokens → DTCG, elevation shadows, icons"
```

---

### Task 8: Button + Icon button YAML + 체크리스트

**Files:**
- Create: `examples/material3/components/{button,icon-button}.yaml`
- Create: `examples/material3/checklists/{button,icon-button}.yaml`

**Interfaces:**
- Consumes: Task 7 토큰과 아이콘. 스타일 값은 **comp 토큰**을 참조하고, 체크리스트 기대값은 **sys 토큰 또는 리터럴**로 쓴다.
- **button.yaml 구조(고정)**:
  - variants:
    - `style: [filled, outlined, text, elevated, tonal]`. 각각 comp 파일 `filled-button`, `outlined-button`, `text-button`, `elevated-button`, `filled-tonal-button`에 대응.
    - `withIcon: ["false", "true"]`
  - states: `[enabled, hovered, focused, pressed, disabled]`
  - props: `label`(text, `Button`), `icon`(instance, default `icon-add`, preferred `[icon-add, icon-star]`)
  - anatomy:
    - `root` frame row, align center/center, height = container-height, cornerRadius = container-shape
    - `stateLayer` frame(첫 자식, `position: absolute`, width/height fill, cornerRadius = container-shape)
    - `icon` instance(`prop: icon`, 크기 = `with-icon-icon-size`)
    - `label` text
  - 패딩: 기본 `[0, 24px]`. `withIcon=true`면 leading 16px(`padding: [0, 24px, 0, 16px]`, comp 토큰이 있으면 그 토큰 사용), `withIcon=false`면 icon `visible: false`.
  - state 매핑:
    - hovered/focused/pressed: stateLayer `fill` = `<state>-state-layer-color`, `opacity` = `<state>-state-layer-opacity`
    - enabled: stateLayer `opacity: 0`
    - disabled: root `fill` = disabled-container-color, `fillOpacity` = disabled-container-opacity. label `color` = disabled-label-text-color, `opacity` = disabled-label-text-opacity.
  - elevated: 상태별 `container-elevation`이 가리키는 level에 맞춰 `shadow: "{md.sys.elevation-shadow.levelN}"`. filled의 hovered도 같은 방식.
- **icon-button.yaml 구조(고정)**:
  - variants `style: [standard, filled, tonal, outlined]`. comp 파일 `icon-button`, `filled-icon-button`, `filled-tonal-icon-button`, `outlined-icon-button`.
  - states 동일.
  - props: `icon`(instance, default `icon-star`)
  - anatomy: root 40×40 frame, stateLayer(absolute fill), icon 24px.
- **체크리스트 커버리지 규칙**(두 파일 모두):
  - variant 값마다 자동 항목이 1개 이상.
  - state마다 자동 항목이 1개 이상.
  - mode를 생략해 light/dark 둘 다 검사.
  - 수동 항목 4개: 포커스 링(3dp secondary, offset 2dp — 미구현이므로 "미표현 확인"), 리플, 터치 타깃 48dp, 긴 라벨 처리(icon-button은 툴팁).
  - `source`에 `material-web@268681913e0a tokens/versions/v0_192/_md-comp-<name>.scss`.
  - button 체크리스트의 시작 항목(그대로 포함):

```yaml
  - { id: height, title: "컨테이너 높이 40dp", check: { part: root, property: height, expect: 40px } }
  - { id: shape, title: "모서리 corner-full", check: { part: root, property: border-top-left-radius, expect: "{md.sys.shape.corner-full}" } }
  - { id: filled-container, title: "Filled 컨테이너 = primary", check: { variant: { style: filled }, state: [enabled, hovered, focused, pressed], part: root, property: background-color, expect: "{md.sys.color.primary}" } }
  - { id: filled-label, title: "Filled 라벨 = on-primary", check: { variant: { style: filled }, state: enabled, part: label, property: color, expect: "{md.sys.color.on-primary}" } }
  - { id: tonal-container, title: "Tonal 컨테이너 = secondary-container", check: { variant: { style: tonal }, state: enabled, part: root, property: background-color, expect: "{md.sys.color.secondary-container}" } }
  - { id: outlined-outline, title: "Outlined 1dp outline", check: { variant: { style: outlined }, state: enabled, part: root, property: box-shadow, expect: "inset 0 0 0 1px {md.sys.color.outline}" } }
  - { id: text-transparent, title: "Text 컨테이너 없음", check: { variant: { style: text }, state: enabled, part: root, property: background-color, expect: transparent } }
  - { id: label-size, title: "라벨 label-large 크기", check: { part: label, property: font-size, expect: "{md.sys.typescale.label-large-size}" } }
  - { id: label-line-height, title: "라벨 line-height 20dp", check: { part: label, property: line-height, expect: 20px } }
  - { id: disabled-container, title: "Disabled 컨테이너 on-surface 12%", check: { variant: { style: [filled, tonal, elevated] }, state: disabled, part: root, property: background-color, expect: "color-mix(in srgb, {md.sys.color.on-surface} 12%, transparent)" } }
  - { id: disabled-label, title: "Disabled 라벨 38%", check: { state: disabled, part: label, property: opacity, expect: 0.38 } }
  - { id: hover-layer, title: "Hover state layer 8%", check: { state: hovered, part: stateLayer, property: opacity, expect: "{md.sys.state.hover-state-layer-opacity}" } }
  - { id: pressed-layer, title: "Pressed state layer 10%", check: { state: pressed, part: stateLayer, property: opacity, expect: "{md.sys.state.pressed-state-layer-opacity}" } }
  - { id: with-icon-padding, title: "아이콘 있으면 leading 16dp", check: { variant: { withIcon: "true" }, part: root, property: padding-left, expect: 16px } }
  - { id: icon-size, title: "아이콘 18dp", check: { variant: { withIcon: "true" }, part: icon, property: width, expect: 18px } }
```

  - 위 항목 중 v0.192 comp 토큰 값과 다른 것이 있으면(예: outlined outline 색) **토큰 값을 따르고**, 바꾼 이유를 항목 `title`에 적는다.

- [ ] **Step 1: 컴포넌트 2종 작성** → `bun src/cli.ts validate examples/material3`가 `ok:`.
- [ ] **Step 2: 체크리스트 2종 작성** → 같은 명령이 `ok:`.
- [ ] **Step 3: 브라우저 확인**
  - `bun editor/server.ts examples/material3` 실행, `/browse`로 `await window.__openui.runAll()`을 호출.
  - Expected: `button`, `icon-button` 자동 항목이 모두 `pass: true`.
  - 실패가 있으면 원인(YAML / 렌더러 / 체크리스트 기대값)을 가려 수정한다. 렌더러 버그면 Task 2 테스트에 재현 케이스를 추가한 뒤 고친다.
- [ ] **Step 4: Commit**

```bash
git add examples/material3
git commit -m "feat(material3): button and icon-button specs with checklists"
```

---

### Task 9: Checkbox + Filter chip + Card YAML + 체크리스트

**Files:**
- Create: `examples/material3/components/{checkbox,filter-chip,card}.yaml`
- Create: `examples/material3/checklists/{checkbox,filter-chip,card}.yaml`

**Interfaces:**
- Consumes: Task 7·8과 같은 규칙(스타일은 comp 토큰, 체크리스트는 sys 토큰/리터럴, 커버리지 규칙 동일).
- **checkbox.yaml(고정)**:
  - variants: `type: [unselected, selected, indeterminate]`, `error: ["false", "true"]`
  - states 5종
  - anatomy:
    - `root` 40×40 frame(direction none)
    - `stateLayer`(absolute fill, `cornerRadius: 9999px` 원형)
    - `container` 18×18(x/y 11px 중앙, `cornerRadius` = container-shape)
    - `check`(instance `icon-check`), `dash`(instance `icon-remove`). 크기 18. `type`에 따라 `visible`.
  - unselected는 outline(`strokeWidth` = unselected-outline-width, `strokeColor` = unselected-outline-color), selected/indeterminate는 container `fill` = selected-container-color.
  - error=true는 `error-*` 토큰으로 덮어쓴다.
- **filter-chip.yaml(고정)**:
  - variants: `selected: ["false", "true"]`
  - states 5종
  - props: `label`(text, `Filter`)
  - anatomy:
    - root row, height = container-height(32), cornerRadius = container-shape
    - stateLayer
    - `leading`(instance `icon-check`, 18px, `selected=true`일 때만 visible)
    - label
  - unselected는 outline, selected는 `selected-container-color` 배경. padding은 comp 토큰을 따른다(leading 유무에 따라 다름).
- **card.yaml(고정)**:
  - variants: `style: [elevated, filled, outlined]`(comp `elevated-card`, `filled-card`, `outlined-card`)
  - states: `[enabled, hovered, focused, pressed, disabled]`
  - props: `content`(slot, `min: 1`)
  - anatomy:
    - root column, padding 16px, `width: 360px`, cornerRadius = container-shape(corner-medium)
    - stateLayer
    - `body`(slot, `prop: content`, `width: fill`)
  - elevated는 level1 그림자, outlined는 outline.
- 체크리스트별 필수 항목(커버리지 규칙에 추가로):
  - checkbox: selected 컨테이너 = primary, unselected outline 2dp on-surface-variant, error selected = error, state layer 40×40 원형(`border-top-left-radius: 9999px`), 수동: 체크 애니메이션
  - filter-chip: 높이 32dp, selected 배경 = secondary-container, unselected outline = outline(1dp), selected일 때만 leading 표시(`display`), 수동: 긴 라벨
  - card: corner-medium 12dp, elevated 배경 = surface-container-low, filled = surface-container-highest, outlined outline = outline-variant, 수동: slot에 실제 콘텐츠를 넣었을 때 레이아웃

- [ ] **Step 1: 컴포넌트 3종 작성** → `bun src/cli.ts validate examples/material3`가 `ok:`.
- [ ] **Step 2: 체크리스트 3종 작성** → `ok:`.
- [ ] **Step 3: 브라우저 확인** — `/browse`로 `await window.__openui.runAll()`
  - Expected: 5개 컴포넌트 자동 항목이 모두 `pass: true`. 실패 처리 규칙은 Task 8과 같다.
- [ ] **Step 4: Commit**

```bash
git add examples/material3
git commit -m "feat(material3): checkbox, filter-chip and card specs with checklists"
```

---

### Task 10: 최종 검증 + 스펙 문서 갱신

**Files:**
- Modify: `spec/openui-spec.md`
  - `## 8. 체크리스트` 추가(§K)
  - `## 부록 C. 웹(CSS) 매핑` 추가(§W)
  - `## 부록 B. 미해결 과제`에 Task 8·9에서 발견한 공백 추가
- Modify: `README.md` (에디터 실행법 3줄: `bun install`, `bun editor/server.ts examples/material3`, 열 주소)

- [ ] **Step 1: 전체 회귀**
  - Run: `bun test && bun src/cli.ts validate examples/conformance && bun src/cli.ts validate examples/material3`
  - Expected: PASS / `ok:` / `ok:`
- [ ] **Step 2: E2E** — `/browse`로 `http://127.0.0.1:4173`(material3)을 연다.
  - `runAll()` 결과에서 자동 실패 0건.
  - 5개 컴포넌트 각각 light/dark 그리드 스크린샷을 저장한다.
- [ ] **Step 3: 스펙 문서 갱신** — 위 Files 항목대로.
- [ ] **Step 4: Commit**

```bash
git add spec README.md
git commit -m "docs(spec): checklist spec and web mapping appendix"
```

- [ ] **Step 5: 사용자에게 수동 항목 확인 요청**
  - 컴포넌트별 수동 항목 목록과 스크린샷 경로를 전달한다.
