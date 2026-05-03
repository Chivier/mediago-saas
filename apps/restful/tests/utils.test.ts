import { describe, it, expect } from "vitest";
import {
  success,
  error,
  formatBytes,
  generateTaskId,
  parseUrls,
  isValidUrl,
  parseCsv,
  parseJsonUrls,
  detectFileTypeAndParse,
} from "../src/utils";

describe("Response Helpers", () => {
  it("should create success response", () => {
    const data = { foo: "bar" };
    const response = success(data);

    expect(response.success).toBe(true);
    expect(response.data).toEqual(data);
    expect(response.error).toBeUndefined();
  });

  it("should create error response", () => {
    const response = error("Something went wrong", "invalid_url", 400);

    expect(response.success).toBe(false);
    expect(response.error).toBe("Something went wrong");
    expect(response.code).toBe(400);
  });
});

describe("formatBytes", () => {
  it("should format 0 bytes", () => {
    expect(formatBytes(0)).toBe("0 Bytes");
  });

  it("should format bytes correctly", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1048576)).toBe("1 MB");
    expect(formatBytes(1073741824)).toBe("1 GB");
  });

  it("should handle decimal places", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1572864)).toBe("1.5 MB");
  });
});

describe("generateTaskId", () => {
  it("should generate unique task IDs", () => {
    const id1 = generateTaskId();
    const id2 = generateTaskId();

    expect(id1).not.toBe(id2);
    expect(id1.startsWith("t_")).toBe(true);
    expect(id2.startsWith("t_")).toBe(true);
  });
});

describe("isValidUrl", () => {
  it("should validate valid URLs", () => {
    expect(isValidUrl("https://example.com")).toBe(true);
    expect(isValidUrl("http://example.com/path")).toBe(true);
    expect(isValidUrl("https://www.bilibili.com/video/BV1xx411c7mD")).toBe(true);
  });

  it("should reject invalid URLs", () => {
    expect(isValidUrl("not-a-url")).toBe(false);
    expect(isValidUrl("ftp://example.com")).toBe(false);
    expect(isValidUrl("")).toBe(false);
  });
});

describe("parseUrls", () => {
  it("should parse URLs from text", () => {
    const content = `
      https://example.com/video1
      https://example.com/video2
      invalid-url
      https://example.com/video3
    `;

    const urls = parseUrls(content);

    expect(urls).toHaveLength(3);
    expect(urls[0]).toBe("https://example.com/video1");
    expect(urls[1]).toBe("https://example.com/video2");
    expect(urls[2]).toBe("https://example.com/video3");
  });

  it("should handle empty content", () => {
    expect(parseUrls("")).toHaveLength(0);
    expect(parseUrls("   \n  \n  ")).toHaveLength(0);
  });
});

describe("parseCsv", () => {
  it("should parse CSV with url column", () => {
    const content = `url,title
https://example.com/video1,Video 1
https://example.com/video2,Video 2`;

    const urls = parseCsv(content);

    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe("https://example.com/video1");
    expect(urls[1]).toBe("https://example.com/video2");
  });

  it("should parse CSV without header", () => {
    const content = `https://example.com/video1
https://example.com/video2`;

    const urls = parseCsv(content);

    expect(urls).toHaveLength(2);
  });

  it("should handle quoted values", () => {
    const content = `url,title
"https://example.com/video1","Video 1"
'https://example.com/video2','Video 2'`;

    const urls = parseCsv(content);

    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe("https://example.com/video1");
  });
});

describe("parseJsonUrls", () => {
  it("should parse array of strings", () => {
    const content = JSON.stringify([
      "https://example.com/video1",
      "https://example.com/video2",
    ]);

    const urls = parseJsonUrls(content);

    expect(urls).toHaveLength(2);
  });

  it("should parse array of objects with url property", () => {
    const content = JSON.stringify([
      { url: "https://example.com/video1", title: "Video 1" },
      { url: "https://example.com/video2", title: "Video 2" },
    ]);

    const urls = parseJsonUrls(content);

    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe("https://example.com/video1");
  });

  it("should handle invalid JSON", () => {
    const urls = parseJsonUrls("not valid json");
    expect(urls).toHaveLength(0);
  });

  it("should filter out invalid URLs", () => {
    const content = JSON.stringify([
      "https://example.com/video1",
      "invalid-url",
      "https://example.com/video2",
    ]);

    const urls = parseJsonUrls(content);

    expect(urls).toHaveLength(2);
  });
});

describe("detectFileTypeAndParse", () => {
  it("should detect and parse txt files", () => {
    const content = `https://example.com/video1
https://example.com/video2`;

    const urls = detectFileTypeAndParse(content, "urls.txt");

    expect(urls).toHaveLength(2);
  });

  it("should detect and parse csv files", () => {
    const content = `url
https://example.com/video1
https://example.com/video2`;

    const urls = detectFileTypeAndParse(content, "urls.csv");

    expect(urls).toHaveLength(2);
  });

  it("should detect and parse json files", () => {
    const content = JSON.stringify([
      "https://example.com/video1",
      "https://example.com/video2",
    ]);

    const urls = detectFileTypeAndParse(content, "urls.json");

    expect(urls).toHaveLength(2);
  });

  it("should default to txt parsing for unknown extensions", () => {
    const content = `https://example.com/video1
https://example.com/video2`;

    const urls = detectFileTypeAndParse(content, "urls.unknown");

    expect(urls).toHaveLength(2);
  });
});
