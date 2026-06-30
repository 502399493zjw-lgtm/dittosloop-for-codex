# 定义 Rubric

创建或修订 loop 的验收标准、criteria、validators、decision policy、repair policy 或 verifier 时阅读此文件。

Rubric 是验证层，不是 runtime script 的 worker 主流程。先用用户可读的 `Rubric Draft` 对齐验收，再把确认后的内容转换成 `verification` contract。不要让一个宽泛 verifier 覆盖所有 must criteria；criteria 要能暴露具体失败点，validators 要能说明通过或失败的证据。

## Rubric 构建方法

1. 先选择 Rubric strategy / judgment mode，再写 criteria。常见策略是 `strict-audit`、`discovery-radar`、`action-runner`、`creative-output`、`code-change`。这是人类可读的 rubric 设计分类，不是 JSON `verification.mode` 字段；合同里的 `verification.mode` 仍然只使用 runtime schema 支持的值。
2. 分清三层，不要混写：
   - `workflow requirement`: worker 需要产出什么；
   - `rubric criterion`: 什么条件才算验收通过；
   - `validator evidence contract`: verifier 需要看到什么证据才能判定通过、失败或不确定。
3. 先列 `failure risks` / 失败风险，再把每个重要风险转成一个或多个 criteria。不要从“质量要好”这种抽象愿望直接生成 criteria。
4. 按判断类型拆 validators：结构化检查交给 command/script，事实和推理校准交给独立 rubric-agent verifier 子 agent，业务取舍或权限问题交给 human review。
5. 先定义证据、置信度、失败处理，再写 JSON。每个 `must` criterion 都要有明确覆盖它的 validator，除非明确说明只能人工验收。

## Rubric Strategies

| Strategy | 适用场景 | Rubric 优先保护什么 |
| --- | --- | --- |
| `strict-audit` | 发布、合规、财务、权限、安全、会产生外部副作用的任务 | 零遗漏、证据可追踪、失败即停 |
| `discovery-radar` | 发现线索、搜集候选、公开信息调研、噪声较多的情报型任务 | 允许弱线索，但必须校准置信度和限制 |
| `action-runner` | 执行固定动作、整理队列、批量更新状态 | 是否按步骤完成、是否记录副作用和异常 |
| `creative-output` | 文案、设计、内容方案、叙事产物 | 是否满足目标受众、风格约束和可用性 |
| `code-change` | 修改代码、修复 bug、增加功能 | 行为正确、测试覆盖、风险和回归可见 |

## Rubric Draft

用用户可读的草稿，不要直接甩原始 JSON：

```text
Rubric Draft
- Strategy: strict-audit / discovery-radar / action-runner / creative-output / code-change。
- Failure risks: 最可能导致误判、漏判、误报、不可执行或伤害用户信任的点。
- Must: 结果满足 loop 的核心目标，并提供证据。
- Should: 结果符合用户偏好的格式和语气。
- Validators: 自动命令、script evaluators、rubric agents、人工审查，或混合方式。
- Evidence: 命令输出、引用来源、产物链接或审查记录。
- Failure handling: repair、ask the user，或 fail 本次 run。
```

只在验证预期重要、结果质量主观、会触发修复/重试、或需要外部证据时展示 Rubric Draft。明显低风险时，可以说明推断出的验收要求并继续。

## Discovery Radar Pattern

当 loop 目标是发现线索、候选、模式、风险、人物/公司/项目动态、公开信息或早期信号时，优先使用 `discovery-radar`。这个模式的核心规则是：

Weak leads are allowed. Miscalibrated certainty is not.

Rubric 至少要覆盖这些风险：

