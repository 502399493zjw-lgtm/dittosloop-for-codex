export type IdPrefix =
  | "loop"
  | "run"
  | "attempt"
  | "event"
  | "verification"
  | "human"
  | "memory"
  | "artifact"
  | "revision"
  | "workflow"
  | "task";

export function createId(prefix: IdPrefix): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);

  return `${prefix}_${timestamp}_${random}`;
}
