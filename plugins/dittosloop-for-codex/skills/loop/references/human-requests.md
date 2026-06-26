# Human Requests

Read this when a loop needs a user decision before it can continue.

Use `record_human_request` when a decision is needed before continuing.

Ask the user only after the open request is recorded.

Use `resolve_human_request` once the user answers a recorded request.

If the request is linked to a workflow task, resolving it also writes the answer back and resumes the workflow.

Do not continue after the user answers without calling `resolve_human_request`.
