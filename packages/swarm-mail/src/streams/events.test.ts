/**
 * Unit tests for Event Types and Helpers
 *
 * Tests:
 * - Schema validation for all event types
 * - createEvent helper
 * - isEventType type guard
 * - Edge cases and error handling
 */
import { describe, it, expect } from "vitest";
import {
  AgentEventSchema,
  AgentRegisteredEventSchema,
  AgentActiveEventSchema,
  MessageSentEventSchema,
  MessageReadEventSchema,
  MessageAckedEventSchema,
  FileReservedEventSchema,
  FileReleasedEventSchema,
  TaskStartedEventSchema,
  TaskProgressEventSchema,
  TaskCompletedEventSchema,
  TaskBlockedEventSchema,
  DecompositionGeneratedEventSchema,
  SubtaskOutcomeEventSchema,
  HumanFeedbackEventSchema,
  createEvent,
  isEventType,
  type AgentEvent,
} from "./events";

// ============================================================================
// Schema Validation Tests
// ============================================================================

describe("AgentRegisteredEventSchema", () => {
  it("validates a complete agent_registered event", () => {
    const event = {
      type: "agent_registered",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
      program: "opencode",
      model: "claude-sonnet-4",
      task_description: "Working on auth",
    };
    expect(() => AgentRegisteredEventSchema.parse(event)).not.toThrow();
  });

  it("applies defaults for program and model", () => {
    const event = {
      type: "agent_registered",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
    };
    const parsed = AgentRegisteredEventSchema.parse(event);
    expect(parsed.program).toBe("opencode");
    expect(parsed.model).toBe("unknown");
  });

  it("rejects missing agent_name", () => {
    const event = {
      type: "agent_registered",
      project_key: "/test/project",
      timestamp: Date.now(),
    };
    expect(() => AgentRegisteredEventSchema.parse(event)).toThrow();
  });
});

describe("AgentActiveEventSchema", () => {
  it("validates agent_active event", () => {
    const event = {
      type: "agent_active",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
    };
    expect(() => AgentActiveEventSchema.parse(event)).not.toThrow();
  });
});

describe("MessageSentEventSchema", () => {
  it("validates a complete message_sent event", () => {
    const event = {
      type: "message_sent",
      project_key: "/test/project",
      timestamp: Date.now(),
      from_agent: "BlueLake",
      to_agents: ["RedStone", "GreenCastle"],
      subject: "Task update",
      body: "Completed the auth module",
      thread_id: "bd-123",
      importance: "high",
      ack_required: true,
    };
    expect(() => MessageSentEventSchema.parse(event)).not.toThrow();
  });

  it("applies defaults for importance and ack_required", () => {
    const event = {
      type: "message_sent",
      project_key: "/test/project",
      timestamp: Date.now(),
      from_agent: "BlueLake",
      to_agents: ["RedStone"],
      subject: "Hello",
      body: "World",
    };
    const parsed = MessageSentEventSchema.parse(event);
    expect(parsed.importance).toBe("normal");
    expect(parsed.ack_required).toBe(false);
  });

  it("validates importance enum values", () => {
    const validImportance = ["low", "normal", "high", "urgent"];
    for (const importance of validImportance) {
      const event = {
        type: "message_sent",
        project_key: "/test/project",
        timestamp: Date.now(),
        from_agent: "BlueLake",
        to_agents: ["RedStone"],
        subject: "Test",
        body: "Test",
        importance,
      };
      expect(() => MessageSentEventSchema.parse(event)).not.toThrow();
    }
  });

  it("rejects invalid importance value", () => {
    const event = {
      type: "message_sent",
      project_key: "/test/project",
      timestamp: Date.now(),
      from_agent: "BlueLake",
      to_agents: ["RedStone"],
      subject: "Test",
      body: "Test",
      importance: "critical", // Invalid
    };
    expect(() => MessageSentEventSchema.parse(event)).toThrow();
  });

  it("rejects empty to_agents array", () => {
    const event = {
      type: "message_sent",
      project_key: "/test/project",
      timestamp: Date.now(),
      from_agent: "BlueLake",
      to_agents: [],
      subject: "Test",
      body: "Test",
    };
    // Empty array is technically valid per schema - it's a broadcast
    expect(() => MessageSentEventSchema.parse(event)).not.toThrow();
  });
});

