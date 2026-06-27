# Loop Creation Guidance Design

Status: ready for review before implementation planning starts.

## Context

The DittosLoop For Codex loop skill already treats the browser preview as the visible local view of runtime state. The current creation guidance in `plugins/dittosloop-for-codex/skills/loop/references/create-loop.md` tells agents how to shape and create a formal loop contract, then tells them what to summarize in the final response.

Two small usability gaps remain:

- The creation page does not describe a clear method for turning vague user requests into concrete loop contracts.
- It does not explicitly require agents to fetch or return the local preview URL after creating a loop.

Users may get a valid loop, but the loop can reflect hidden assumptions or lack the local board link they need to inspect it immediately.

## Goals

- Make loop creation more collaborative when the user's request is vague.
- Tell agents when to ask follow-up questions and when to make reasonable defaults.
- Encourage a compact contract draft before creation when intent is underspecified but safe to propose.
- Make new-loop creation end with an inspectable local board link when available.
- Keep the runtime source-of-truth boundary unchanged: the preview displays runtime state and is not editable state.
- Keep the behavior in the creation reference, where agents already read detailed new-loop instructions.
- Make failure honest: if the preview URL cannot be retrieved, the agent should say that clearly instead of inventing a link.

## Non-Goals

- Do not change MCP runtime behavior.
- Do not change preview server behavior or UI.
- Do not add hidden background automation.
- Do not require long discovery interviews for every new loop.
- Do not require opening the in-app browser unless the user explicitly asks to view the preview.
- Do not move preview inspection rules out of `references/inspect-loop.md`.

## Proposed Behavior

Before calling `create_loop_contract`, the agent should use a lightweight creation method:

1. Restate the inferred loop goal, boundary, trigger, and expected outputs.
2. Make reasonable defaults for low-risk details instead of asking for every missing field.
3. Ask follow-up questions only for missing details that affect safety, permissions, cost, destructive actions, external side effects, project binding, or verification.
4. If the request is vague but safe, propose a compact contract draft and ask the user to confirm or correct it.
5. Convert the agreed or safely inferred shape into a formal loop contract.

After `create_loop_contract` succeeds, the agent should call `get_preview_url` and include the returned local preview URL in the final response.

The final response after creating a formal loop should include:

- The created loop ID.
- The local DittosLoop board URL when `get_preview_url` succeeds.
- The selected workflow style.
- The task names and responsibilities.
- The verification criteria.
- The validators.
- The decision policy.
- The repair and stop policy.

If `get_preview_url` fails or is unavailable, the agent should still report the loop as created and include the loop ID, but explicitly state that the local board URL could not be retrieved.

## File Changes

- Update `plugins/dittosloop-for-codex/skills/loop/references/create-loop.md`.

Expected edits:

- Add a `Creation Method` section before `Creation Flow`.
- Document the lightweight interaction pattern: restate intent, default low-risk details, ask only for critical missing details, and offer a compact contract draft when helpful.
- Add a creation-flow step after `create_loop_contract`: call `get_preview_url` so the created loop can be inspected immediately.
- Update the final-response sentence to require `loopId` and the local board URL.
- Add the preview URL failure fallback.

## Testing

This is a Markdown skill-instruction change. Verification should include:

- `npm test` to keep the existing skill structure and generated-file checks green.
- A targeted text check that `create-loop.md` mentions the creation method, `get_preview_url`, `loopId`, and the local board URL/failure fallback.

Full `npm run check` is optional for this narrow documentation-only change unless the implementation also touches generated runtime files.

## Acceptance Criteria

- A new-loop creation agent reading `create-loop.md` is explicitly instructed how to handle vague requests.
- The instructions distinguish low-risk defaults from missing details that require user interaction.
- The instructions support proposing a compact contract draft before creating a loop.
- A new-loop creation agent reading `create-loop.md` is explicitly instructed to fetch the preview URL after loop creation.
- The final response requirements include both `loopId` and a local board URL.
- The instructions say what to do when the preview URL is unavailable.
- No runtime or preview UI behavior changes.