- `confidence-tier-assigned`: 每条发现都标注 `confirmed` / 已确认、`pending verification` / 待核验、或 `low confidence` / 低置信。
- `no-confidence-inflation`: 不把单一弱线索、转述、相似名字、未核验来源升级成已确认结论。
- `source-or-limitation-recorded`: 每条关键发现都有来源、观察依据，或明确写出无法核验的限制。
- `fact-judgment-separated`: 把事实、推断、建议分开，不把判断包装成事实。
- `noise-not-promoted`: 噪声、重复、无关或不支持目标的信号不能进入已确认区。
- `radar-actionable`: 待核验和低置信线索要说明下一步怎么核验，或者为什么暂时不值得继续。

推荐 validator 拆法：

- confidence-calibration rubric agent：检查置信度是否被夸大。
- traceability-boundary rubric agent：检查来源、限制和事实/判断边界。
- noise-containment rubric agent 或 script evaluator：检查重复、空证据、无来源 ID、未支持主张。
- radar-utility rubric agent：检查输出是否能帮助下一轮行动，而不是只堆列表。

## Verification Contract

把确认后的 rubric 写入 loop 合同的 `verification`：

```json
{
  "verification": {
    "version": 2,
    "mode": "after_workflow",
    "criteria": [
      {
        "id": "review-complete",
        "label": "审查完成",
        "description": "每个请求文件都有带证据的审查结果。",
        "severity": "must"
      }
    ],
    "validators": [
      {
        "id": "independent-review",
        "type": "rubric_agent",
        "label": "独立审查",
        "criteriaIds": ["review-complete"],
        "prompt": "作为独立 verifier 子 agent，检查 runtime script 结果是否满足所有 must criteria，并给出证据。",
        "scoreScale": { "min": 0, "max": 1 },
        "passScore": 1,
        "evidenceRequired": true,
        "severity": "must",
        "allowSelfReview": false
      }
    ],
    "decision": {
      "requireAllMustCriteriaCovered": true,
      "failOnMustValidatorFailure": true,
      "failOnShouldValidatorFailure": false,
      "requireEvidenceForAgentScores": true
    }
  }
}
```

## Validator 选择

- 需要独立判断时，使用独立 rubric-agent verifier 子 agent 审查 runtime script 结果，并设置 `allowSelfReview: false`。
- 需要命令、文件、格式或可机器判断证据时，用 command/script validator。
- 需要人工判断或业务取舍时，用 human review 或在 run 中记录 human request。
- 每个 `must` criterion 都要有覆盖它的 validator，除非明确说明只能人工验收。

## Script Evaluator Guidance

script evaluator 适合确定性、可复现、可机器判断的检查，例如：

- JSON/schema 形状、`required fields` / 必填字段、字段类型、枚举值、空值。
- `counts` / 数量、阈值、排序、重复项、覆盖率、日期窗口。
- `cross-reference` / 交叉引用完整性，例如 finding 的 source IDs 是否存在、artifact 链接是否可解析。
- `unsupported claims` / 无证据主张，例如结论条目没有引用 evidence ID。
- 命令输出、文件存在性、lint/test 结果、结构化指标是否满足阈值。

Do not use scripts as the only validator for domain judgment, source credibility, qualitative relevance, creative taste, strategic usefulness, or user-specific tradeoffs. 这些判断需要 rubric-agent verifier 子 agent、human review，或二者混合。

hybrid verification / 混合验证的推荐方式：

1. script evaluator 先产出结构化失败、指标和可定位证据。
2. rubric-agent verifier 再审查这些指标是否足以支持结论，并判断定性 criteria。
3. decision policy 只把 script 能确定的失败当作确定失败；对脚本无法判断的内容保留人工或 agent 判断。

当 Rubric Draft 需要自定义 `script evaluator` 时，在调用 `create_loop_contract` 前启动可见的 `evaluator-builder subagent`。这个 evaluator-builder 子 agent 必须创建 evaluator script，创建 fixture 或 dry-run 样例，运行 self-check，报告 script checksum，并确认 stdout 使用 `verification_result_v1` JSON 形状。只有 self-check 通过后才注册 script validator；否则保持 loop 未创建，并告诉用户 evaluator 设置被什么阻塞。