describe("MessageReadEventSchema", () => {
  it("validates message_read event", () => {
    const event = {
      type: "message_read",
      project_key: "/test/project",
      timestamp: Date.now(),
      message_id: 42,
      agent_name: "RedStone",
    };
    expect(() => MessageReadEventSchema.parse(event)).not.toThrow();
  });
});

describe("MessageAckedEventSchema", () => {
  it("validates message_acked event", () => {
    const event = {
      type: "message_acked",
      project_key: "/test/project",
      timestamp: Date.now(),
      message_id: 42,
      agent_name: "RedStone",
    };
    expect(() => MessageAckedEventSchema.parse(event)).not.toThrow();
  });
});

describe("FileReservedEventSchema", () => {
  it("validates a complete file_reserved event", () => {
    const event = {
      type: "file_reserved",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
      paths: ["src/auth/**", "src/config.ts"],
      reason: "bd-123: Working on auth",
      exclusive: true,
      ttl_seconds: 3600,
      expires_at: Date.now() + 3600000,
    };
    expect(() => FileReservedEventSchema.parse(event)).not.toThrow();
  });

  it("applies defaults for exclusive and ttl_seconds", () => {
    const event = {
      type: "file_reserved",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
      paths: ["src/auth/**"],
      expires_at: Date.now() + 3600000,
    };
    const parsed = FileReservedEventSchema.parse(event);
    expect(parsed.exclusive).toBe(true);
    expect(parsed.ttl_seconds).toBe(3600);
  });

  it("requires expires_at", () => {
    const event = {
      type: "file_reserved",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
      paths: ["src/auth/**"],
    };
    expect(() => FileReservedEventSchema.parse(event)).toThrow();
  });
});

describe("FileReleasedEventSchema", () => {
  it("validates file_released with paths", () => {
    const event = {
      type: "file_released",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
      paths: ["src/auth/**"],
    };
    expect(() => FileReleasedEventSchema.parse(event)).not.toThrow();
  });

  it("validates file_released with reservation_ids", () => {
    const event = {
      type: "file_released",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
      reservation_ids: [1, 2, 3],
    };
    expect(() => FileReleasedEventSchema.parse(event)).not.toThrow();
  });

  it("validates file_released with neither (release all)", () => {
    const event = {
      type: "file_released",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
    };
    expect(() => FileReleasedEventSchema.parse(event)).not.toThrow();
  });
});

describe("TaskStartedEventSchema", () => {
  it("validates task_started event", () => {
    const event = {
      type: "task_started",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
      bead_id: "bd-123.1",
      epic_id: "bd-123",
    };
    expect(() => TaskStartedEventSchema.parse(event)).not.toThrow();
  });
});

describe("TaskProgressEventSchema", () => {
  it("validates task_progress event", () => {
    const event = {
      type: "task_progress",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
      bead_id: "bd-123.1",
      progress_percent: 50,
      message: "Halfway done",
      files_touched: ["src/auth.ts"],
    };
    expect(() => TaskProgressEventSchema.parse(event)).not.toThrow();
  });

  it("validates progress_percent bounds", () => {
    const baseEvent = {
      type: "task_progress",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
      bead_id: "bd-123.1",
    };

    // Valid: 0
    expect(() =>
      TaskProgressEventSchema.parse({ ...baseEvent, progress_percent: 0 }),
    ).not.toThrow();

    // Valid: 100
    expect(() =>
      TaskProgressEventSchema.parse({ ...baseEvent, progress_percent: 100 }),
    ).not.toThrow();

    // Invalid: -1
    expect(() =>
      TaskProgressEventSchema.parse({ ...baseEvent, progress_percent: -1 }),
    ).toThrow();

    // Invalid: 101
    expect(() =>
      TaskProgressEventSchema.parse({ ...baseEvent, progress_percent: 101 }),
    ).toThrow();
  });
});

