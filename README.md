# DittosLoop For Codex

[中文说明](#中文说明) | [English](#english)

## 中文说明

`DittosLoop For Codex` 是一个 local-first 的 Codex 插件，用来把委托给 Codex 的工作变成可见、可检查、可继续的 Dittos loop。它包含一个 skill、本地 MCP runtime、基于 JSON 的 loop 状态、提醒 hook，以及用于查看 loop contracts、runs、verification、human requests、memory 和 artifacts 的浏览器预览界面。

这个仓库按 GitHub-ready 的 Codex plugin marketplace source 来组织。当前首个可运行里程碑是本地安装和本地预览。

插件拥有自己的正式 Live Loop runtime。它把主 Dittos Loop 引擎中的核心概念复制到本仓库内，而不是在运行时依赖主 Dittos Loop 项目。结构化 contract 可以定义 workflow body、verification rubrics、repair policy、stop policy 和 Codex project binding；由引擎驱动的 run 会通过插件本地引擎执行 workflow，并把 engine events 暴露给预览界面。

### 快速安装

添加公开 GitHub marketplace source：

```bash
codex plugin marketplace add 502399493zjw-lgtm/dittosloop-for-codex --ref main
```

然后打开 Codex 插件设置，从 `DittosLoop` marketplace 安装 `DittosLoop For Codex`。

安装或更新插件后，重启 Codex 并开启一个新线程，让内置 skill 和 MCP runtime 重新加载。

### 快速更新

如果已经从这个 GitHub marketplace source 安装过插件，刷新 marketplace：

```bash
codex plugin marketplace upgrade dittosloop
```

然后重启 Codex 或开启一个新线程。Codex 对已安装的 Git-backed marketplace 插件不一定显示单独的 update button；对 Git-backed 安装来说，刷新 marketplace source 就是更新路径。

维护者在发布新的 marketplace 版本前，应先更新 `plugins/dittosloop-for-codex/.codex-plugin/plugin.json`，因为 Codex 会按 plugin manifest version 安装和缓存 Git-backed 插件。

如果添加 marketplace 时用了别的名称，把命令里的 `dittosloop` 替换成你配置的 marketplace 名称。

### 快速检查

在仓库根目录运行：

```bash
npm --prefix plugins/dittosloop-for-codex/mcp install
npm run check
```

`npm run check` 会构建 MCP runtime、运行仓库校验器，并执行 runtime 测试。

### 包含内容

- `plugins/dittosloop-for-codex/.codex-plugin/plugin.json`：Codex 插件 manifest
- `.agents/plugins/marketplace.json`：本仓库的 marketplace entry
- `plugins/dittosloop-for-codex/skills/loop/SKILL.md`：安装后的 loop workflow
- `plugins/dittosloop-for-codex/mcp`：TypeScript MCP runtime
- `plugins/dittosloop-for-codex/hooks`：用于提示 loopable work 的提醒 hook
- `plugins/dittosloop-for-codex/preview`：本地预览 UI
- `scripts/validate-plugin.mjs`：本地 plugin/package 校验器
- `examples/state.sample.json`：可直接用于预览的 sample loop state

### Hook 行为

插件包含一个轻量的 `loopable-reminder` hook。它可以提醒 Codex：某些 recurring、stateful、periodically verifiable 或 future-handoff 的工作，可能适合变成 loop。

Hooks 不是 source of truth。它们不会静默创建、调度、持久化或运行 loops。核心的 loop contracts、runs、attempts、verification、memory、human requests 和 artifacts 都由 MCP runtime 管理。

提醒 hook 会把自己的小型 cooldown state 存到仓库外：

```text
~/.codex/dittosloop-for-codex/loopable-reminder-state.json
```

### 本地安装

安装插件前，先构建并校验 runtime：

```bash
npm --prefix plugins/dittosloop-for-codex/mcp install
npm run check
```

把这个仓库添加为 Codex marketplace source：

```bash
codex plugin marketplace add "$(pwd)"
```

然后打开 Codex 插件设置，从 `DittosLoop` marketplace 安装 `DittosLoop For Codex`。

安装或重新安装插件后，重启 Codex 并开启一个新线程，让内置 skill 和 MCP tools 重新加载。如果已有 Git-backed 安装，先用 `codex plugin marketplace upgrade dittosloop` 刷新 source。

### GitHub 安装

克隆共享仓库后：

```bash
cd dittosloop-for-codex
npm --prefix plugins/dittosloop-for-codex/mcp install
npm run check
codex plugin marketplace add "$(pwd)"
```

如果使用公开 GitHub marketplace source，请添加仓库 source，而不是本地路径：

```bash
codex plugin marketplace add 502399493zjw-lgtm/dittosloop-for-codex --ref main
```

Marketplace entry 指向 `./plugins/dittosloop-for-codex`，所以同一套仓库结构既支持本地路径，也支持 GitHub source。

### 运行数据

默认情况下，本地 loop state 存在仓库外：

```text
~/.codex/dittosloop-for-codex/state.json
```

启动 MCP runtime 时可以覆盖数据目录：

```bash
DITTOSLOOP_DATA_DIR="/path/to/data" DITTOSLOOP_PREVIEW_PORT=47888 npm start
```

### 预览

MCP runtime 会启动本地预览：

```text
http://127.0.0.1:47888
```

插件暴露 `get_preview_url`，Codex 可以用它在内置浏览器或右侧预览区域打开同一个页面。

预览界面有三个紧凑面板：loop contracts、recent runs、selected run detail。Run detail 会展示 attempts、workflow runtime state、workflow revision drafts、timeline events、verification results、human requests、memory 和 artifacts，这些都来自本地 JSON state。

对于 session-first workflow runs，`/api/runs/:id` 还会包含 `workflowContexts`、`workflowRevisions`、`engineEvents`，以及从 runtime events 派生出的分组 `timeline`。旧 record 字段会保留，以便现有 preview code 和 compatibility workflows 继续工作。

不安装插件也可以预览 sample state：

```bash
npm run build
tmpdir="$(mktemp -d)"
cp examples/state.sample.json "$tmpdir/state.json"
DITTOSLOOP_DATA_DIR="$tmpdir" DITTOSLOOP_PREVIEW_PORT=47888 \
  npm --prefix plugins/dittosloop-for-codex/mcp start
```

打开 `http://127.0.0.1:47888`，选择 `Release Readiness Loop`。

### Run Detail 流程

1. `create_loop_contract` 在 loop 需要 structured workflow body、rubrics、repair policy 和 stop policy 时创建正式 contract。
2. `start_codex_session` 是用户可见的入口。它会创建 run、启动第一个 attempt、记录 Codex session request，并返回给 host app 使用的 launch prompt/request。
3. `record_codex_thread` 在 host 创建真实 Codex App thread 后建立关联。这是 run/thread 的顶层绑定，不是每个 task 的 workflow result writeback。
4. `execute_workflow_attempt` 会在这个可见 session 内运行正式 workflow。由 Codex 执行的 workflow steps 可以请求本地 Codex tasks，并在等待精确结果时暂停。
5. `record_session_result` 会把结果写回指定的 `workflowContextId`、`attemptId`、`sessionId`、`taskRunId` 或 `stepId`。如果同时提供多个 task locator，它们必须指向同一个 task run。恢复执行时会复用已完成的 workflow steps；`needs_human` 会暂停 context，不缓存 completed task result，并在可能时打开一个关联 human request。
6. `propose_workflow_revision`、`promote_workflow_revision` 和 `reject_workflow_revision` 让可见 session 可以编辑本地 workflow contract 并保留 revision history。每次写入都需要当前 `runId` 和 `attemptId`。
7. `record_verification` 可以把 verifier results 关联到 `attemptId`；当 verification 失败且 `repair: true` 时，run 和 workflow context 会进入 `repairing`。
8. `record_human_request` 会在工作暂停时保留用户决策。
9. `resolve_human_request` 会用用户回复关闭决策请求。如果 request 属于一个 suspended workflow task，回复会作为该 task result 写回，并继续 workflow。
10. `commit_memory` 存储持久化经验或偏好。
11. `add_artifact` 引用有用的本地文件、preview URLs、reports 或 outputs。
12. `complete_run` 在验证完成或出现明确 blocker 后关闭 run。
13. `get_run_detail` 返回预览界面展示的组合视图。

Legacy compatibility flow：

旧 JSON state 仍会加载并迁移。新的用户可见 runs 应使用 `start_codex_session`。

当前 workflow task sessions 只支持省略 `sessionPolicy` 或设置 `sessionPolicy: "new"`。Reuse policies 预留给未来版本。`subagent` specs，包括工具和权限提示，会被存储、显示在预览中，并传给 Codex host bridge；DittosLoop 本身不会强制执行 tool allowlists。

### MCP Tools

- `create_loop_contract`
- `list_loops`
- `pause_loop`
- `resume_loop`
- `approve_runtime_script`
- `start_codex_session`
- `execute_workflow_attempt`
- `propose_workflow_revision`
- `list_workflow_revisions`
- `promote_workflow_revision`
- `reject_workflow_revision`
- `record_codex_thread`
- `record_session_result`
- `record_validator_result`
- `open_codex_session`
- `start_attempt`
- `complete_attempt`
- `append_event`
- `record_verification`
- `record_human_request`
- `resolve_human_request`
- `read_loop_memory`
- `commit_memory`
- `add_artifact`
- `mark_run_repairing`
- `complete_run`
- `get_run_detail`
- `get_snapshot`
- `get_preview_url`

### 开发

日常检查使用仓库级命令：

```bash
npm test
npm run validate
npm run check
```

快速本地迭代插件时，可以把构建好的插件同步到 Codex plugin cache：

```bash
npm run dev:local
```

这个命令会先运行仓库测试、MCP 测试、build 和 plugin validation，然后把 `plugins/dittosloop-for-codex` 复制到当前 manifest version 对应的本地 Codex plugin cache。使用 `npm run dev:local -- --dry-run` 可以只打印 cache path 和检查步骤，不复制文件。

也可以直接运行 MCP package：

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test
npm --prefix plugins/dittosloop-for-codex/mcp run build
```

当 manifest metadata 或 MCP tools 发生变化时，需要重新 build，运行 `npm run check`，从 marketplace 重新安装或刷新插件，重启 Codex，并在新线程里测试。

仓库 packages 标记为 `private`，避免误发到 npm。推荐分发路径是这个 Git-backed Codex plugin marketplace repo。

### 分享

用于 GitHub 分享时，保留 marketplace 文件 `.agents/plugins/marketplace.json`，插件放在 `plugins/dittosloop-for-codex`。用户可以把克隆下来的仓库添加为 marketplace source，构建 runtime，运行 `npm run check`，然后从 Codex 安装插件。

这个插件是 local-first 的。它不会上传 runtime state，提交到仓库里的 examples 也只是 sample data。

## English

`DittosLoop For Codex` is a local-first Codex plugin that turns delegated work into visible Dittos loops. It bundles a skill, a local MCP runtime, JSON-backed loop state, reminder hooks, and a browser preview for loop contracts, runs, verification, human requests, memory, and artifacts.

This repo is shaped as a GitHub-ready Codex plugin marketplace source. The first milestone is local install and local preview.

The plugin owns its own formal Live Loop runtime. It copies the main Dittos Loop engine concepts into this repo instead of importing the main Dittos Loop project at runtime. Structured contracts can define a workflow body, verification rubrics, repair policy, stop policy, and Codex project binding; engine-backed runs execute that body through the plugin's local engine and expose engine events to the preview.

## Quick Install

Add the public GitHub marketplace source:

```bash
codex plugin marketplace add 502399493zjw-lgtm/dittosloop-for-codex --ref main
```

Then open Codex plugin settings and install `DittosLoop For Codex` from the `DittosLoop` marketplace.

After installing or updating the plugin, restart Codex and start a new thread so the bundled skill and MCP runtime are loaded fresh.

## Quick Update

If you already installed the plugin from this GitHub marketplace source, refresh the marketplace:

```bash
codex plugin marketplace upgrade dittosloop
```

Then restart Codex or start a new thread. Codex may not show a separate update button for installed marketplace plugins; refreshing the marketplace source is the update path for Git-backed installs.

Maintainers should bump `plugins/dittosloop-for-codex/.codex-plugin/plugin.json`
before publishing a new marketplace release, because Codex installs and caches Git-backed
plugins by the plugin manifest version.

If you added the marketplace with a different name, replace `dittosloop` with that configured marketplace name.

## Quick Check

From the repo root:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp install
npm run check
```

`npm run check` builds the MCP runtime, runs the repository validator, and runs the runtime tests.

## What It Includes

- `plugins/dittosloop-for-codex/.codex-plugin/plugin.json`: Codex plugin manifest
- `.agents/plugins/marketplace.json`: marketplace entry for this repo
- `plugins/dittosloop-for-codex/skills/loop/SKILL.md`: installed loop workflow
- `plugins/dittosloop-for-codex/mcp`: TypeScript MCP runtime
- `plugins/dittosloop-for-codex/hooks`: reminder hooks for loopable work
- `plugins/dittosloop-for-codex/preview`: local preview UI
- `scripts/validate-plugin.mjs`: local plugin/package validator
- `examples/state.sample.json`: preview-ready sample loop state

## Hook Behavior

The plugin includes a lightweight `loopable-reminder` hook. It can remind Codex
that recurring, stateful, periodically verifiable, or future-handoff work may be
worth turning into a loop.

Hooks are not the source of truth. They do not create, schedule, persist, or run
loops silently. Core loop contracts, runs, attempts, verification, memory, human
requests, and artifacts are owned by the MCP runtime.

The reminder hook stores its own small cooldown state outside the repo under:

```text
~/.codex/dittosloop-for-codex/loopable-reminder-state.json
```

## Local Setup

Build and validate the runtime before installing the plugin:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp install
npm run check
```

Add this repo as a Codex marketplace source:

```bash
codex plugin marketplace add "$(pwd)"
```

Then open Codex plugin settings and install `DittosLoop For Codex` from the `DittosLoop` marketplace.

After installing or reinstalling the plugin, restart Codex and start a new thread so the bundled skill and MCP tools are loaded fresh. For an existing Git-backed install, refresh the source with `codex plugin marketplace upgrade dittosloop` first.

## GitHub Setup

After cloning a shared copy of this repo:

```bash
cd dittosloop-for-codex
npm --prefix plugins/dittosloop-for-codex/mcp install
npm run check
codex plugin marketplace add "$(pwd)"
```

For the public GitHub marketplace source, add the repo source instead of the local path:

```bash
codex plugin marketplace add 502399493zjw-lgtm/dittosloop-for-codex --ref main
```

The marketplace entry points to `./plugins/dittosloop-for-codex`, so the same repository shape works locally and from GitHub.

## Runtime Data

By default, local loop state is stored outside the repo:

```text
~/.codex/dittosloop-for-codex/state.json
```

You can override it when launching the MCP runtime:

```bash
DITTOSLOOP_DATA_DIR="/path/to/data" DITTOSLOOP_PREVIEW_PORT=47888 npm start
```

## Preview

The MCP runtime starts a local preview at:

```text
http://127.0.0.1:47888
```

The plugin exposes `get_preview_url` so Codex can open the same view in the in-app browser or right-side preview surface.

The preview has three compact panels: loop contracts, recent runs, and the selected run detail. Run detail shows attempts, workflow runtime state, workflow revision drafts, timeline events, verification results, human requests, memory, and artifacts from the local JSON state.

For session-first workflow runs, `/api/runs/:id` also includes `workflowContexts`, `workflowRevisions`, `engineEvents`, and a grouped `timeline` derived from runtime events. The old record fields remain in place so existing preview code and compatibility workflows keep working.

To preview the sample state without installing the plugin:

```bash
npm run build
tmpdir="$(mktemp -d)"
cp examples/state.sample.json "$tmpdir/state.json"
DITTOSLOOP_DATA_DIR="$tmpdir" DITTOSLOOP_PREVIEW_PORT=47888 \
  npm --prefix plugins/dittosloop-for-codex/mcp start
```

Open `http://127.0.0.1:47888` and select `Release Readiness Loop`.

## Run Detail Flow

1. `create_loop_contract` creates a formal contract when the loop should have a structured workflow body, rubrics, repair policy, and stop policy.
2. `start_codex_session` is the user-visible entry point. It creates the run, starts the first attempt, records the Codex session request, and returns the launch prompt/request for the host app.
3. `record_codex_thread` links the real Codex App thread once the host creates it. This is a top-level run/thread binding, not per-task workflow result writeback.
4. `execute_workflow_attempt` runs the formal workflow from inside that visible session. Codex-owned workflow steps can request local Codex tasks and suspend while waiting for precise results.
5. `record_session_result` writes back the result for a specific `workflowContextId`, `attemptId`, `sessionId`, `taskRunId`, or `stepId`. If multiple task locators are provided, they must all identify the same task run. Completed workflow steps are reused when execution resumes, while `needs_human` suspends the context without caching a completed task result and opens a linked human request when possible.
6. `propose_workflow_revision`, `promote_workflow_revision`, and `reject_workflow_revision` let the visible session edit the local workflow contract and keep revision history. Each write requires the current `runId` and `attemptId`.
7. `record_verification` can attach verifier results to `attemptId`; failed verification with `repair: true` moves the run and workflow context to `repairing`.
8. `record_human_request` keeps user decisions visible when work pauses.
9. `resolve_human_request` closes a user decision with the response. If the request belongs to a suspended workflow task, the response is written back as that task result and the workflow continues.
10. `commit_memory` stores durable lessons or preferences.
11. `add_artifact` references useful local files, preview URLs, reports, or outputs.
12. `complete_run` closes the run after verification or a clear blocker.
13. `get_run_detail` returns the composed view shown in the preview.

Legacy compatibility flow:

Legacy JSON state still loads and migrates. New user-visible runs should use `start_codex_session`.

Current workflow task sessions only support omitted `sessionPolicy` or `sessionPolicy: "new"`. Reuse policies are reserved for future work. `subagent` specs, including tool and permission hints, are stored, shown in preview, and passed to the Codex host bridge; DittosLoop does not enforce tool allowlists itself.

## MCP Tools

- `create_loop_contract`
- `list_loops`
- `pause_loop`
- `resume_loop`
- `approve_runtime_script`
- `start_codex_session`
- `execute_workflow_attempt`
- `propose_workflow_revision`
- `list_workflow_revisions`
- `promote_workflow_revision`
- `reject_workflow_revision`
- `record_codex_thread`
- `record_session_result`
- `record_validator_result`
- `open_codex_session`
- `start_attempt`
- `complete_attempt`
- `append_event`
- `record_verification`
- `record_human_request`
- `resolve_human_request`
- `read_loop_memory`
- `commit_memory`
- `add_artifact`
- `mark_run_repairing`
- `complete_run`
- `get_run_detail`
- `get_snapshot`
- `get_preview_url`

## Development

Use the repo-level commands for day-to-day checks:

```bash
npm test
npm run validate
npm run check
```

For fast local plugin iteration, sync the built plugin into the Codex plugin cache:

```bash
npm run dev:local
```

This runs the repo tests, MCP tests, build, and plugin validation before copying
`plugins/dittosloop-for-codex` into the local Codex plugin cache for the current
manifest version. Use `npm run dev:local -- --dry-run` to print the exact cache
path and checks without copying files.

The MCP package can still be exercised directly:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test
npm --prefix plugins/dittosloop-for-codex/mcp run build
```

When manifest metadata or MCP tools change, rebuild, run `npm run check`, reinstall or refresh the plugin from the marketplace, restart Codex, and test in a new thread.

The repository packages are marked `private` to prevent accidental npm
publication. The supported distribution path is this Git-backed Codex plugin
marketplace repo.

## Sharing

For GitHub sharing, keep the marketplace file at `.agents/plugins/marketplace.json` and the plugin at `plugins/dittosloop-for-codex`. Users can add the cloned repo as a marketplace source, build the runtime, run `npm run check`, and install the plugin from Codex.

This plugin is local-first. It does not upload runtime state, and committed examples are sample data only.
