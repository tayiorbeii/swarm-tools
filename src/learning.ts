/**
 * Learning Module - Confidence decay, feedback scoring, and outcome tracking
 *
 * Implements patterns from cass-memory for learning from swarm outcomes:
 * - Confidence decay: evaluation criteria weights fade unless revalidated
 * - Feedback events: track helpful/harmful signals from task outcomes
 * - Outcome scoring: implicit feedback from duration, errors, retries
 *
 * @see https://github.com/Dicklesworthstone/cass_memory_system/blob/main/src/scoring.ts
 * @see https://github.com/Dicklesworthstone/cass_memory_system/blob/main/src/outcome.ts
 */
import { z } from "zod";

// ============================================================================
// Schemas
// ============================================================================

/**
 * Feedback event types
 */
export const FeedbackTypeSchema = z.enum(["helpful", "harmful", "neutral"]);
export type FeedbackType = z.infer<typeof FeedbackTypeSchema>;

/**
 * A feedback event records whether a criterion evaluation was accurate
 *
 * When an evaluation criterion (e.g., "type_safe") is later proven correct
 * or incorrect, we record that as feedback to adjust future weights.
 */
export const FeedbackEventSchema = z.object({
  /** Unique ID for this feedback event */
  id: z.string(),
  /** The criterion this feedback applies to */
  criterion: z.string(),
  /** Whether this feedback indicates the criterion was helpful or harmful */
  type: FeedbackTypeSchema,
  /** When this feedback was recorded */
  timestamp: z.string(), // ISO-8601
  /** Context about why this feedback was given */
  context: z.string().optional(),
  /** The bead ID this feedback relates to */
  bead_id: z.string().optional(),
  /** Raw value before decay (1.0 = full weight) */
  raw_value: z.number().min(0).max(1).default(1),
});
export type FeedbackEvent = z.infer<typeof FeedbackEventSchema>;

/**
 * Criterion weight with decay tracking
 */
export const CriterionWeightSchema = z.object({
  /** The criterion name (e.g., "type_safe") */
  criterion: z.string(),
  /** Current weight after decay (0-1) */
  weight: z.number().min(0).max(1),
  /** Number of helpful feedback events */
  helpful_count: z.number().int().min(0),
  /** Number of harmful feedback events */
  harmful_count: z.number().int().min(0),
  /** Last time this criterion was validated */
  last_validated: z.string().optional(), // ISO-8601
  /** Decay half-life in days */
  half_life_days: z.number().positive().default(90),
});
export type CriterionWeight = z.infer<typeof CriterionWeightSchema>;

/**
 * Decomposition strategies for tracking which approach was used
 */
export const DecompositionStrategySchema = z.enum([
  "file-based",
  "feature-based",
  "risk-based",
]);
export type DecompositionStrategy = z.infer<typeof DecompositionStrategySchema>;

/**
 * Outcome signals from a completed subtask
 *
 * These implicit signals help score decomposition quality without
 * explicit feedback from the user.
 */
export const OutcomeSignalsSchema = z.object({
  /** Subtask bead ID */
  bead_id: z.string(),
  /** Duration in milliseconds */
  duration_ms: z.number().int().min(0),
  /** Number of errors encountered */
  error_count: z.number().int().min(0),
  /** Number of retry attempts */
  retry_count: z.number().int().min(0),
  /** Whether the subtask ultimately succeeded */
  success: z.boolean(),
  /** Files that were modified */
  files_touched: z.array(z.string()).default([]),
  /** Timestamp when outcome was recorded */
  timestamp: z.string(), // ISO-8601
  /** Decomposition strategy used for this task */
  strategy: DecompositionStrategySchema.optional(),
});
export type OutcomeSignals = z.infer<typeof OutcomeSignalsSchema>;

/**
 * Scored outcome with implicit feedback type
 */
export const ScoredOutcomeSchema = z.object({
  /** The outcome signals */
  signals: OutcomeSignalsSchema,
  /** Inferred feedback type */
  type: FeedbackTypeSchema,
  /** Decayed value (0-1) */
  decayed_value: z.number().min(0).max(1),
  /** Explanation of the scoring */
  reasoning: z.string(),
});
export type ScoredOutcome = z.infer<typeof ScoredOutcomeSchema>;

// ============================================================================
// Configuration
// ============================================================================

/**
 * Default configuration for learning
 */
export interface LearningConfig {
  /** Half-life for confidence decay in days */
  halfLifeDays: number;
  /** Minimum feedback events before adjusting weights */
  minFeedbackForAdjustment: number;
  /** Maximum harmful ratio before deprecating a criterion */
  maxHarmfulRatio: number;
  /** Threshold duration (ms) for "fast" completion */
  fastCompletionThresholdMs: number;
  /** Threshold duration (ms) for "slow" completion */
  slowCompletionThresholdMs: number;
  /** Maximum errors before considering harmful */
  maxErrorsForHelpful: number;
}