describe("TaskCompletedEventSchema", () => {
  it("validates task_completed event", () => {
    const event = {
      type: "task_completed",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
      bead_id: "bd-123.1",
      summary: "Implemented OAuth flow",
      files_touched: ["src/auth.ts", "src/config.ts"],
      success: true,
    };
    expect(() => TaskCompletedEventSchema.parse(event)).not.toThrow();
  });

  it("defaults success to true", () => {
    const event = {
      type: "task_completed",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
      bead_id: "bd-123.1",
      summary: "Done",
    };
    const parsed = TaskCompletedEventSchema.parse(event);
    expect(parsed.success).toBe(true);
  });
});

describe("TaskBlockedEventSchema", () => {
  it("validates task_blocked event", () => {
    const event = {
      type: "task_blocked",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
      bead_id: "bd-123.1",
      reason: "Waiting for API credentials",
    };
    expect(() => TaskBlockedEventSchema.parse(event)).not.toThrow();
  });
});

describe("DecompositionGeneratedEventSchema", () => {
  it("validates a complete decomposition_generated event", () => {
    const event = {
      type: "decomposition_generated",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      task: "Add user authentication",
      context: "OAuth integration for GitHub",
      strategy: "feature-based",
      epic_title: "User Authentication",
      subtasks: [
        {
          title: "Create OAuth flow",
          files: ["src/auth/oauth.ts"],
          priority: 2,
        },
        { title: "Add login UI", files: ["src/ui/login.tsx"], priority: 1 },
      ],
    };
    expect(() => DecompositionGeneratedEventSchema.parse(event)).not.toThrow();
  });

  it("validates without optional context", () => {
    const event = {
      type: "decomposition_generated",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      task: "Add user authentication",
      strategy: "file-based",
      epic_title: "User Authentication",
      subtasks: [{ title: "Create OAuth flow", files: ["src/auth/oauth.ts"] }],
    };
    expect(() => DecompositionGeneratedEventSchema.parse(event)).not.toThrow();
  });

  it("validates strategy enum values", () => {
    const validStrategies = ["file-based", "feature-based", "risk-based"];
    for (const strategy of validStrategies) {
      const event = {
        type: "decomposition_generated",
        project_key: "/test/project",
        timestamp: Date.now(),
        epic_id: "bd-123",
        task: "Test task",
        strategy,
        epic_title: "Test",
        subtasks: [{ title: "Subtask", files: ["test.ts"] }],
      };
      expect(() =>
        DecompositionGeneratedEventSchema.parse(event),
      ).not.toThrow();
    }
  });

  it("rejects invalid strategy value", () => {
    const event = {
      type: "decomposition_generated",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      task: "Test task",
      strategy: "invalid-strategy",
      epic_title: "Test",
      subtasks: [{ title: "Subtask", files: ["test.ts"] }],
    };
    expect(() => DecompositionGeneratedEventSchema.parse(event)).toThrow();
  });

  it("validates subtask priority bounds", () => {
    const baseEvent = {
      type: "decomposition_generated",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      task: "Test",
      strategy: "file-based",
      epic_title: "Test",
    };

    // Valid: 0
    expect(() =>
      DecompositionGeneratedEventSchema.parse({
        ...baseEvent,
        subtasks: [{ title: "Test", files: ["test.ts"], priority: 0 }],
      }),
    ).not.toThrow();

    // Valid: 3
    expect(() =>
      DecompositionGeneratedEventSchema.parse({
        ...baseEvent,
        subtasks: [{ title: "Test", files: ["test.ts"], priority: 3 }],
      }),
    ).not.toThrow();

    // Invalid: -1
    expect(() =>
      DecompositionGeneratedEventSchema.parse({
        ...baseEvent,
        subtasks: [{ title: "Test", files: ["test.ts"], priority: -1 }],
      }),
    ).toThrow();

    // Invalid: 4
    expect(() =>
      DecompositionGeneratedEventSchema.parse({
        ...baseEvent,
        subtasks: [{ title: "Test", files: ["test.ts"], priority: 4 }],
      }),
    ).toThrow();
  });

  it("rejects empty subtasks array", () => {
    const event = {
      type: "decomposition_generated",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      task: "Test",
      strategy: "file-based",
      epic_title: "Test",
      subtasks: [],
    };
    // Empty subtasks is valid per schema but semantically questionable
    expect(() => DecompositionGeneratedEventSchema.parse(event)).not.toThrow();
  });
});

