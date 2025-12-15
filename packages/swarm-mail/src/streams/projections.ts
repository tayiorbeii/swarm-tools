/**
 * Swarm Mail Projections Layer - Query materialized views
 *
 * Projections are the read-side of CQRS. They query denormalized
 * materialized views for fast reads. Views are updated by the
 * event store when events are appended.
 *
 * Key projections:
 * - getAgents: List registered agents
 * - getInbox: Get messages for an agent
 * - getActiveReservations: Get current file locks
 * - checkConflicts: Detect reservation conflicts
 */
import { getDatabase } from "./index";
import { minimatch } from "minimatch";

// ============================================================================
// Types
// ============================================================================

export interface Agent {
  id: number;
  name: string;
  program: string;
  model: string;
  task_description: string | null;
  registered_at: number;
  last_active_at: number;
}

export interface Message {
  id: number;
  from_agent: string;
  subject: string;
  body?: string;
  thread_id: string | null;
  importance: string;
  ack_required: boolean;
  created_at: number;
  read_at?: number | null;
  acked_at?: number | null;
}

export interface Reservation {
  id: number;
  agent_name: string;
  path_pattern: string;
  exclusive: boolean;
  reason: string | null;
  created_at: number;
  expires_at: number;
}

export interface Conflict {
  path: string;
  holder: string;
  pattern: string;
  exclusive: boolean;
}

// ============================================================================
// Agent Projections
// ============================================================================

/**
 * Get all agents for a project
 */
export async function getAgents(
  projectKey: string,
  projectPath?: string,
): Promise<Agent[]> {
  const db = await getDatabase(projectPath);

  const result = await db.query<Agent>(
    `SELECT id, name, program, model, task_description, registered_at, last_active_at
     FROM agents
     WHERE project_key = $1
     ORDER BY registered_at ASC`,
    [projectKey],
  );

  return result.rows;
}

/**
 * Get a specific agent by name
 */
export async function getAgent(
  projectKey: string,
  agentName: string,
  projectPath?: string,
): Promise<Agent | null> {
  const db = await getDatabase(projectPath);

  const result = await db.query<Agent>(
    `SELECT id, name, program, model, task_description, registered_at, last_active_at
     FROM agents
     WHERE project_key = $1 AND name = $2`,
    [projectKey, agentName],
  );

  return result.rows[0] ?? null;
}

// ============================================================================
// Message Projections
// ============================================================================

export interface InboxOptions {
  limit?: number;
  urgentOnly?: boolean;
  unreadOnly?: boolean;
  includeBodies?: boolean;
  sinceTs?: string;
}

/**
 * Get inbox messages for an agent
 */
export async function getInbox(
  projectKey: string,
  agentName: string,
  options: InboxOptions = {},
  projectPath?: string,
): Promise<Message[]> {
  const db = await getDatabase(projectPath);

  const {
    limit = 50,
    urgentOnly = false,
    unreadOnly = false,
    includeBodies = true,
  } = options;

  // Build query with conditions
  const conditions = ["m.project_key = $1", "mr.agent_name = $2"];
  const params: (string | number)[] = [projectKey, agentName];
  let paramIndex = 3;

  if (urgentOnly) {
    conditions.push(`m.importance = 'urgent'`);
  }

  if (unreadOnly) {
    conditions.push(`mr.read_at IS NULL`);
  }

  const bodySelect = includeBodies ? ", m.body" : "";

  const query = `
    SELECT m.id, m.from_agent, m.subject${bodySelect}, m.thread_id, 
           m.importance, m.ack_required, m.created_at,
           mr.read_at, mr.acked_at
    FROM messages m
    JOIN message_recipients mr ON m.id = mr.message_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY m.created_at DESC
    LIMIT $${paramIndex}
  `;
  params.push(limit);

  const result = await db.query<Message>(query, params);

  return result.rows;
}

/**
 * Get a single message by ID with full body
 */
export async function getMessage(
  projectKey: string,
  messageId: number,
  projectPath?: string,
): Promise<Message | null> {
  const db = await getDatabase(projectPath);

  const result = await db.query<Message>(
    `SELECT id, from_agent, subject, body, thread_id, importance, ack_required, created_at
     FROM messages
     WHERE project_key = $1 AND id = $2`,
    [projectKey, messageId],
  );

  return result.rows[0] ?? null;
}