export const DEFAULT_LEARNING_CONFIG: LearningConfig = {
  halfLifeDays: 90,
  minFeedbackForAdjustment: 3,
  maxHarmfulRatio: 0.3,
  fastCompletionThresholdMs: 5 * 60 * 1000, // 5 minutes
  slowCompletionThresholdMs: 30 * 60 * 1000, // 30 minutes
  maxErrorsForHelpful: 2,
};

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Calculate decayed value using half-life formula
 *
 * Value decays by 50% every `halfLifeDays` days.
 * Formula: value * 0.5^(age/halfLife)
 *
 * @param timestamp - When the event occurred (ISO-8601)
 * @param now - Current time
 * @param halfLifeDays - Half-life in days (default: 90)
 * @returns Decayed value between 0 and 1
 *
 * @example
 * // Event from 90 days ago with 90-day half-life
 * calculateDecayedValue("2024-09-08T00:00:00Z", new Date("2024-12-07"), 90)
 * // Returns ~0.5
 */
export function calculateDecayedValue(
  timestamp: string,
  now: Date = new Date(),
  halfLifeDays: number = 90,
): number {
  const eventTime = new Date(timestamp).getTime();
  const nowTime = now.getTime();
  const ageDays = Math.max(0, (nowTime - eventTime) / (24 * 60 * 60 * 1000));

  return Math.pow(0.5, ageDays / halfLifeDays);
}

/**
 * Calculate weighted criterion score from feedback events
 *
 * Applies decay to each feedback event and aggregates them.
 * Helpful events increase the score, harmful events decrease it.
 *
 * @param events - Feedback events for this criterion
 * @param config - Learning configuration
 * @returns Weight between 0 and 1
 */
export function calculateCriterionWeight(
  events: FeedbackEvent[],
  config: LearningConfig = DEFAULT_LEARNING_CONFIG,
): CriterionWeight {
  const now = new Date();
  let helpfulSum = 0;
  let harmfulSum = 0;
  let helpfulCount = 0;
  let harmfulCount = 0;
  let lastValidated: string | undefined;

  for (const event of events) {
    const decayed = calculateDecayedValue(
      event.timestamp,
      now,
      config.halfLifeDays,
    );
    const value = event.raw_value * decayed;

    if (event.type === "helpful") {
      helpfulSum += value;
      helpfulCount++;
      if (!lastValidated || event.timestamp > lastValidated) {
        lastValidated = event.timestamp;
      }
    } else if (event.type === "harmful") {
      harmfulSum += value;
      harmfulCount++;
    }
  }

  // Calculate weight: helpful / (helpful + harmful), with minimum of 0.1
  const total = helpfulSum + harmfulSum;
  const weight = total > 0 ? Math.max(0.1, helpfulSum / total) : 1.0;

  return {
    criterion: events[0]?.criterion ?? "unknown",
    weight,
    helpful_count: helpfulCount,
    harmful_count: harmfulCount,
    last_validated: lastValidated,
    half_life_days: config.halfLifeDays,
  };
}

/**
 * Score implicit feedback from task outcome signals
 *
 * Infers whether a decomposition/subtask was helpful or harmful based on:
 * - Duration: fast completion = helpful, slow = harmful
 * - Errors: few errors = helpful, many = harmful
 * - Retries: no retries = helpful, many = harmful
 * - Success: success = helpful, failure = harmful
 *
 * @param signals - Outcome signals from completed subtask
 * @param config - Learning configuration
 * @returns Scored outcome with feedback type and reasoning
 */
export function scoreImplicitFeedback(
  signals: OutcomeSignals,
  config: LearningConfig = DEFAULT_LEARNING_CONFIG,
): ScoredOutcome {
  const now = new Date();
  const decayed = calculateDecayedValue(
    signals.timestamp,
    now,
    config.halfLifeDays,
  );

  // Score components (each 0-1, higher = better)
  const durationScore =
    signals.duration_ms < config.fastCompletionThresholdMs
      ? 1.0
      : signals.duration_ms > config.slowCompletionThresholdMs
        ? 0.2
        : 0.6;

  const errorScore =
    signals.error_count === 0
      ? 1.0
      : signals.error_count <= config.maxErrorsForHelpful
        ? 0.6
        : 0.2;

  const retryScore =
    signals.retry_count === 0 ? 1.0 : signals.retry_count === 1 ? 0.7 : 0.3;

  const successScore = signals.success ? 1.0 : 0.0;

  // Weighted average (success matters most)
  const rawScore =
    successScore * 0.4 +
    durationScore * 0.2 +
    errorScore * 0.2 +
    retryScore * 0.2;

  // Determine feedback type
  let type: FeedbackType;
  let reasoning: string;

  if (rawScore >= 0.7) {
    type = "helpful";
    reasoning =
      `Fast completion (${Math.round(signals.duration_ms / 1000)}s), ` +
      `${signals.error_count} errors, ${signals.retry_count} retries, ` +
      `${signals.success ? "succeeded" : "failed"}`;
  } else if (rawScore <= 0.4) {
    type = "harmful";
    reasoning =
      `Slow completion (${Math.round(signals.duration_ms / 1000)}s), ` +
      `${signals.error_count} errors, ${signals.retry_count} retries, ` +
      `${signals.success ? "succeeded" : "failed"}`;
  } else {
    type = "neutral";
    reasoning =
      `Mixed signals: ${Math.round(signals.duration_ms / 1000)}s, ` +
      `${signals.error_count} errors, ${signals.retry_count} retries`;
  }

  return {
    signals,
    type,
    decayed_value: rawScore * decayed,
    reasoning,
  };
}