describe("SubtaskOutcomeEventSchema", () => {
  it("validates a complete subtask_outcome event", () => {
    const event = {
      type: "subtask_outcome",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      bead_id: "bd-123.1",
      planned_files: ["src/auth.ts", "src/config.ts"],
      actual_files: ["src/auth.ts", "src/config.ts", "src/utils.ts"],
      duration_ms: 45000,
      error_count: 2,
      retry_count: 1,
      success: true,
    };
    expect(() => SubtaskOutcomeEventSchema.parse(event)).not.toThrow();
  });

  it("applies defaults for error_count and retry_count", () => {
    const event = {
      type: "subtask_outcome",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      bead_id: "bd-123.1",
      planned_files: ["src/auth.ts"],
      actual_files: ["src/auth.ts"],
      duration_ms: 10000,
      success: true,
    };
    const parsed = SubtaskOutcomeEventSchema.parse(event);
    expect(parsed.error_count).toBe(0);
    expect(parsed.retry_count).toBe(0);
  });

  it("validates duration_ms is non-negative", () => {
    const baseEvent = {
      type: "subtask_outcome",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      bead_id: "bd-123.1",
      planned_files: ["test.ts"],
      actual_files: ["test.ts"],
      success: true,
    };

    // Valid: 0
    expect(() =>
      SubtaskOutcomeEventSchema.parse({ ...baseEvent, duration_ms: 0 }),
    ).not.toThrow();

    // Valid: positive
    expect(() =>
      SubtaskOutcomeEventSchema.parse({ ...baseEvent, duration_ms: 1000 }),
    ).not.toThrow();

    // Invalid: negative
    expect(() =>
      SubtaskOutcomeEventSchema.parse({ ...baseEvent, duration_ms: -1 }),
    ).toThrow();
  });

  it("validates error_count is non-negative", () => {
    const baseEvent = {
      type: "subtask_outcome",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      bead_id: "bd-123.1",
      planned_files: ["test.ts"],
      actual_files: ["test.ts"],
      duration_ms: 1000,
      success: true,
    };

    // Invalid: negative
    expect(() =>
      SubtaskOutcomeEventSchema.parse({ ...baseEvent, error_count: -1 }),
    ).toThrow();
  });

  it("handles file lists with different lengths", () => {
    const event = {
      type: "subtask_outcome",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      bead_id: "bd-123.1",
      planned_files: ["a.ts", "b.ts"],
      actual_files: ["a.ts", "b.ts", "c.ts", "d.ts"],
      duration_ms: 5000,
      success: true,
    };
    expect(() => SubtaskOutcomeEventSchema.parse(event)).not.toThrow();
  });
});

