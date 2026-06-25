import type {
  LoopContract,
  LoopOperationalState,
  LoopRun,
  LoopRunRecordStatus
} from "./types.js";

export function deriveLoopOperationalState(input: {
  loop: LoopContract;
  runs: LoopRun[];
  existing?: LoopOperationalState;
}): LoopOperationalState {
  const loopRuns = runsForLoopChronological(input.runs, input.loop.id);
  const latestRun = loopRuns.at(-1);
  const activeRun = latestRun && !isTerminalRunStatus(latestRun.status) ? latestRun : undefined;
  const terminalRuns = loopRuns.filter((run) => isTerminalRunStatus(run.status));
  const latestTerminalRun = terminalRuns.at(-1);
  const paused = input.loop.status === "paused" || input.existing?.paused === true;

  return {
    loopId: input.loop.id,
    cursor: input.existing?.cursor ?? null,
    consecutiveFailures: input.existing?.consecutiveFailures ?? consecutiveFailures(terminalRuns),
    paused,
    ...(paused && input.existing?.pausedReason ? { pausedReason: input.existing.pausedReason } : {}),
    running: Boolean(activeRun),
    runCount: Math.max(input.existing?.runCount ?? 0, terminalRuns.length),
    ...(latestTerminalRun ? { lastRunAt: runTimestamp(latestTerminalRun) } : {}),
    ...(activeRun ? { activeRunId: activeRun.id, activeRunStatus: activeRun.status } : {})
  };
}

export function deriveLoopOperationalStates(input: {
  loops: LoopContract[];
  loopStates: LoopOperationalState[];
  runs: LoopRun[];
}): LoopOperationalState[] {
  return input.loops.map((loop) =>
    deriveLoopOperationalState({
      loop,
      runs: input.runs,
      existing: input.loopStates.find((state) => state.loopId === loop.id)
    })
  );
}

export function runsForLoopChronological(runs: LoopRun[], loopId: string): LoopRun[] {
  return runs
    .filter((run) => run.loopId === loopId)
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
}

export function isTerminalRunStatus(status: LoopRun["status"]): boolean {
  return status === "completed" || status === "failed";
}

export function loopRunRecordStatus(status: LoopRun["status"]): LoopRunRecordStatus {
  return status;
}

export function consecutiveFailures(loopRuns: LoopRun[]): number {
  let count = 0;
  for (let index = loopRuns.length - 1; index >= 0; index -= 1) {
    if (loopRuns[index].status !== "failed") {
      break;
    }
    count += 1;
  }
  return count;
}

function runTimestamp(run: LoopRun): number {
  return new Date(run.completedAt ?? run.updatedAt ?? run.createdAt).getTime();
}