/**
 * Create a feedback event from a scored outcome
 *
 * Converts implicit outcome scoring into an explicit feedback event
 * that can be stored and used for criterion weight calculation.
 *
 * @param outcome - Scored outcome
 * @param criterion - Which criterion this feedback applies to
 * @returns Feedback event
 */
export function outcomeToFeedback(
  outcome: ScoredOutcome,
  criterion: string,
): FeedbackEvent {
  return {
    id: `${outcome.signals.bead_id}-${criterion}-${Date.now()}`,
    criterion,
    type: outcome.type,
    timestamp: outcome.signals.timestamp,
    context: outcome.reasoning,
    bead_id: outcome.signals.bead_id,
    raw_value: outcome.decayed_value,
  };
}

/**
 * Apply criterion weights to evaluation scores
 *
 * Adjusts raw evaluation scores by their learned weights.
 * Criteria with low confidence (due to past failures) have reduced impact.
 *
 * @param criteria - Map of criterion name to raw score (0-1)
 * @param weights - Map of criterion name to weight
 * @returns Weighted scores
 */
export function applyWeights(
  criteria: Record<string, number>,
  weights: Record<string, CriterionWeight>,
): Record<string, { raw: number; weighted: number; weight: number }> {
  const result: Record<
    string,
    { raw: number; weighted: number; weight: number }
  > = {};

  for (const [name, rawScore] of Object.entries(criteria)) {
    const weight = weights[name]?.weight ?? 1.0;
    result[name] = {
      raw: rawScore,
      weighted: rawScore * weight,
      weight,
    };
  }

  return result;
}

/**
 * Check if a criterion should be deprecated based on feedback
 *
 * A criterion is deprecated if it has enough feedback and the
 * harmful ratio exceeds the threshold.
 *
 * @param weight - Criterion weight with feedback counts
 * @param config - Learning configuration
 * @returns Whether the criterion should be deprecated
 */
export function shouldDeprecateCriterion(
  weight: CriterionWeight,
  config: LearningConfig = DEFAULT_LEARNING_CONFIG,
): boolean {
  const total = weight.helpful_count + weight.harmful_count;
  if (total < config.minFeedbackForAdjustment) {
    return false;
  }

  const harmfulRatio = weight.harmful_count / total;
  return harmfulRatio > config.maxHarmfulRatio;
}

// ============================================================================
// Storage Helpers
// ============================================================================

/**
 * Storage interface for feedback events
 *
 * Implementations can use file system, SQLite, or other backends.
 */
export interface FeedbackStorage {
  /** Store a feedback event */
  store(event: FeedbackEvent): Promise<void>;
  /** Get all feedback events for a criterion */
  getByCriterion(criterion: string): Promise<FeedbackEvent[]>;
  /** Get all feedback events for a bead */
  getByBead(beadId: string): Promise<FeedbackEvent[]>;
  /** Get all feedback events */
  getAll(): Promise<FeedbackEvent[]>;
}

/**
 * In-memory feedback storage (for testing and short-lived sessions)
 */
export class InMemoryFeedbackStorage implements FeedbackStorage {
  private events: FeedbackEvent[] = [];

  async store(event: FeedbackEvent): Promise<void> {
    this.events.push(event);
  }

  async getByCriterion(criterion: string): Promise<FeedbackEvent[]> {
    return this.events.filter((e) => e.criterion === criterion);
  }

  async getByBead(beadId: string): Promise<FeedbackEvent[]> {
    return this.events.filter((e) => e.bead_id === beadId);
  }

  async getAll(): Promise<FeedbackEvent[]> {
    return [...this.events];
  }
}

// ============================================================================
// Exports
// ============================================================================

export const learningSchemas = {
  FeedbackTypeSchema,
  FeedbackEventSchema,
  CriterionWeightSchema,
  OutcomeSignalsSchema,
  ScoredOutcomeSchema,
  DecompositionStrategySchema,
};
