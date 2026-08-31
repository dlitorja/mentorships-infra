import { describe, expect, test } from "vitest";
import path from "path";
import fs from "fs";

function readPackageJson(filePath: string): { dependencies?: Record<string, string> } {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

describe("huckleberry-drive convex version alignment", () => {
  test("huckleberry-drive convex version matches the root workspace", () => {
    const root = readPackageJson(path.resolve(__dirname, "../../package.json"));
    const app = readPackageJson(path.resolve(__dirname, "./package.json"));

    const rootVersion = root.dependencies?.convex;
    const appVersion = app.dependencies?.convex;

    expect(rootVersion).toBeDefined();
    expect(appVersion).toBeDefined();
    expect(appVersion).toBe(rootVersion);
  });
});
