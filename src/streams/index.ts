/**
 * PGLite Event Store Setup
 *
 * Embedded PostgreSQL database for event sourcing.
 * No external server required - runs in-process.
 *
 * Database location: .opencode/streams.db (project-local)
 * or ~/.opencode/streams.db (global fallback)
 */
import { PGlite } from "@electric-sql/pglite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ============================================================================
// Configuration
// ============================================================================

/**
 * Get the database path for a project
 *
 * Prefers project-local .opencode/streams.db
 * Falls back to global ~/.opencode/streams.db
 */
export function getDatabasePath(projectPath?: string): string {
  // Try project-local first
  if (projectPath) {
    const localDir = join(projectPath, ".opencode");
    if (existsSync(localDir) || existsSync(projectPath)) {
      if (!existsSync(localDir)) {
        mkdirSync(localDir, { recursive: true });
      }
      return join(localDir, "streams");
    }
  }

  // Fall back to global
  const globalDir = join(homedir(), ".opencode");
  if (!existsSync(globalDir)) {
    mkdirSync(globalDir, { recursive: true });
  }
  return join(globalDir, "streams");
}

// ============================================================================
// Database Instance Management
// ============================================================================

/** Singleton database instances keyed by path */
const instances = new Map<string, PGlite>();

/** Whether schema has been initialized for each instance */
const schemaInitialized = new Map<string, boolean>();

/**
 * Get or create a PGLite instance for the given path
 */
export async function getDatabase(projectPath?: string): Promise<PGlite> {
  const dbPath = getDatabasePath(projectPath);

  // Return existing instance if available
  let db = instances.get(dbPath);
  if (db) {
    return db;
  }

  // Create new instance
  db = new PGlite(dbPath);
  instances.set(dbPath, db);

  // Initialize schema if needed
  if (!schemaInitialized.get(dbPath)) {
    await initializeSchema(db);
    schemaInitialized.set(dbPath, true);
  }

  return db;
}

/**
 * Close a database instance
 */
export async function closeDatabase(projectPath?: string): Promise<void> {
  const dbPath = getDatabasePath(projectPath);
  const db = instances.get(dbPath);
  if (db) {
    await db.close();
    instances.delete(dbPath);
    schemaInitialized.delete(dbPath);
  }
}

/**
 * Close all database instances
 */
export async function closeAllDatabases(): Promise<void> {
  for (const [path, db] of instances) {
    await db.close();
    instances.delete(path);
    schemaInitialized.delete(path);
  }
}

/**
 * Reset database for testing - clears all data but keeps schema
 */
export async function resetDatabase(projectPath?: string): Promise<void> {
  const db = await getDatabase(projectPath);
  await db.exec(`
    DELETE FROM message_recipients;
    DELETE FROM messages;
    DELETE FROM reservations;
    DELETE FROM agents;
    DELETE FROM events;
  `);
}

// ============================================================================
// Schema Initialization
// ============================================================================

/**
 * Initialize the database schema
 *
 * Creates tables for:
 * - events: The append-only event log
 * - agents: Materialized view of registered agents
 * - messages: Materialized view of messages
 * - reservations: Materialized view of file reservations
 */
async function initializeSchema(db: PGlite): Promise<void> {
  await db.exec(`
    -- Events table: The source of truth (append-only)
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      project_key TEXT NOT NULL,
      timestamp BIGINT NOT NULL,
      sequence SERIAL,
      data JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Index for efficient queries
    CREATE INDEX IF NOT EXISTS idx_events_project_key ON events(project_key);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_project_type ON events(project_key, type);

    -- Agents materialized view (rebuilt from events)
    CREATE TABLE IF NOT EXISTS agents (
      id SERIAL PRIMARY KEY,
      project_key TEXT NOT NULL,
      name TEXT NOT NULL,
      program TEXT DEFAULT 'opencode',
      model TEXT DEFAULT 'unknown',
      task_description TEXT,
      registered_at BIGINT NOT NULL,
      last_active_at BIGINT NOT NULL,
      UNIQUE(project_key, name)
    );

    CREATE INDEX IF NOT EXISTS idx_agents_project ON agents(project_key);

    -- Messages materialized view
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      project_key TEXT NOT NULL,
      from_agent TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      thread_id TEXT,
      importance TEXT DEFAULT 'normal',
      ack_required BOOLEAN DEFAULT FALSE,
      created_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_key);
    CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);

    -- Message recipients (many-to-many)
    CREATE TABLE IF NOT EXISTS message_recipients (
      message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
      agent_name TEXT NOT NULL,
      read_at BIGINT,
      acked_at BIGINT,
      PRIMARY KEY(message_id, agent_name)
    );

    CREATE INDEX IF NOT EXISTS idx_recipients_agent ON message_recipients(agent_name);

    -- File reservations materialized view
    CREATE TABLE IF NOT EXISTS reservations (
      id SERIAL PRIMARY KEY,
      project_key TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      path_pattern TEXT NOT NULL,
      exclusive BOOLEAN DEFAULT TRUE,
      reason TEXT,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      released_at BIGINT
    );

    CREATE INDEX IF NOT EXISTS idx_reservations_project ON reservations(project_key);
    CREATE INDEX IF NOT EXISTS idx_reservations_agent ON reservations(agent_name);
    CREATE INDEX IF NOT EXISTS idx_reservations_expires ON reservations(expires_at);
    CREATE INDEX IF NOT EXISTS idx_reservations_active ON reservations(project_key, released_at) WHERE released_at IS NULL;
  `);
}

// ============================================================================
// Health Check
// ============================================================================

/**
 * Check if the database is healthy
 */
export async function isDatabaseHealthy(
  projectPath?: string,
): Promise<boolean> {
  try {
    const db = await getDatabase(projectPath);
    const result = await db.query("SELECT 1 as ok");
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Get database statistics
 */
export async function getDatabaseStats(projectPath?: string): Promise<{
  events: number;
  agents: number;
  messages: number;
  reservations: number;
}> {
  const db = await getDatabase(projectPath);

  const [events, agents, messages, reservations] = await Promise.all([
    db.query<{ count: string }>("SELECT COUNT(*) as count FROM events"),
    db.query<{ count: string }>("SELECT COUNT(*) as count FROM agents"),
    db.query<{ count: string }>("SELECT COUNT(*) as count FROM messages"),
    db.query<{ count: string }>(
      "SELECT COUNT(*) as count FROM reservations WHERE released_at IS NULL",
    ),
  ]);

  return {
    events: parseInt(events.rows[0]?.count || "0"),
    agents: parseInt(agents.rows[0]?.count || "0"),
    messages: parseInt(messages.rows[0]?.count || "0"),
    reservations: parseInt(reservations.rows[0]?.count || "0"),
  };
}

// ============================================================================
// Exports
// ============================================================================

export { PGlite };
export * from "./events";
export * from "./store";
export * from "./projections";
export * from "./agent-mail";
export * from "./debug";
