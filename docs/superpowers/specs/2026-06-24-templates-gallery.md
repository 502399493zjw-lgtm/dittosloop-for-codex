# 开发任务：模版库 → 一键在新 Codex 会话里建 Loop

> Historical note: this spec predates the session-first dynamic workflow design in `2026-06-25-session-first-dynamic-workflow-design.md`. Treat its template-gallery UI ideas as historical context only; workflow launch and runtime semantics now come from the 2026-06-25 session-first spec.

> 给 Codex 新会话的实现说明。读完照做即可。本仓库是 `DittosLoop For Codex` 插件源码（local-first：skill + 本地 MCP runtime + 本地 preview）。

## 0. 你要改的代码在哪（先读这些，照它们的风格写）

插件根：`plugins/dittosloop-for-codex/`

- `preview/{index.html, app.js, styles.css}` — 本地预览 UI（**纯原生 JS，无框架**；用文件里现成的 `el()` / `button()` / `inlineIcon()` 辅助函数建 DOM，别引入框架）。
- `mcp/src/previewServer.ts` — 本地 HTTP server（默认 `127.0.0.1:47888`）。路由用 `url.pathname.match(...)` 块，在 `sendStaticFile(...)` 之前依次匹配；JSON 用 `sendJson()`，读 body 用 `readJsonBody()`。已有路由：`GET /api/snapshot`、`GET /api/runs/:id`、`POST /api/runs/:id/codex-thread`、`POST /api/loops/:id/codex-session`。
- `mcp/src/service.ts`（`LoopService`）、`mcp/src/store.ts`、`mcp/src/index.ts` — runtime 装配（`startPreviewServer` 在 index.ts 里构造，`staticDir` 也在那里给）。**动手前读 `index.ts` 看 `startPreviewServer` 怎么构造、staticDir 从哪来。**
- `skills/loop/SKILL.md` — loop 创建工作流。Loop 由 MCP 工具 **`create_loop`** 建，契约就 4 项：`Title / Intent / Trigger(MVP 固定 manual) / Verification checks[]`。
- `mcp/test/previewServer.test.ts` — 路由测试范式，照它加测试。
- 状态形状参考 `examples/state.sample.json`。

**重要区分（别搞混）**：现有 `POST /api/loops/:id/codex-session`（app.js 里 `startCodexSession`）是"给已存在的 loop 在当前会话起一个 run"。**本任务方向相反**：从模版**新开一个 codex 会话去创建一条新 loop**。两者独立，别复用那条路由。

## 1. 目标（一句话）

preview 里展示一组**固定模版**；点某模版的「用此模版」→ previewServer **起一个新的 `codex "<buildPrompt>"` 交互会话** → 那个会话（已装 DittosLoop skill + MCP）按 `buildPrompt` 调 `create_loop` 把这条 loop 建出来 → 回到 preview 点刷新就能看到。无自动发现、无匹配，纯静态清单。

## 2. 交付物（改动清单）

1. **新数据文件** `plugins/dittosloop-for-codex/templates/templates.json`（静态，先放下面给的 3 条 + 你再补到 ~8–10 条，来源见 §3 备注）。
2. **previewServer.ts** 加两条路由（风格照现有 match 块）：
   - `GET /api/templates` → 读 `templates.json` 返回数组（去掉 `buildPrompt` 也行，但简单起见可整条返回）。
   - `POST /api/templates/:id/launch` → 取该模版 `buildPrompt`，**spawn 一个新的 codex 交互会话**，返回 `{ launched: true }`。
3. **app.js** 加模版区渲染：`fetch('/api/templates')` → 渲染卡片网格 → 每卡「用此模版」按钮 POST launch。复用 `el()/button()/inlineIcon()`、可复用 `renderProjectPicker`/`projectChoices` 拿项目路径当 cwd。
4. **index.html / styles.css** 加模版区容器与样式（沿用现有 class 命名与中文文案风格）。
5. **测试**：照 `mcp/test/previewServer.test.ts` 加 `GET /api/templates` 与 `POST /api/templates/:id/launch` 测试（launch 把 spawn 注入成可 mock 的依赖，断言用对的 prompt 调用了，不真的开终端）。
6. `npm run check` 全绿（build + validate + test + mcp test）。