/**
 * Get all messages in a thread
 */
export async function getThreadMessages(
  projectKey: string,
  threadId: string,
  projectPath?: string,
): Promise<Message[]> {
  const db = await getDatabase(projectPath);

  const result = await db.query<Message>(
    `SELECT id, from_agent, subject, body, thread_id, importance, ack_required, created_at
     FROM messages
     WHERE project_key = $1 AND thread_id = $2
     ORDER BY created_at ASC`,
    [projectKey, threadId],
  );

  return result.rows;
}

// ============================================================================
// Reservation Projections
// ============================================================================

/**
 * Get active (non-expired, non-released) reservations
 */
export async function getActiveReservations(
  projectKey: string,
  projectPath?: string,
  agentName?: string,
): Promise<Reservation[]> {
  const db = await getDatabase(projectPath);

  const now = Date.now();
  const baseQuery = `
    SELECT id, agent_name, path_pattern, exclusive, reason, created_at, expires_at
    FROM reservations
    WHERE project_key = $1 
      AND released_at IS NULL 
      AND expires_at > $2
  `;
  const params: (string | number)[] = [projectKey, now];
  let query = baseQuery;

  if (agentName) {
    query += ` AND agent_name = $3`;
    params.push(agentName);
  }

  query += ` ORDER BY created_at ASC`;

  const result = await db.query<Reservation>(query, params);

  return result.rows;
}

/**
 * Check for conflicts with existing reservations
 *
 * Returns conflicts where:
 * - Another agent holds an exclusive reservation
 * - The path matches (exact or glob pattern)
 * - The reservation is still active
 */
export async function checkConflicts(
  projectKey: string,
  agentName: string,
  paths: string[],
  projectPath?: string,
): Promise<Conflict[]> {
  // Get all active exclusive reservations from OTHER agents
  const reservations = await getActiveReservations(projectKey, projectPath);

  const conflicts: Conflict[] = [];

  for (const reservation of reservations) {
    // Skip own reservations
    if (reservation.agent_name === agentName) {
      continue;
    }

    // Skip non-exclusive reservations
    if (!reservation.exclusive) {
      continue;
    }

    // Check each requested path against the reservation pattern
    for (const path of paths) {
      if (pathMatches(path, reservation.path_pattern)) {
        console.warn("[SwarmMail] Conflict detected", {
          path,
          holder: reservation.agent_name,
          pattern: reservation.path_pattern,
          requestedBy: agentName,
        });

        conflicts.push({
          path,
          holder: reservation.agent_name,
          pattern: reservation.path_pattern,
          exclusive: reservation.exclusive,
        });
      }
    }
  }

  if (conflicts.length > 0) {
    console.warn("[SwarmMail] Total conflicts detected", {
      count: conflicts.length,
      requestedBy: agentName,
      paths,
    });
  }

  return conflicts;
}

/**
 * Check if a path matches a pattern (supports glob patterns)
 */
function pathMatches(path: string, pattern: string): boolean {
  // Exact match
  if (path === pattern) {
    return true;
  }

  // Glob match using minimatch
  return minimatch(path, pattern);
}

// ============================================================================
// Eval Records Projections
// ============================================================================

export interface EvalRecord {
  id: string;
  project_key: string;
  task: string;
  context: string | null;
  strategy: string;
  epic_title: string;
  subtasks: Array<{
    title: string;
    files: string[];
    priority?: number;
  }>;
  outcomes?: Array<{
    bead_id: string;
    planned_files: string[];
    actual_files: string[];
    duration_ms: number;
    error_count: number;
    retry_count: number;
    success: boolean;
  }>;
  overall_success: boolean | null;
  total_duration_ms: number | null;
  total_errors: number | null;
  human_accepted: boolean | null;
  human_modified: boolean | null;
  human_notes: string | null;
  file_overlap_count: number | null;
  scope_accuracy: number | null;
  time_balance_ratio: number | null;
  created_at: number;
  updated_at: number;
}

export interface EvalStats {
  totalRecords: number;
  successRate: number;
  avgDurationMs: number;
  byStrategy: Record<string, number>;
}

