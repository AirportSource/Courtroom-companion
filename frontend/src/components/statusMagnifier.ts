import type { ArtifactDeliveryPhase } from '../artifacts/artifactDelivery.ts'

/**
 * One status grammar for "the character is doing something" (D-079), engine-free:
 *   blue magnifier  = work in progress (a model request, artifact generation, later tools/agents)
 *   checked magnifier = that work just succeeded; shown briefly, never a gate on input
 *   nothing         = idle, failed or cancelled (errors never get a check)
 * The stage corner, the character's waiting pose and the dialogue are separate layers.
 */
export type StatusMagnifierMode = 'hidden' | 'working' | 'done'

/** How long the checked magnifier stays after an ordinary (non-artifact) reply succeeds. */
export const STATUS_DONE_MS = 750

export interface StatusMagnifierInput {
  /** A request is pending (the conversation is waiting for the backend). */
  running: boolean
  /** An ordinary reply just succeeded; the caller clears it after STATUS_DONE_MS. */
  doneFlash: boolean
  deliveryPhase: ArtifactDeliveryPhase
  /** The turn failed or was cancelled (it may still be finishing its acknowledgement line). */
  halted?: boolean
}

export function statusMagnifierMode({ running, doneFlash, deliveryPhase, halted = false }: StatusMagnifierInput): StatusMagnifierMode {
  if (halted) return 'hidden'
  switch (deliveryPhase) {
    // Failure or cancel: no check, no magnifier.
    case 'failed':
    case 'cancelled':
      return 'hidden'
    case 'task-acknowledgement':
    case 'artifact-working':
      return 'working'
    case 'artifact-done':
      return 'done'
    // The phone, the summon and their prompts own the stage here.
    case 'waiting-for-phone-acknowledgement':
    case 'evidence-summon':
      return 'hidden'
    case 'idle':
    case 'response-release':
      return running ? 'working' : doneFlash ? 'done' : 'hidden'
  }
}

/** A reply counts as a success worth a check only when the turn carried no error. */
export function replySucceeded(task: { error?: string | null } | null | undefined, generationError: string | null): boolean {
  return !generationError && !task?.error
}
