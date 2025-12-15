/**
 * Agent Mail - Embedded event-sourced implementation
 *
 * Replaces the MCP-based agent-mail with embedded PGLite storage.
 * Same API surface, but no external server dependency.
 *
 * Key features:
 * - Event sourcing for full audit trail
 * - Offset-based resumability (Durable Streams inspired)
 * - Materialized views for fast queries
 * - File reservation with conflict detection
 */
import { registerAgent, sendMessage, reserveFiles, appendEvent } from "./store";
import {
  getAgents,
  getAgent,
  getInbox,
  getMessage,
  getActiveReservations,
  checkConflicts,
} from "./projections";
import { createEvent } from "./events";
import { isDatabaseHealthy, getDatabaseStats } from "./index";

// ============================================================================
// Constants
// ============================================================================

const MAX_INBOX_LIMIT = 5; // HARD CAP - context preservation
const DEFAULT_TTL_SECONDS = 3600; // 1 hour

// Agent name generation
const ADJECTIVES = [
  "Blue",
  "Red",
  "Green",
  "Gold",
  "Silver",
  "Swift",
  "Bright",
  "Dark",
  "Calm",
  "Bold",
  "Wise",
  "Quick",
  "Warm",
  "Cool",
  "Pure",
  "Wild",
];
const NOUNS = [
  "Lake",
  "Stone",
  "River",
  "Mountain",
  "Forest",
  "Ocean",
  "Star",
  "Moon",
  "Wind",
  "Fire",
  "Cloud",
  "Storm",
  "Dawn",
  "Dusk",
  "Hawk",
  "Wolf",
];

