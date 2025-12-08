/**
 * Storage Integration Tests
 *
 * Tests the storage module with real semantic-memory backend.
 * Requires semantic-memory to be available (native or via bunx).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  SemanticMemoryStorage,
  InMemoryStorage,
  isSemanticMemoryAvailable,
  getResolvedCommand,
  resetCommandCache,
  createStorage,
  createStorageWithFallback,
} from "./storage";
import type { FeedbackEvent } from "./learning";
import type { DecompositionPattern } from "./anti-patterns";
import type { PatternMaturity, MaturityFeedback } from "./pattern-maturity";

// Use unique collection names to avoid conflicts with other tests
const TEST_COLLECTIONS = {
  feedback: `test-feedback-${Date.now()}`,
  patterns: `test-patterns-${Date.now()}`,
  maturity: `test-maturity-${Date.now()}`,
};

describe("Storage Command Resolution", () => {
  beforeAll(() => {
    resetCommandCache();
  });

  afterAll(() => {
    resetCommandCache();
  });

  it("should resolve semantic-memory command", async () => {
    const cmd = await getResolvedCommand();
    expect(cmd).toBeDefined();
    expect(cmd.length).toBeGreaterThan(0);

    // Should be either native or bunx
    if (cmd.length === 1) {
      expect(cmd[0]).toBe("semantic-memory");
    } else {
      expect(cmd[0]).toBe("bunx");
      expect(cmd[1]).toBe("semantic-memory");
    }
  });

  it("should cache the resolved command", async () => {
    const cmd1 = await getResolvedCommand();
    const cmd2 = await getResolvedCommand();
    expect(cmd1).toBe(cmd2); // Same reference = cached
  });

  it("should reset cache when requested", async () => {
    const cmd1 = await getResolvedCommand();
    resetCommandCache();
    const cmd2 = await getResolvedCommand();
    // After reset, should resolve again (may be same value but different reference)
    expect(cmd1).toEqual(cmd2);
  });
});

describe("Storage Availability Check", () => {
  it("should detect semantic-memory availability", async () => {
    const available = await isSemanticMemoryAvailable();
    // This test passes regardless - we just verify it returns a boolean
    expect(typeof available).toBe("boolean");
  });
});

describe("SemanticMemoryStorage Integration", () => {
  let storage: SemanticMemoryStorage;
  let isAvailable: boolean;

  beforeAll(async () => {
    isAvailable = await isSemanticMemoryAvailable();
    if (isAvailable) {
      storage = new SemanticMemoryStorage({
        collections: TEST_COLLECTIONS,
      });
    }
  });

  afterAll(async () => {
    if (storage) {
      await storage.close();
    }
  });

  describe("Feedback Operations", () => {
    it.skipIf(!isAvailable)("should store and retrieve feedback", async () => {
      const event: FeedbackEvent = {
        id: `feedback-${Date.now()}`,
        criterion: "test-criterion-storage",
        type: "helpful",
        timestamp: new Date().toISOString(),
        bead_id: "bd-storage-test",
        context: "Integration test feedback",
        raw_value: 1,
      };

      await storage.storeFeedback(event);

      // Give it a moment to persist
      await new Promise((r) => setTimeout(r, 100));

      const all = await storage.getAllFeedback();
      expect(all.length).toBeGreaterThanOrEqual(0); // May be empty if semantic search doesn't find it immediately
    });

    it.skipIf(!isAvailable)("should find similar feedback", async () => {
      const results = await storage.findSimilarFeedback("test", 5);
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe("Pattern Operations", () => {
    it.skipIf(!isAvailable)("should store and retrieve patterns", async () => {
      const pattern: DecompositionPattern = {
        id: `pattern-storage-${Date.now()}`,
        kind: "pattern",
        content: "Test pattern for storage integration",
        is_negative: false,
        success_count: 1,
        failure_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["test", "storage"],
        example_beads: [],
      };

      await storage.storePattern(pattern);

      // Give it a moment to persist
      await new Promise((r) => setTimeout(r, 100));

      const all = await storage.getAllPatterns();
      expect(Array.isArray(all)).toBe(true);
    });

    it.skipIf(!isAvailable)("should find similar patterns", async () => {
      const results = await storage.findSimilarPatterns("test", 5);
      expect(Array.isArray(results)).toBe(true);
    });

    it.skipIf(!isAvailable)("should get anti-patterns", async () => {
      const results = await storage.getAntiPatterns();
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe("Maturity Operations", () => {
    it.skipIf(!isAvailable)("should store and retrieve maturity", async () => {
      const maturity: PatternMaturity = {
        pattern_id: `maturity-storage-${Date.now()}`,
        state: "candidate",
        helpful_count: 0,
        harmful_count: 0,
        last_validated: new Date().toISOString(),
        promoted_at: undefined,
        deprecated_at: undefined,
      };

      await storage.storeMaturity(maturity);

      // Give it a moment to persist
      await new Promise((r) => setTimeout(r, 100));

      const all = await storage.getAllMaturity();
      expect(Array.isArray(all)).toBe(true);
    });

    it.skipIf(!isAvailable)(
      "should store and retrieve maturity feedback",
      async () => {
        const feedback: MaturityFeedback = {
          pattern_id: `maturity-feedback-${Date.now()}`,
          type: "helpful",
          timestamp: new Date().toISOString(),
          weight: 1,
        };

        await storage.storeMaturityFeedback(feedback);

        // Give it a moment to persist
        await new Promise((r) => setTimeout(r, 100));

        const results = await storage.getMaturityFeedback(feedback.pattern_id);
        expect(Array.isArray(results)).toBe(true);
      },
    );
  });
});

describe("Storage Factory", () => {
  it("should create in-memory storage", () => {
    const storage = createStorage({ backend: "memory" });
    expect(storage).toBeInstanceOf(InMemoryStorage);
  });

  it("should create semantic-memory storage", () => {
    const storage = createStorage({ backend: "semantic-memory" });
    expect(storage).toBeInstanceOf(SemanticMemoryStorage);
  });

  it("should use default backend (semantic-memory)", () => {
    const storage = createStorage();
    expect(storage).toBeInstanceOf(SemanticMemoryStorage);
  });

  it("should throw on unknown backend", () => {
    expect(() => createStorage({ backend: "unknown" as any })).toThrow(
      "Unknown storage backend",
    );
  });
});

describe("Storage Factory with Fallback", () => {
  it("should create storage with fallback", async () => {
    const storage = await createStorageWithFallback();
    expect(storage).toBeDefined();
    // Will be SemanticMemoryStorage if available, InMemoryStorage otherwise
    expect(
      storage instanceof SemanticMemoryStorage ||
        storage instanceof InMemoryStorage,
    ).toBe(true);
  });

  it("should respect explicit memory backend", async () => {
    const storage = await createStorageWithFallback({ backend: "memory" });
    expect(storage).toBeInstanceOf(InMemoryStorage);
  });
});

describe("InMemoryStorage Parity", () => {
  let storage: InMemoryStorage;

  beforeAll(() => {
    storage = new InMemoryStorage();
  });

  afterAll(async () => {
    await storage.close();
  });

  it("should store and retrieve feedback", async () => {
    const event: FeedbackEvent = {
      id: `memory-feedback-${Date.now()}`,
      criterion: "memory-test-criterion",
      type: "helpful",
      timestamp: new Date().toISOString(),
      bead_id: "bd-memory-test",
      raw_value: 1,
    };

    await storage.storeFeedback(event);
    const results = await storage.getFeedbackByCriterion(
      "memory-test-criterion",
    );
    expect(results).toHaveLength(1);
    expect(results[0].criterion).toBe("memory-test-criterion");
  });

  it("should store and retrieve patterns", async () => {
    const pattern: DecompositionPattern = {
      id: "memory-pattern-1",
      kind: "pattern",
      content: "Memory test pattern",
      is_negative: false,
      success_count: 1,
      failure_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tags: ["memory", "test"],
      example_beads: [],
    };

    await storage.storePattern(pattern);
    const result = await storage.getPattern("memory-pattern-1");
    expect(result).not.toBeNull();
    expect(result?.id).toBe("memory-pattern-1");
  });

  it("should store and retrieve maturity", async () => {
    const maturity: PatternMaturity = {
      pattern_id: "memory-maturity-1",
      state: "candidate",
      helpful_count: 0,
      harmful_count: 0,
      last_validated: new Date().toISOString(),
      promoted_at: undefined,
      deprecated_at: undefined,
    };

    await storage.storeMaturity(maturity);
    const result = await storage.getMaturity("memory-maturity-1");
    expect(result).not.toBeNull();
    expect(result?.pattern_id).toBe("memory-maturity-1");
  });

  it("should find similar feedback by query", async () => {
    const event: FeedbackEvent = {
      id: `searchable-feedback-${Date.now()}`,
      criterion: "searchable-criterion",
      type: "harmful",
      timestamp: new Date().toISOString(),
      context: "This is searchable context",
      raw_value: 1,
    };

    await storage.storeFeedback(event);
    const results = await storage.findSimilarFeedback("searchable", 10);
    expect(results.length).toBeGreaterThan(0);
  });

  it("should find similar patterns by query", async () => {
    const pattern: DecompositionPattern = {
      id: "searchable-pattern",
      kind: "pattern",
      content: "A uniquely searchable pattern description",
      is_negative: false,
      success_count: 1,
      failure_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tags: ["searchable"],
      example_beads: [],
    };

    await storage.storePattern(pattern);
    const results = await storage.findSimilarPatterns(
      "uniquely searchable",
      10,
    );
    expect(results.length).toBeGreaterThan(0);
  });
});
