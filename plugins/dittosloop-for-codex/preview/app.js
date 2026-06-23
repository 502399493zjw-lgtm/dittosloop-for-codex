const formatDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

const elements = {
  refresh: document.querySelector("#refresh"),
  loops: document.querySelector("#loops"),
  runs: document.querySelector("#runs"),
  loopCount: document.querySelector("#loop-count"),
  runCount: document.querySelector("#run-count"),
  verifyCount: document.querySelector("#verify-count"),
  humanCount: document.querySelector("#human-count"),
  runDetail: document.querySelector("#run-detail")
};

let selectedRunId = null;
let currentSnapshot = null;

elements.refresh.addEventListener("click", () => {
  void loadSnapshot();
});

async function loadSnapshot() {
  const response = await fetch("/api/snapshot", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Snapshot request failed: ${response.status}`);
  }

  const snapshot = await response.json();
  currentSnapshot = snapshot;

  const runs = snapshot.runs ?? [];
  if (!selectedRunId || !runs.some((run) => run.id === selectedRunId)) {
    selectedRunId = runs.at(-1)?.id ?? null;
  }

  render(snapshot);

  if (selectedRunId) {
    await loadRunDetail(selectedRunId);
  } else {
    renderEmptyRunDetail();
  }
}

function render(snapshot) {
  const loops = snapshot.loops ?? [];
  const runs = snapshot.runs ?? [];
  const verificationResults = snapshot.verificationResults ?? [];
  const humanRequests = snapshot.humanRequests ?? [];

  elements.loopCount.textContent = String(loops.length);
  elements.runCount.textContent = String(runs.length);
  elements.verifyCount.textContent = String(verificationResults.length);
  elements.humanCount.textContent = String(humanRequests.filter((request) => request.status !== "resolved").length);

  elements.loops.replaceChildren(...renderLoops(loops, runs));
  elements.runs.replaceChildren(...renderRuns(runs, verificationResults, humanRequests));
}

async function loadRunDetail(runId) {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
  if (!response.ok) {
    renderRunDetailError(`Run detail request failed: ${response.status}`);
    return;
  }

  renderRunDetail(await response.json());
}

function renderLoops(loops, runs) {
  if (loops.length === 0) {
    return [empty("No loops yet.")];
  }

  return loops.map((loop) => {
    const runCount = runs.filter((run) => run.loopId === loop.id).length;
    return card("loop-card", [
      text("div", "card-title", loop.title),
      text("div", "card-body", loop.intent),
      text("div", "card-meta", `${runCount} runs · ${loop.verification?.checks?.length ?? 0} checks`),
      text("span", `status ${loop.status}`, loop.status)
    ]);
  });
}

function renderRuns(runs, verificationResults, humanRequests) {
  if (runs.length === 0) {
    return [empty("No runs yet.")];
  }

  return [...runs].reverse().map((run) => {
    const latestVerification = [...verificationResults].reverse().find((result) => result.runId === run.id);
    const openHumanRequest = [...humanRequests]
      .reverse()
      .find((request) => request.runId === run.id && request.status !== "resolved");
    const details = [
      `Goal: ${run.goal}`,
      `Updated: ${formatDate.format(new Date(run.updatedAt))}`
    ];

    if (latestVerification) {
      details.push(`Verification: ${latestVerification.summary}`);
    }

    if (openHumanRequest) {
      details.push(`Ask: ${openHumanRequest.question}`);
    }

    const element = document.createElement("button");
    element.type = "button";
    element.className = `run-card run-card-button${run.id === selectedRunId ? " selected" : ""}`;
    element.addEventListener("click", () => {
      selectedRunId = run.id;
      if (currentSnapshot) {
        render(currentSnapshot);
      }
      void loadRunDetail(run.id);
    });
    element.replaceChildren(
      text("div", "card-title", run.id),
      text("div", "card-body", details.join("\n")),
      text("span", `status ${run.status}`, run.status)
    );
    return element;
  });
}

function renderRunDetail(detail) {
  elements.runDetail.replaceChildren(
    text("div", "detail-title", detail.loop.title),
    text("div", "detail-meta", `${detail.run.id} · ${detail.run.status} · ${formatDate.format(new Date(detail.run.updatedAt))}`),
    section(
      "Attempts",
      detail.attempts.map((attempt) =>
        item(attempt.status, attempt.summary ?? attempt.id, attempt.completedAt ? formatDate.format(new Date(attempt.completedAt)) : "Running")
      )
    ),
    section("Timeline", detail.events.map((event) => item(event.kind, event.message, formatDate.format(new Date(event.createdAt))))),
    section(
      "Verification",
      detail.verificationResults.map((result) =>
        item(result.status, result.summary, result.attemptId ? `Attempt ${result.attemptId}` : "Run level")
      )
    ),
    section(
      "Human Requests",
      detail.humanRequests.map((request) => item(request.status, request.response ?? request.question, request.question))
    ),
    section("Memory", detail.memoryCommits.map((commit) => item("memory", commit.summary, formatDate.format(new Date(commit.createdAt))))),
    section("Artifacts", detail.artifacts.map((artifact) => artifactItem(artifact)))
  );
}

function renderEmptyRunDetail() {
  elements.runDetail.replaceChildren(empty("No run selected."));
}

function renderRunDetailError(message) {
  elements.runDetail.replaceChildren(empty(message));
}

function section(title, rows) {
  const element = document.createElement("section");
  element.className = "detail-section";
  element.replaceChildren(text("h3", "detail-heading", title), ...(rows.length ? rows : [empty("Nothing recorded.")]));
  return element;
}

function item(label, body, meta) {
  const element = document.createElement("div");
  element.className = "detail-row";
  const children = [text("span", `status ${label}`, label), text("div", "detail-copy", body)];
  if (meta) {
    children.push(text("div", "detail-small", meta));
  }
  element.replaceChildren(...children);
  return element;
}

function artifactItem(artifact) {
  const element = document.createElement("div");
  element.className = "detail-row";
  const label = text("span", `status ${artifact.kind ?? "artifact"}`, artifact.kind ?? "artifact");
  const target = artifact.url ?? artifact.path ?? artifact.title;
  const body = artifact.url ? link(artifact.url, target) : text("div", "detail-copy", target);
  element.replaceChildren(label, body, text("div", "detail-small", artifact.title));
  return element;
}

function card(className, children) {
  const element = document.createElement("article");
  element.className = className;
  element.replaceChildren(...children);
  return element;
}

function text(tag, className, content) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = content;
  return element;
}

function link(href, content) {
  const element = document.createElement("a");
  element.className = "detail-link";
  element.href = href;
  element.textContent = content;
  return element;
}

function empty(message) {
  return text("div", "empty", message);
}

void loadSnapshot();