## 3. `templates.json` schema + 种子

每条：

```json
{
  "id": "tests-green",
  "title": "测试修绿",
  "category": "engineering",
  "desc": "把测试一路修到全过、lint 干净",
  "trigger": "手动",
  "checks": ["全部测试通过", "lint 无错误", "未引入新的跳过/忽略用例"],
  "buildPrompt": "请用 DittosLoop For Codex 创建一个 loop。Title: 测试修绿。Intent: 反复运行测试与 lint，修复失败，直到全部测试通过且 lint 干净。Trigger: manual。Verification checks: (1) 全部测试通过 (2) lint 无错误 (3) 未引入新的跳过/忽略用例。请调用 create_loop 创建该 loop；创建后调用 get_preview_url 打开预览，并把 loopId 告诉我。若信息不全，只追问安全关键的缺项。"
}
```

种子再给两条（其余你按这形状补）：

```json
{
  "id": "log-patrol",
  "title": "日志巡逻",
  "category": "engineering",
  "desc": "定时翻运行日志、揪 bug、能修的提 PR、疑难留你拍板",
  "trigger": "手动（后续可改每天 21:00）",
  "checks": ["每个被巡服务都查过或标注不可用", "每个上报 bug 附最小复现", "提的 PR 过本地测试", "改线上/付费等红线动作前停下问我"],
  "buildPrompt": "请用 DittosLoop For Codex 创建一个 loop。Title: 日志巡逻。Intent: 定时翻查运行日志，定位 bug，能修的提 PR，疑难留我拍板。Trigger: manual。Verification checks: (1) 每个被巡服务都查过或标注不可用 (2) 每个上报 bug 附最小复现 (3) 提的 PR 过本地测试 (4) 改线上/付费等红线动作前停下问我。请调用 create_loop 创建；创建后用 get_preview_url 打开预览并告诉我 loopId。"
}
```

```json
{
  "id": "pr-babysitter",
  "title": "PR 看护",
  "category": "operations",
  "desc": "盯一批打标 PR：修 CI、落后就 rebase、卡评审就提醒",
  "trigger": "手动",
  "checks": ["每个目标 PR 都已检查 CI 状态", "失败的 CI 已尝试修复或记录原因", "落后 main 的已 rebase 或标注冲突", "需要人工评审的已点名提醒"],
  "buildPrompt": "请用 DittosLoop For Codex 创建一个 loop。Title: PR 看护。Intent: 盯住一批指定 PR，保持健康：修 CI 失败、落后 main 就 rebase、评审待处理就提醒。Trigger: manual。Verification checks: (1) 每个目标 PR 都已检查 CI 状态 (2) 失败的 CI 已尝试修复或记录原因 (3) 落后 main 的已 rebase 或标注冲突 (4) 需要人工评审的已点名提醒。请调用 create_loop 创建；创建后用 get_preview_url 打开预览并告诉我 loopId。"
}
```

> 备注（内容来源，导入时去重，每条按上面形状写一个 buildPrompt）：
> - `https://raw.githubusercontent.com/serenakeyitan/awesome-agent-loops/main/README.md`（`/loop /goal /schedule` 命令族 21 条）
> - `https://signals.forwardfuture.ai/loop-library/catalog.json`（loop-library，字段 `prompt/verifyTitle/useWhen/category`，直接映射成 `desc/checks/buildPrompt`）

## 4. `buildPrompt` 规范

- **自包含**：新 codex 会话已装 DittosLoop skill（见 `skills/loop/SKILL.md` 的 Workflow 与 Tool Map），prompt 只需用自然语言把契约 4 项说清并要求调 `create_loop`。
- 必含：`Title / Intent / Trigger: manual / Verification checks（逐条编号）`，结尾要求"创建后 `get_preview_url` 打开预览并回报 loopId；信息不全只追问安全关键缺项"。
- 对齐 SKILL 的 *Contract Shape* 与 *Common Mistakes*（**不要建没有验证检查的 loop**）。

## 5. previewServer 路由实现要点

