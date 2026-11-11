import { describe, expect, it } from "vitest";
import { csvCell, generateLinksCsv, uniqueArchiveName } from "./export-csv";

describe("csvCell", () => {
  it("leaves plain values untouched", () => {
    expect(csvCell("Portfolio")).toBe("Portfolio");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes values containing commas, quotes, or newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("neutralises spreadsheet formulas", () => {
    expect(csvCell('=HYPERLINK("http://evil","click")')).toBe(
      '"\'=HYPERLINK(""http://evil"",""click"")"'
    );
    expect(csvCell("+15551234567")).toBe("'+15551234567");
    expect(csvCell("-1+1")).toBe("'-1+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });
});

describe("generateLinksCsv", () => {
  it("emits a UTF-8 BOM, a header row, and one row per link", () => {
    const csv = generateLinksCsv([
      {
        url: "https://example.com/a",
        title: "Portfolio",
        createdBy: "user_123",
        createdAt: Date.UTC(2026, 0, 2),
      },
      {
        url: "https://example.com/b",
        createdBy: "user_456",
        sessionId: "session_1",
        createdAt: Date.UTC(2026, 0, 3),
      },
    ]);

    expect(csv.startsWith("\uFEFF")).toBe(true);
    const lines = csv.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe("title,url,added_by,added_at,shared_in_call");
    expect(lines[1]).toBe(
      "Portfolio,https://example.com/a,user_123,2026-01-02T00:00:00.000Z,no"
    );
    expect(lines[2]).toBe(
      ",https://example.com/b,user_456,2026-01-03T00:00:00.000Z,yes"
    );
  });

  it("handles an empty link list without crashing", () => {
    const csv = generateLinksCsv([]);
    expect(csv.slice(1).trimEnd()).toBe("title,url,added_by,added_at,shared_in_call");
  });
});

describe("uniqueArchiveName", () => {
  it("suffixes duplicates instead of overwriting them", () => {
    const used = new Set<string>();
    expect(uniqueArchiveName("sketch.png", used)).toBe("sketch.png");
    expect(uniqueArchiveName("sketch.png", used)).toBe("sketch-2.png");
    expect(uniqueArchiveName("sketch.png", used)).toBe("sketch-3.png");
    expect(uniqueArchiveName("other.jpg", used)).toBe("other.jpg");
  });

  it("handles extension-less names", () => {
    const used = new Set<string>();
    expect(uniqueArchiveName("README", used)).toBe("README");
    expect(uniqueArchiveName("README", used)).toBe("README-2");
  });
});
