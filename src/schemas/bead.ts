/**
 * Bead schemas for type-safe beads operations
 *
 * These schemas validate all data from the `bd` CLI to ensure
 * type safety and catch malformed responses early.
 */
import { z } from "zod";

/** Valid bead statuses */
export const BeadStatusSchema = z.enum([
  "open",
  "in_progress",
  "blocked",
  "closed",
]);
export type BeadStatus = z.infer<typeof BeadStatusSchema>;

/** Valid bead types */
export const BeadTypeSchema = z.enum([
  "bug",
  "feature",
  "task",
  "epic",
  "chore",
]);
export type BeadType = z.infer<typeof BeadTypeSchema>;

/** Dependency relationship between beads */
export const BeadDependencySchema = z.object({
  id: z.string(),
  type: z.enum(["blocks", "blocked-by", "related", "discovered-from"]),
});
export type BeadDependency = z.infer<typeof BeadDependencySchema>;

/**
 * Core bead schema - validates bd CLI JSON output
 *
 * ID format:
 * - Standard: `{project}-{hash}` (e.g., `opencode-swarm-plugin-1i8`)
 * - Subtask: `{project}-{hash}.{index}` (e.g., `opencode-swarm-plugin-1i8.1`)
 * - Custom: `{project}-{custom-id}` (e.g., `migrate-egghead-phase-0`)
 * - Custom subtask: `{project}-{custom-id}.{suffix}` (e.g., `migrate-egghead-phase-0.e2e-test`)
 */
export const BeadSchema = z.object({
  /**
   * Bead ID format: project-slug-hash with optional subtask index.
   *
   * Pattern: `project-name-xxxxx` or `project-name-xxxxx.N`
   * Examples:
   * - `my-project-abc12` (main bead)
   * - `my-project-abc12.1` (first subtask)
   * - `my-project-abc12.2` (second subtask)
   */
  id: z
    .string()
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)+(\.[\w-]+)?$/,
      "Invalid bead ID format (expected: project-slug-hash or project-slug-hash.N)",
    ),
  title: z.string().min(1, "Title required"),
  description: z.string().optional().default(""),
  status: BeadStatusSchema.default("open"),
  priority: z.number().int().min(0).max(3).default(2),
  issue_type: BeadTypeSchema.default("task"),
  created_at: z.string().datetime({
    offset: true,
    message:
      "Must be ISO-8601 datetime with timezone (e.g., 2024-01-15T10:30:00Z)",
  }),
  updated_at: z
    .string()
    .datetime({
      offset: true,
      message:
        "Must be ISO-8601 datetime with timezone (e.g., 2024-01-15T10:30:00Z)",
    })
    .optional(),
  closed_at: z.string().datetime({ offset: true }).optional(),
  parent_id: z.string().optional(),
  dependencies: z.array(BeadDependencySchema).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type Bead = z.infer<typeof BeadSchema>;

/** Arguments for creating a bead */
export const BeadCreateArgsSchema = z.object({
  title: z.string().min(1, "Title required"),
  type: BeadTypeSchema.default("task"),
  priority: z.number().int().min(0).max(3).default(2),
  description: z.string().optional(),
  parent_id: z.string().optional(),
  /**
   * Custom ID for human-readable bead names.
   * MUST include project prefix (e.g., 'migrate-egghead-phase-0', not just 'phase-0').
   * For subtasks, use dot notation: 'migrate-egghead-phase-0.e2e-test'
   */
  id: z.string().optional(),
});
export type BeadCreateArgs = z.infer<typeof BeadCreateArgsSchema>;

/** Arguments for updating a bead */
export const BeadUpdateArgsSchema = z.object({
  id: z.string(),
  status: BeadStatusSchema.optional(),
  description: z.string().optional(),
  priority: z.number().int().min(0).max(3).optional(),
});
export type BeadUpdateArgs = z.infer<typeof BeadUpdateArgsSchema>;

/** Arguments for closing a bead */
export const BeadCloseArgsSchema = z.object({
  id: z.string(),
  reason: z.string().min(1, "Reason required"),
});
export type BeadCloseArgs = z.infer<typeof BeadCloseArgsSchema>;

/** Arguments for querying beads */
export const BeadQueryArgsSchema = z.object({
  status: BeadStatusSchema.optional(),
  type: BeadTypeSchema.optional(),
  ready: z.boolean().optional(),
  limit: z.number().int().positive().default(20),
});
export type BeadQueryArgs = z.infer<typeof BeadQueryArgsSchema>;

/**
 * Subtask specification for epic decomposition
 *
 * Used when creating an epic with subtasks in one operation.
 * The `files` array is used for Agent Mail file reservations.
 */
export const SubtaskSpecSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(""),
  files: z.array(z.string()).default([]),
  dependencies: z.array(z.number().int().min(0)).default([]), // Indices of other subtasks
  /**
   * Complexity estimate on 1-5 scale:
   * 1 = trivial (typo fix, simple rename)
   * 2 = simple (single function change)
   * 3 = moderate (multi-file, some coordination)
   * 4 = complex (significant refactoring)
   * 5 = very complex (architectural change)
   */
  estimated_complexity: z.number().int().min(1).max(5).default(3),
});
export type SubtaskSpec = z.infer<typeof SubtaskSpecSchema>;

/**
 * Bead tree for swarm decomposition
 *
 * Represents an epic with its subtasks, ready for spawning agents.
 */
export const BeadTreeSchema = z.object({
  epic: z.object({
    title: z.string().min(1),
    description: z.string().optional().default(""),
  }),
  subtasks: z.array(SubtaskSpecSchema).min(1),
});
export type BeadTree = z.infer<typeof BeadTreeSchema>;

/** Arguments for creating an epic with subtasks */
export const EpicCreateArgsSchema = z.object({
  epic_title: z.string().min(1),
  epic_description: z.string().optional(),
  /**
   * Custom ID for the epic. MUST include project prefix.
   * Example: 'migrate-egghead-phase-0' (not just 'phase-0')
   * If not provided, bd generates a random ID.
   */
  epic_id: z.string().optional(),
  subtasks: z
    .array(
      z.object({
        title: z.string().min(1),
        priority: z.number().int().min(0).max(3).default(2),
        files: z.array(z.string()).optional().default([]),
        /**
         * Custom ID suffix for subtask. Combined with epic_id using dot notation.
         * Example: epic_id='migrate-egghead-phase-0', id_suffix='e2e-test'
         *          → subtask ID: 'migrate-egghead-phase-0.e2e-test'
         */
        id_suffix: z.string().optional(),
      }),
    )
    .min(1),
});
export type EpicCreateArgs = z.infer<typeof EpicCreateArgsSchema>;

/**
 * Result of epic creation
 *
 * Contains the created epic and all subtasks with their IDs.
 */
export const EpicCreateResultSchema = z.object({
  success: z.boolean(),
  epic: BeadSchema,
  subtasks: z.array(BeadSchema),
  rollback_hint: z.string().optional(),
});
export type EpicCreateResult = z.infer<typeof EpicCreateResultSchema>;