/**
 * Get eval records with optional filters
 */
export async function getEvalRecords(
  projectKey: string,
  options?: { limit?: number; strategy?: string },
  projectPath?: string,
): Promise<EvalRecord[]> {
  const db = await getDatabase(projectPath);

  const conditions = ["project_key = $1"];
  const params: (string | number)[] = [projectKey];
  let paramIndex = 2;

  if (options?.strategy) {
    conditions.push(`strategy = $${paramIndex++}`);
    params.push(options.strategy);
  }

  const whereClause = conditions.join(" AND ");
  let query = `
    SELECT id, project_key, task, context, strategy, epic_title, subtasks,
           outcomes, overall_success, total_duration_ms, total_errors,
           human_accepted, human_modified, human_notes,
           file_overlap_count, scope_accuracy, time_balance_ratio,
           created_at, updated_at
    FROM eval_records
    WHERE ${whereClause}
    ORDER BY created_at DESC
  `;

  if (options?.limit) {
    query += ` LIMIT $${paramIndex}`;
    params.push(options.limit);
  }

  const result = await db.query<{
    id: string;
    project_key: string;
    task: string;
    context: string | null;
    strategy: string;
    epic_title: string;
    subtasks: string;
    outcomes: string | null;
    overall_success: boolean | null;
    total_duration_ms: number | null;
    total_errors: number | null;
    human_accepted: boolean | null;
    human_modified: boolean | null;
    human_notes: string | null;
    file_overlap_count: number | null;
    scope_accuracy: number | null;
    time_balance_ratio: number | null;
    created_at: string;
    updated_at: string;
  }>(query, params);

  return result.rows.map((row) => ({
    id: row.id,
    project_key: row.project_key,
    task: row.task,
    context: row.context,
    strategy: row.strategy,
    epic_title: row.epic_title,
    // PGlite returns JSONB columns as already-parsed objects
    subtasks:
      typeof row.subtasks === "string"
        ? JSON.parse(row.subtasks)
        : row.subtasks,
    outcomes: row.outcomes
      ? typeof row.outcomes === "string"
        ? JSON.parse(row.outcomes)
        : row.outcomes
      : undefined,
    overall_success: row.overall_success,
    total_duration_ms: row.total_duration_ms,
    total_errors: row.total_errors,
    human_accepted: row.human_accepted,
    human_modified: row.human_modified,
    human_notes: row.human_notes,
    file_overlap_count: row.file_overlap_count,
    scope_accuracy: row.scope_accuracy,
    time_balance_ratio: row.time_balance_ratio,
    created_at: parseInt(row.created_at as string),
    updated_at: parseInt(row.updated_at as string),
  }));
}

/**
 * Get eval statistics for a project
 */
export async function getEvalStats(
  projectKey: string,
  projectPath?: string,
): Promise<EvalStats> {
  const db = await getDatabase(projectPath);

  // Get overall stats
  const overallResult = await db.query<{
    total_records: string;
    success_count: string;
    avg_duration: string;
  }>(
    `SELECT 
      COUNT(*) as total_records,
      COUNT(*) FILTER (WHERE overall_success = true) as success_count,
      AVG(total_duration_ms) as avg_duration
    FROM eval_records
    WHERE project_key = $1`,
    [projectKey],
  );

  const totalRecords = parseInt(overallResult.rows[0]?.total_records || "0");
  const successCount = parseInt(overallResult.rows[0]?.success_count || "0");
  const avgDurationMs = parseFloat(overallResult.rows[0]?.avg_duration || "0");

  // Get by-strategy breakdown
  const strategyResult = await db.query<{
    strategy: string;
    count: string;
  }>(
    `SELECT strategy, COUNT(*) as count
    FROM eval_records
    WHERE project_key = $1
    GROUP BY strategy`,
    [projectKey],
  );

  const byStrategy: Record<string, number> = {};
  for (const row of strategyResult.rows) {
    byStrategy[row.strategy] = parseInt(row.count);
  }

  return {
    totalRecords,
    successRate: totalRecords > 0 ? successCount / totalRecords : 0,
    avgDurationMs,
    byStrategy,
  };
}
