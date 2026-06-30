# 创建 Loop

当用户想创建 Dittos loop 或正式 loop 合同时，阅读此文件。

## 创建前方法

调用 `create_loop_contract` 前，交互要轻量、明确：

1. 先复述推断出的 loop 目标、边界、触发方式和预期输出。
2. 对低风险细节使用合理默认值，不要为每个缺失字段都追问。
3. 只对影响安全、权限、成本、破坏性操作、外部副作用、项目绑定或验证的缺失信息追问。
4. 当验证预期重要时，先按 [define-rubric.md](define-rubric.md) 形成 `Rubric Draft`，再回到创建合同。
5. 对明显低风险的 loop，说明推断出的验收要求，然后带着合理默认值继续。对模糊或高影响 loop，先请用户确认或修正验收要求，再创建合同。
6. 如果请求模糊但安全，提出紧凑合同草稿，请用户确认或修正。
7. 把已达成一致或可安全推断的形状转换成正式 loop 合同。

## 创建流程

1. 塑造 loop 合同：标题、目标或意图、手动触发方式、脚本编排方式、runtime script 职责，以及已确认或可安全推断的 verification contract。
2. 用 `workflowKind: "runtime_script"` 加 JavaScript 字符串 `script` 表达 workflow。
3. 每个 loop 都使用 `create_loop_contract`。
4. `create_loop_contract` 成功后，调用 `get_preview_url`，让用户能检查创建出的 loop。
5. Loop 合同应是正式 runtime contract，即使 workflow 很小。
6. 用 `agent()` 表达 Codex worker 工作；每次 worker 调用要有清晰 `label`，需要可预测 resume/cache 时要有稳定 `key`。
7. 用 `args` 放可变输入，用 `limits` 放运行边界。
8. DittosLoop 会记录预期并做 best-effort 本地检查；不要声称它能原生强制 Codex skill 或 tool allowlist。

## 合同形状

第一版正式合同要小而可执行：

```text
Title: 简短职责名
Goal: 这个 loop 负责什么
Workflow: `workflowKind: "runtime_script"` 加 JavaScript 字符串 `script`
Runtime script args: 可选，runtime script 输入 `args`
Runtime script limits: 可选，`limits` 对象；runtime script workflow 默认需要审批
Worker calls: `script` 内的 `agent()`、`parallel()`、`pipeline()` 调用
Verification: 使用 `define-rubric.md` 形成的 criteria、validators、decision policy
Verifier: 使用 `define-rubric.md` 形成的独立 verifier 或其他明确 validator
Repair policy: 验证失败后 retry、ask the user，还是 fail
Stop policy: loop 何时停止
Project binding: 可选 Codex project id、label 和 path
```

动态 workflow script 优先使用下面这种形状：

```json
{
  "workflowKind": "runtime_script",
  "script": "phase(\"review\");\nconst results = await parallel(args.files.map((file) => () => agent(`Review ${file}`, { key: `review:${file}`, label: file })));\nreturn { files: args.files, results };",
  "args": {
    "files": ["src/a.ts", "src/b.ts"]
  },
  "limits": {
    "timeoutMs": 120000,
    "maxAgentCalls": 20,
    "maxParallelBranches": 8,
    "maxPipelineItems": 50,
    "maxLogChars": 20000
  }
}
```

Runtime script 编写规则：

- 使用字符串 `script`，并搭配 `workflowKind: "runtime_script"`。
- 脚本内部使用注入 helpers：`phase()`、`agent()`、`parallel()`、`pipeline()`、`log()` 和 `args`。
- 当 rerun/resume cache 需要可预测时，为 `agent()` 调用提供稳定的 `key`。
- 保持脚本可复现，把可变输入放进 `args`，不要把用户特定状态硬编码进脚本。
- Runtime script 默认需要审批；创建后如果仍是 pending approval，执行前调用 `approve_runtime_script`。

## 脚本编排提示

- 有自然顺序或依赖时，用 `phase()` 标记阶段，按顺序调用 `agent()`，或用 `pipeline()` 串起同类处理。
- 可按来源、模块、对象或领域拆分时，从 `args` 或上游 worker 输出计算 items，再用 `parallel()` 分发并汇总。
- 需要判断、权衡、风险审查或主观质量评估时，用多个 `agent()` 或 `parallel()` 分支收集视角，再用 judge `agent()` 汇总。
- 任务小、低风险且拆分没有收益时，用一个 `agent()`；只有在仍然需要脚本控制流、审批和统一验证时才创建 loop。
- 当 loop 需要 JavaScript 控制流、条件分支、迭代计划、动态 fan-out、可复用脚本编排，或基于 journal 的 resume/cache 语义时，直接把这些逻辑写进 runtime script。

创建正式 loop 后，最终回复要说明创建出的 `loopId`、来自 `get_preview_url` 的本地 DittosLoop 看板 URL、script 编排方式、script 职责、验证 criteria、validators、decision policy、repair/stop policy，以及 script approval 是 required 还是已经 granted。

如果 `get_preview_url` 失败或不可用，仍然报告已创建的 `loopId`，并说明无法取得本地看板 URL。
