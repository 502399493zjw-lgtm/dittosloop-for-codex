# 定义 Rubric

创建或修订 loop 的验收标准、criteria、validators、decision policy、repair policy 或 verifier 时阅读此文件。

Rubric 是验证层，不是 runtime script 的 worker 主流程。先用用户可读的 `Rubric Draft` 对齐验收，再把确认后的内容转换成 `verification` contract。

## Rubric Draft

用用户可读的草稿，不要直接甩原始 JSON：

```text
Rubric Draft
- Must: 结果满足 loop 的核心目标，并提供证据。
- Should: 结果符合用户偏好的格式和语气。
- Validators: 自动命令、script evaluators、rubric agents、人工审查，或混合方式。
- Evidence: 命令输出、引用来源、产物链接或审查记录。
- Failure handling: repair、ask the user，或 fail 本次 run。
```

只在验证预期重要、结果质量主观、会触发修复/重试、或需要外部证据时展示 Rubric Draft。明显低风险时，可以说明推断出的验收要求并继续。

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

当 Rubric Draft 需要自定义 `script evaluator` 时，在调用 `create_loop_contract` 前启动可见的 `evaluator-builder subagent`。这个 evaluator-builder 子 agent 必须创建 evaluator script，创建 fixture 或 dry-run 样例，运行 self-check，报告 script checksum，并确认 stdout 使用 `verification_result_v1` JSON 形状。只有 self-check 通过后才注册 script validator；否则保持 loop 未创建，并告诉用户 evaluator 设置被什么阻塞。