function generateAgentName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}${noun}`;
}

// ============================================================================
// Types
// ============================================================================

export interface AgentMailContext {
  projectKey: string;
  agentName: string;
}

export interface InitAgentOptions {
  projectPath: string;
  agentName?: string;
  program?: string;
  model?: string;
  taskDescription?: string;
}

export interface SendMessageOptions {
  projectPath: string;
  fromAgent: string;
  toAgents: string[];
  subject: string;
  body: string;
  threadId?: string;
  importance?: "low" | "normal" | "high" | "urgent";
  ackRequired?: boolean;
}

export interface SendMessageResult {
  success: boolean;
  messageId: number;
  threadId?: string;
  recipientCount: number;
}

export interface GetInboxOptions {
  projectPath: string;
  agentName: string;
  limit?: number;
  urgentOnly?: boolean;
  unreadOnly?: boolean;
  includeBodies?: boolean;
}

export interface InboxMessage {
  id: number;
  from_agent: string;
  subject: string;
  body?: string;
  thread_id: string | null;
  importance: string;
  created_at: number;
}

export interface InboxResult {
  messages: InboxMessage[];
  total: number;
}

export interface ReadMessageOptions {
  projectPath: string;
  messageId: number;
  agentName?: string;
  markAsRead?: boolean;
}

export interface ReserveFilesOptions {
  projectPath: string;
  agentName: string;
  paths: string[];
  reason?: string;
  exclusive?: boolean;
  ttlSeconds?: number;
  force?: boolean;
}

export interface GrantedReservation {
  id: number;
  path: string;
  expiresAt: number;
}

export interface ReservationConflict {
  path: string;
  holder: string;
  pattern: string;
}

export interface ReserveFilesResult {
  granted: GrantedReservation[];
  conflicts: ReservationConflict[];
}

export interface ReleaseFilesOptions {
  projectPath: string;
  agentName: string;
  paths?: string[];
  reservationIds?: number[];
}

export interface ReleaseFilesResult {
  released: number;
  releasedAt: number;
}

export interface AcknowledgeOptions {
  projectPath: string;
  messageId: number;
  agentName: string;
}

export interface AcknowledgeResult {
  acknowledged: boolean;
  acknowledgedAt: string | null;
}

export interface HealthResult {
  healthy: boolean;
  database: "connected" | "disconnected";
  stats?: {
    events: number;
    agents: number;
    messages: number;
    reservations: number;
  };
}

// ============================================================================
// Agent Operations
// ============================================================================

/**
 * Initialize an agent for this session
 */
export async function initAgent(
  options: InitAgentOptions,
): Promise<AgentMailContext> {
  const {
    projectPath,
    agentName = generateAgentName(),
    program = "opencode",
    model = "unknown",
    taskDescription,
  } = options;

  // Register the agent (creates event + updates view)
  await registerAgent(
    projectPath, // Use projectPath as projectKey
    agentName,
    { program, model, taskDescription },
    projectPath,
  );

  return {
    projectKey: projectPath,
    agentName,
  };
}

// ============================================================================
// Message Operations
// ============================================================================

/**
 * Send a message to other agents
 */
export async function sendAgentMessage(
  options: SendMessageOptions,
): Promise<SendMessageResult> {
  const {
    projectPath,
    fromAgent,
    toAgents,
    subject,
    body,
    threadId,
    importance = "normal",
    ackRequired = false,
  } = options;

  await sendMessage(
    projectPath,
    fromAgent,
    toAgents,
    subject,
    body,
    { threadId, importance, ackRequired },
    projectPath,
  );

  // Get the message ID from the messages table (not the event ID)
  const { getDatabase } = await import("./index");
  const db = await getDatabase(projectPath);
  const result = await db.query<{ id: number }>(
    `SELECT id FROM messages 
     WHERE project_key = $1 AND from_agent = $2 AND subject = $3
     ORDER BY created_at DESC LIMIT 1`,
    [projectPath, fromAgent, subject],
  );

  const messageId = result.rows[0]?.id ?? 0;

  return {
    success: true,
    messageId,
    threadId,
    recipientCount: toAgents.length,
  };
}

/**
 * Get inbox messages for an agent
 */
export async function getAgentInbox(
  options: GetInboxOptions,
): Promise<InboxResult> {
  const {
    projectPath,
    agentName,
    limit = MAX_INBOX_LIMIT,
    urgentOnly = false,
    unreadOnly = false,
    includeBodies = false,
  } = options;

  // Enforce max limit
  const effectiveLimit = Math.min(limit, MAX_INBOX_LIMIT);

  const messages = await getInbox(
    projectPath,
    agentName,
    {
      limit: effectiveLimit,
      urgentOnly,
      unreadOnly,
      includeBodies,
    },
    projectPath,
  );

  return {
    messages: messages.map((m) => ({
      id: m.id,
      from_agent: m.from_agent,
      subject: m.subject,
      body: includeBodies ? m.body : undefined,
      thread_id: m.thread_id,
      importance: m.importance,
      created_at: m.created_at,
    })),
    total: messages.length,
  };
}

/**
 * Read a single message with full body
 */
export async function readAgentMessage(
  options: ReadMessageOptions,
): Promise<InboxMessage | null> {
  const { projectPath, messageId, agentName, markAsRead = false } = options;

  const message = await getMessage(projectPath, messageId, projectPath);

  if (!message) {
    return null;
  }

  // Mark as read if requested
  if (markAsRead && agentName) {
    await appendEvent(
      createEvent("message_read", {
        project_key: projectPath,
        message_id: messageId,
        agent_name: agentName,
      }),
      projectPath,
    );
  }

  return {
    id: message.id,
    from_agent: message.from_agent,
    subject: message.subject,
    body: message.body,
    thread_id: message.thread_id,
    importance: message.importance,
    created_at: message.created_at,
  };
}

// ============================================================================
// Reservation Operations
// ============================================================================

/**
 * Reserve files for exclusive editing
 */
export async function reserveAgentFiles(
  options: ReserveFilesOptions,
): Promise<ReserveFilesResult> {
  const {
    projectPath,
    agentName,
    paths,
    reason,
    exclusive = true,
    ttlSeconds = DEFAULT_TTL_SECONDS,
    force = false,
  } = options;

  // Check for conflicts first
  const conflicts = await checkConflicts(
    projectPath,
    agentName,
    paths,
    projectPath,
  );

  // If conflicts exist and not forcing, reject reservation
  if (conflicts.length > 0 && !force) {
    return {
      granted: [],
      conflicts: conflicts.map((c) => ({
        path: c.path,
        holder: c.holder,
        pattern: c.pattern,
      })),
    };
  }

  // Only create reservations if no conflicts or force=true
  const event = await reserveFiles(
    projectPath,
    agentName,
    paths,
    { reason, exclusive, ttlSeconds },
    projectPath,
  );

  // Build granted list
  const granted: GrantedReservation[] = paths.map((path, index) => ({
    id: event.id + index, // Approximate - each path gets a reservation
    path,
    expiresAt: event.expires_at,
  }));

  return {
    granted,
    conflicts: conflicts.map((c) => ({
      path: c.path,
      holder: c.holder,
      pattern: c.pattern,
    })),
  };
}

/**
 * Release file reservations
 */
export async function releaseAgentFiles(
  options: ReleaseFilesOptions,
): Promise<ReleaseFilesResult> {
  const { projectPath, agentName, paths, reservationIds } = options;

  // Get current reservations to count what we're releasing
  const currentReservations = await getActiveReservations(
    projectPath,
    projectPath,
    agentName,
  );

  let releaseCount = 0;

  if (paths && paths.length > 0) {
    // Release specific paths
    releaseCount = currentReservations.filter((r) =>
      paths.includes(r.path_pattern),
    ).length;
  } else if (reservationIds && reservationIds.length > 0) {
    // Release by ID
    releaseCount = currentReservations.filter((r) =>
      reservationIds.includes(r.id),
    ).length;
  } else {
    // Release all
    releaseCount = currentReservations.length;
  }

  // Create release event
  await appendEvent(
    createEvent("file_released", {
      project_key: projectPath,
      agent_name: agentName,
      paths,
      reservation_ids: reservationIds,
    }),
    projectPath,
  );

  return {
    released: releaseCount,
    releasedAt: Date.now(),
  };
}

// ============================================================================
// Acknowledgement Operations
// ============================================================================

/**
 * Acknowledge a message
 */
export async function acknowledgeMessage(
  options: AcknowledgeOptions,
): Promise<AcknowledgeResult> {
  const { projectPath, messageId, agentName } = options;

  const timestamp = Date.now();

  await appendEvent(
    createEvent("message_acked", {
      project_key: projectPath,
      message_id: messageId,
      agent_name: agentName,
    }),
    projectPath,
  );

  return {
    acknowledged: true,
    acknowledgedAt: new Date(timestamp).toISOString(),
  };
}

// ============================================================================
// Health Check
// ============================================================================

/**
 * Check if the agent mail store is healthy
 */
export async function checkHealth(projectPath?: string): Promise<HealthResult> {
  const healthy = await isDatabaseHealthy(projectPath);

  if (!healthy) {
    return {
      healthy: false,
      database: "disconnected",
    };
  }

  const stats = await getDatabaseStats(projectPath);

  return {
    healthy: true,
    database: "connected",
    stats,
  };
}
