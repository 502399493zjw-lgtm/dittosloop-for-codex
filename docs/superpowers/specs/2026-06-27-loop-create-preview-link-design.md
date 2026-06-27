# Loop Create Preview Link Design

Status: ready for review before implementation planning starts.

## Context

The DittosLoop For Codex loop skill already treats the browser preview as the visible local view of runtime state. The current creation guidance in `plugins/dittosloop-for-codex/skills/loop/references/create-loop.md` tells agents how to shape and create a formal loop contract, then tells them what to summarize in the final response. It does not explicitly require agents to fetch or return the local preview URL after creating a loop.

This creates a small usability gap: users may get a valid `loopId` and creation summary, but not the local board link they need to inspect the loop immediately.

## Goals

- Make new-loop creation end with an inspectable local board link when available.
- Keep the runtime source-of-truth boundary unchanged: the preview displays runtime state and is not editable state.
- Keep the behavior in the creation reference, where agents already read detailed new-loop instructions.
- Make failure honest: if the preview URL cannot be retrieved, the agent should say that clearly instead of inventing a link.

## Non-Goals

- Do not change MCP runtime behavior.
- Do not change preview server behavior or UI.
- Do not add hidden background automation.
- Do not require opening the in-app browser unless the user explicitly asks to view the preview.
- Do not move preview inspection rules out of `references/inspect-loop.md`.

## Proposed Behavior

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

- Add a creation-flow step after `create_loop_contract`: call `get_preview_url` so the created loop can be inspected immediately.
- Update the final-response sentence to require `loopId` and the local board URL.
- Add the preview URL failure fallback.

## Testing

This is a Markdown skill-instruction change. Verification should include:

- `npm test` to keep the existing skill structure and generated-file checks green.
- A targeted text check that `create-loop.md` mentions `get_preview_url`, `loopId`, and the local board URL/failure fallback.

Full `npm run check` is optional for this narrow documentation-only change unless the implementation also touches generated runtime files.

## Acceptance Criteria

- A new-loop creation agent reading `create-loop.md` is explicitly instructed to fetch the preview URL after loop creation.
- The final response requirements include both `loopId` and a local board URL.
- The instructions say what to do when the preview URL is unavailable.
- No runtime or preview UI behavior changes.
