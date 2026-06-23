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
  humanCount: document.querySelector("#human-count")
};

elements.refresh.addEventListener("click", () => {
  void loadSnapshot();
});

async function loadSnapshot() {
  const response = await fetch("/api/snapshot", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Snapshot request failed: ${response.status}`);
  }

  render(await response.json());
}

function render(snapshot) {
  const loops = snapshot.loops ?? [];
  const runs = snapshot.runs ?? [];
  const verificationResults = snapshot.verificationResults ?? [];
  const humanRequests = snapshot.humanRequests ?? [];

  elements.loopCount.textContent = String(loops.length);
  elements.runCount.textContent = String(runs.length);
  elements.verifyCount.textContent = String(verificationResults.length);
  elements.humanCount.textContent = String(humanRequests.length);

  elements.loops.replaceChildren(...renderLoops(loops, runs));
  elements.runs.replaceChildren(...renderRuns(runs, verificationResults, humanRequests));
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
    const openHumanRequest = [...humanRequests].reverse().find((request) => request.runId === run.id && !request.resolvedAt);
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

    return card("run-card", [
      text("div", "card-title", run.id),
      text("div", "card-body", details.join("\n")),
      text("span", `status ${run.status}`, run.status)
    ]);
  });
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

function empty(message) {
  return text("div", "empty", message);
}

void loadSnapshot();