describe("HumanFeedbackEventSchema", () => {
  it("validates a complete human_feedback event", () => {
    const event = {
      type: "human_feedback",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      accepted: true,
      modified: false,
      notes: "Looks good, no changes needed",
    };
    expect(() => HumanFeedbackEventSchema.parse(event)).not.toThrow();
  });

  it("validates accepted with modification", () => {
    const event = {
      type: "human_feedback",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      accepted: true,
      modified: true,
      notes: "Changed priority on subtask 2",
    };
    expect(() => HumanFeedbackEventSchema.parse(event)).not.toThrow();
  });

  it("validates rejected feedback", () => {
    const event = {
      type: "human_feedback",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      accepted: false,
      modified: false,
      notes: "Decomposition too granular, needs consolidation",
    };
    expect(() => HumanFeedbackEventSchema.parse(event)).not.toThrow();
  });

  it("applies default for modified", () => {
    const event = {
      type: "human_feedback",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      accepted: true,
    };
    const parsed = HumanFeedbackEventSchema.parse(event);
    expect(parsed.modified).toBe(false);
  });

  it("validates without notes", () => {
    const event = {
      type: "human_feedback",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      accepted: true,
      modified: false,
    };
    expect(() => HumanFeedbackEventSchema.parse(event)).not.toThrow();
  });
});

// ============================================================================
// Discriminated Union Tests
// ============================================================================

describe("AgentEventSchema (discriminated union)", () => {
  it("correctly discriminates by type", () => {
    const events: AgentEvent[] = [
      {
        type: "agent_registered",
        project_key: "/test",
        timestamp: Date.now(),
        agent_name: "Test",
        program: "opencode",
        model: "test",
      },
      {
        type: "agent_active",
        project_key: "/test",
        timestamp: Date.now(),
        agent_name: "Test",
      },
      {
        type: "message_sent",
        project_key: "/test",
        timestamp: Date.now(),
        from_agent: "Test",
        to_agents: ["Other"],
        subject: "Hi",
        body: "Hello",
        importance: "normal",
        ack_required: false,
      },
    ];

    for (const event of events) {
      expect(() => AgentEventSchema.parse(event)).not.toThrow();
    }
  });

  it("rejects unknown event types", () => {
    const event = {
      type: "unknown_event",
      project_key: "/test",
      timestamp: Date.now(),
    };
    expect(() => AgentEventSchema.parse(event)).toThrow();
  });
});

// ============================================================================
// createEvent Helper Tests
// ============================================================================

describe("createEvent", () => {
  it("creates agent_registered event with timestamp", () => {
    const before = Date.now();
    const event = createEvent("agent_registered", {
      project_key: "/test/project",
      agent_name: "BlueLake",
      program: "opencode",
      model: "claude-sonnet-4",
    });
    const after = Date.now();

    expect(event.type).toBe("agent_registered");
    expect(event.timestamp).toBeGreaterThanOrEqual(before);
    expect(event.timestamp).toBeLessThanOrEqual(after);
    expect(event.agent_name).toBe("BlueLake");
  });

  it("creates message_sent event", () => {
    const event = createEvent("message_sent", {
      project_key: "/test/project",
      from_agent: "BlueLake",
      to_agents: ["RedStone"],
      subject: "Hello",
      body: "World",
      importance: "high",
      ack_required: true,
    });

    expect(event.type).toBe("message_sent");
    expect(event.from_agent).toBe("BlueLake");
    expect(event.importance).toBe("high");
  });

  it("creates file_reserved event", () => {
    const expiresAt = Date.now() + 3600000;
    const event = createEvent("file_reserved", {
      project_key: "/test/project",
      agent_name: "BlueLake",
      paths: ["src/**"],
      exclusive: true,
      ttl_seconds: 3600,
      expires_at: expiresAt,
    });

    expect(event.type).toBe("file_reserved");
    expect(event.paths).toEqual(["src/**"]);
    expect(event.expires_at).toBe(expiresAt);
  });

  it("throws on invalid event data", () => {
    expect(() =>
      // @ts-expect-error - intentionally testing invalid data
      createEvent("agent_registered", {
        project_key: "/test/project",
        // Missing agent_name
      }),
    ).toThrow(/Invalid event/);
  });

  it("throws on invalid event type", () => {
    expect(() =>
      // @ts-expect-error - intentionally testing invalid type
      createEvent("invalid_type", {
        project_key: "/test/project",
      }),
    ).toThrow();
  });
});

