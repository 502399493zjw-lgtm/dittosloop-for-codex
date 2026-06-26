# Choose Workflow Style

Read this when creating a formal loop or revising the shape of an existing workflow.

Workflow style describes how the loop produces the candidate result. Verification is a separate outer layer: every formal loop should still define criteria, validators, decision policy, repair policy, and stop policy.

Choose one style before building `body.steps`, then make the chosen style visible in the step labels and final summary.

| Style | Use when | Body shape |
| --- | --- | --- |
| `Pipeline` | Work has natural dependencies or ordered stages | Sequential `phase` or `task(runtime: codex)` steps, each consuming the prior output |
| `Fan-out/Fan-in` | Work can be split by source, module, object, or domain | A planning or setup task, a `parallel` step with named specialist tasks, then a merge or synthesis task |
| `Multi-perspective Vote` | The loop needs judgment, tradeoff analysis, risk review, or subjective quality calls | Multiple independent perspective tasks, then an arbiter or judge task that compares, weighs, or votes |
| `Single Expert` | The task is small, low-risk, and does not benefit from decomposition | One `task(runtime: codex)` step; use this only when the compact shape is intentional |

When the request involves monitoring, reports, research, audits, multiple sources, multiple files, or competing judgments, do not collapse it into `Single Expert` without explaining why. Prefer `Fan-out/Fan-in` for separable evidence gathering and `Multi-perspective Vote` for judgment-heavy review.

If the user gives a vague request, propose one compact contract and ask only for missing safety-critical details.
