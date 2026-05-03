import { describe, it, expect, beforeAll, afterAll } from "vitest";

const API_BASE = process.env.API_BASE || "http://localhost:8898";
const API_KEY = process.env.API_KEY || "";

const headers: Record<string, string> = {
  "Content-Type": "application/json",
};

if (API_KEY) {
  headers["Authorization"] = `Bearer ${API_KEY}`;
}

describe("Health Check API", () => {
  it("should return health status", async () => {
    const response = await fetch(`${API_BASE}/api/health`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.status).toBe("ok");
    expect(data.data.version).toBeDefined();
    expect(data.data.timestamp).toBeDefined();
  });
});

describe("Storage API", () => {
  it("should return storage status", async () => {
    const response = await fetch(`${API_BASE}/api/storage`, { headers });

    if (response.status === 401) {
      console.warn("Skipping test: API key required");
      return;
    }

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.total_bytes).toBeGreaterThan(0);
    expect(data.data.used_bytes).toBeGreaterThanOrEqual(0);
    expect(data.data.free_bytes).toBeGreaterThanOrEqual(0);
    expect(data.data.usage_percent).toBeGreaterThanOrEqual(0);
    expect(data.data.task_count).toBeGreaterThanOrEqual(0);
    expect(data.data.file_count).toBeGreaterThanOrEqual(0);
  });

  it("should update storage config", async () => {
    const response = await fetch(`${API_BASE}/api/storage`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        auto_cleanup: true,
        auto_cleanup_days: 14,
      }),
    });

    if (response.status === 401) {
      console.warn("Skipping test: API key required");
      return;
    }

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.auto_cleanup).toBe(true);
    expect(data.data.auto_cleanup_days).toBe(14);
  });
});

describe("Task API", () => {
  let testTaskId: string | null = null;

  it("should create a batch task", async () => {
    const response = await fetch(`${API_BASE}/api/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Test Batch",
        urls: [
          "https://www.bilibili.com/video/BV1xx411c7mD",
          "https://www.bilibili.com/video/BV1yy411c7mE",
        ],
      }),
    });

    if (response.status === 401) {
      console.warn("Skipping test: API key required");
      return;
    }

    expect(response.status).toBe(201);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.task_id).toBeDefined();
    expect(data.data.name).toBe("Test Batch");
    expect(data.data.total).toBe(2);
    expect(data.data.status).toBe("pending");

    testTaskId = data.data.task_id;
  });

  it("should list tasks", async () => {
    const response = await fetch(`${API_BASE}/api/tasks?limit=10&offset=0`, {
      headers,
    });

    if (response.status === 401) {
      console.warn("Skipping test: API key required");
      return;
    }

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(Array.isArray(data.data.tasks)).toBe(true);
    expect(typeof data.data.total).toBe("number");
    expect(data.data.limit).toBe(10);
    expect(data.data.offset).toBe(0);
  });

  it("should get task details", async () => {
    if (!testTaskId) {
      console.warn("Skipping test: No test task created");
      return;
    }

    const response = await fetch(`${API_BASE}/api/tasks/${testTaskId}`, {
      headers,
    });

    if (response.status === 401) {
      console.warn("Skipping test: API key required");
      return;
    }

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.task_id).toBe(testTaskId);
    expect(data.data.items).toBeDefined();
    expect(Array.isArray(data.data.items)).toBe(true);
  });

  it("should filter tasks by status", async () => {
    const response = await fetch(`${API_BASE}/api/tasks?status=pending`, {
      headers,
    });

    if (response.status === 401) {
      console.warn("Skipping test: API key required");
      return;
    }

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);

    for (const task of data.data.tasks) {
      expect(task.status).toBe("pending");
    }
  });

  it("should delete a task", async () => {
    if (!testTaskId) {
      console.warn("Skipping test: No test task created");
      return;
    }

    const response = await fetch(`${API_BASE}/api/tasks/${testTaskId}`, {
      method: "DELETE",
      headers,
    });

    if (response.status === 401) {
      console.warn("Skipping test: API key required");
      return;
    }

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.task_id).toBe(testTaskId);
    expect(data.data.deleted).toBe(true);
  });

  it("should return 404 for non-existent task", async () => {
    const response = await fetch(`${API_BASE}/api/tasks/non_existent_task`, {
      headers,
    });

    if (response.status === 401) {
      console.warn("Skipping test: API key required");
      return;
    }

    expect(response.status).toBe(404);

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  });
});

describe("Download API", () => {
  it("should validate URL in download request", async () => {
    const response = await fetch(`${API_BASE}/api/download`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        url: "invalid-url",
      }),
    });

    if (response.status === 401) {
      console.warn("Skipping test: API key required");
      return;
    }

    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.success).toBe(false);
  });

  it("should require URL in download request", async () => {
    const response = await fetch(`${API_BASE}/api/download`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });

    if (response.status === 401) {
      console.warn("Skipping test: API key required");
      return;
    }

    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.success).toBe(false);
  });
});

describe("Authentication", () => {
  it("should work without auth when PRIVATE_KEY is not set", async () => {
    const response = await fetch(`${API_BASE}/api/health`);
    expect(response.status).toBe(200);
  });

  it("should accept Bearer token authentication", async () => {
    if (!API_KEY) {
      console.warn("Skipping test: No API key provided");
      return;
    }

    const response = await fetch(`${API_BASE}/api/storage`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    });

    expect(response.status).toBe(200);
  });

  it("should accept X-API-Key header authentication", async () => {
    if (!API_KEY) {
      console.warn("Skipping test: No API key provided");
      return;
    }

    const response = await fetch(`${API_BASE}/api/storage`, {
      headers: {
        "X-API-Key": API_KEY,
      },
    });

    expect(response.status).toBe(200);
  });

  it("should accept query parameter authentication", async () => {
    if (!API_KEY) {
      console.warn("Skipping test: No API key provided");
      return;
    }

    const response = await fetch(`${API_BASE}/api/storage?key=${API_KEY}`);

    expect(response.status).toBe(200);
  });
});

describe("Task Cleanup API", () => {
  it("should cleanup tasks", async () => {
    const response = await fetch(`${API_BASE}/api/tasks/cleanup`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        before: new Date().toISOString(),
        status: ["completed", "failed"],
      }),
    });

    if (response.status === 401) {
      console.warn("Skipping test: API key required");
      return;
    }

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(typeof data.data.deleted_count).toBe("number");
    expect(typeof data.data.freed_bytes).toBe("number");
  });
});