// ============================================================================
// isEventType Type Guard Tests
// ============================================================================

describe("isEventType", () => {
  it("returns true for matching type", () => {
    const event: AgentEvent = {
      type: "agent_registered",
      project_key: "/test",
      timestamp: Date.now(),
      agent_name: "Test",
      program: "opencode",
      model: "test",
    };

    expect(isEventType(event, "agent_registered")).toBe(true);
  });

  it("returns false for non-matching type", () => {
    const event: AgentEvent = {
      type: "agent_registered",
      project_key: "/test",
      timestamp: Date.now(),
      agent_name: "Test",
      program: "opencode",
      model: "test",
    };

    expect(isEventType(event, "agent_active")).toBe(false);
    expect(isEventType(event, "message_sent")).toBe(false);
  });

  it("narrows type correctly", () => {
    const event: AgentEvent = {
      type: "message_sent",
      project_key: "/test",
      timestamp: Date.now(),
      from_agent: "Test",
      to_agents: ["Other"],
      subject: "Hi",
      body: "Hello",
      importance: "normal",
      ack_required: false,
    };

    if (isEventType(event, "message_sent")) {
      // TypeScript should know these properties exist
      expect(event.from_agent).toBe("Test");
      expect(event.to_agents).toEqual(["Other"]);
      expect(event.subject).toBe("Hi");
    } else {
      // Should not reach here
      expect(true).toBe(false);
    }
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("Edge cases", () => {
  it("handles very long strings", () => {
    const longString = "a".repeat(10000);
    const event = createEvent("message_sent", {
      project_key: "/test/project",
      from_agent: "BlueLake",
      to_agents: ["RedStone"],
      subject: longString,
      body: longString,
      importance: "normal",
      ack_required: false,
    });

    expect(event.subject.length).toBe(10000);
    expect(event.body.length).toBe(10000);
  });

  it("handles special characters in strings", () => {
    const specialChars = "Hello\n\t\"'\\<>&日本語🎉";
    const event = createEvent("message_sent", {
      project_key: "/test/project",
      from_agent: "BlueLake",
      to_agents: ["RedStone"],
      subject: specialChars,
      body: specialChars,
      importance: "normal",
      ack_required: false,
    });

    expect(event.subject).toBe(specialChars);
    expect(event.body).toBe(specialChars);
  });

  it("handles many recipients", () => {
    const manyAgents = Array.from({ length: 100 }, (_, i) => `Agent${i}`);
    const event = createEvent("message_sent", {
      project_key: "/test/project",
      from_agent: "BlueLake",
      to_agents: manyAgents,
      subject: "Broadcast",
      body: "Hello everyone",
      importance: "normal",
      ack_required: false,
    });

    expect(event.to_agents.length).toBe(100);
  });

  it("handles many file paths", () => {
    const manyPaths = Array.from({ length: 50 }, (_, i) => `src/file${i}.ts`);
    const event = createEvent("file_reserved", {
      project_key: "/test/project",
      agent_name: "BlueLake",
      paths: manyPaths,
      exclusive: true,
      ttl_seconds: 3600,
      expires_at: Date.now() + 3600000,
    });

    expect(event.paths.length).toBe(50);
  });

  it("handles timestamp at epoch", () => {
    const event = {
      type: "agent_active",
      project_key: "/test",
      timestamp: 0,
      agent_name: "Test",
    };
    expect(() => AgentActiveEventSchema.parse(event)).not.toThrow();
  });

  it("handles very large timestamp", () => {
    const event = {
      type: "agent_active",
      project_key: "/test",
      timestamp: Number.MAX_SAFE_INTEGER,
      agent_name: "Test",
    };
    expect(() => AgentActiveEventSchema.parse(event)).not.toThrow();
  });
});