- 在 `sendStaticFile(...)` 调用**之前**，加两个 `url.pathname.match` 块，与现有 `/api/loops/:id/codex-session` 块同构。
- 模版数据：给 `PreviewServerOptions` 加 `templatesFile?: string`，默认指向 `plugins/dittosloop-for-codex/templates/templates.json`；在 `index.ts` 构造 `startPreviewServer` 时传入（与 `staticDir` 同源解析）。`GET /api/templates` 用 `readFile` 读它、`JSON.parse` 后 `sendJson`。
- **launch（关键）**：`codex` 交互式需要 TTY，Node 直接 `spawn('codex', [...])` 没有终端。因此 **macOS 用 `osascript` 打开 Terminal 跑 `codex "<buildPrompt>"`**：

  ```ts
  // 伪代码：把 spawn 设计成可注入依赖（默认 child_process.spawn），方便测试 mock
  const escaped = buildPrompt
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');           // 给 shell 双引号用
  const cwd = body.projectPath || process.cwd();
  const shellCmd = `cd ${shellQuote(cwd)} && codex "${escaped}"`;
  const osa = `tell application "Terminal" to do script ${asAppleScriptString(shellCmd)}`;
  spawn("osascript", ["-e", osa], { detached: true, stdio: "ignore" }).unref();
  ```
  - `asAppleScriptString` / `shellQuote`：注意 AppleScript 字符串里的 `"` 和 `\` 都要转义；自己实现两个小函数并加单测。
  - 返回 `200 { launched: true }`。失败按现有 catch 风格返回 500。
- **跨平台降级**：非 macOS（`process.platform !== "darwin"`）时不开终端，改为在响应里回 `{ launched: false, prompt: buildPrompt }`，前端提示"复制此 prompt 到 Codex 手动发送"。MVP 只需保证 macOS 路径可用 + 其它平台不崩。

## 6. app.js / index.html UI 要点

- `index.html` 在 loops 列表上方加一个容器，如 `<section id="templates">`。
- app.js 加 `renderTemplates()`：`fetch('/api/templates')` → 用 `el()` 渲染卡片网格；每卡含 title/desc、`trigger`、`checks`（小列表）、一个 `button(..., () => useTemplate(t))` 文案「用此模版」。在 `loadSnapshot()` 成功后调用一次即可（模版是静态的，不必每次刷新重拉，但简单起见可随刷新一起拉）。
- `useTemplate(t)`：可选地用现有 `projectChoices(currentSnapshot)` / `renderProjectPicker` 让用户选项目，拿到 `projectPath`；`POST /api/templates/${id}/launch` body `{ projectPath }`；成功提示"已在新的 Codex 会话中打开，建好后点刷新"，失败走 `renderError`。
- 文案中文、风格对齐现有；不引第三方库。

## 7. 约束与验收

**约束**
- 不破坏现有路由/渲染；preview 保持纯原生 JS。
- TS 侧保持 `mypy/strict` 等价的现有 tsconfig 严格度；过 lint。
- local-first，全程不联网（除用户自己后续在 codex 里联网）。
- 不做隐藏后台自动化（符合 SKILL 的 MVP 原则：loop 工作要可见、显式、可检查）。开终端是**可见**的，符合这条。

**验收（DoD）**
1. preview 顶部出现模版区，列出 `templates.json` 的模版。
2. 点「用此模版」→ macOS 弹出一个新 Terminal、运行 `codex "<buildPrompt>"`，首条消息即该模版 prompt。
3. 该会话据此调 `create_loop` 建出 loop（title/intent/manual/checks 正确）。
4. 回到 preview 点刷新，新 loop 出现在列表里。
5. `npm run check` 全绿（含新加测试）。

**一个已定的决定**：默认**交互式**（`codex "<prompt>"`，用户能看见并对话/确认），不用 `codex exec` 静默直建——契合"loop 工作要可见"。若 macOS 之外，走 §5 的复制降级。

## 8. 建议提交粒度

1. `feat(preview): add templates.json + GET /api/templates`
2. `feat(preview): POST /api/templates/:id/launch spawns codex session (osascript)`
3. `feat(preview): templates gallery UI + use-template flow`
4. `test(preview): templates routes + osascript escaping`

每步后跑一次 `npm run check`。
