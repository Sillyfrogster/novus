import { describe, expect, test } from "bun:test";
import { findEmptyCatchBlocks } from "../scripts/check-empty-catch";

describe("findEmptyCatchBlocks", () => {
  test("flags a try-catch with an empty catch body", () => {
    const source = "try {\n  work();\n} catch {}\n";
    expect(findEmptyCatchBlocks(source)).toEqual([3]);
  });

  test("flags a catch whose body holds only a comment", () => {
    const source = "try {\n  work();\n} catch {\n  // ignored on purpose\n}\n";
    expect(findEmptyCatchBlocks(source)).toEqual([3]);
  });

  test("flags a promise catch arrow with an empty block body", () => {
    const source = "p.catch(() => {});\n";
    expect(findEmptyCatchBlocks(source)).toEqual([1]);
  });

  test("flags a promise catch arrow whose block holds only a comment", () => {
    const source = "p.catch(() => {\n  // ignored on purpose\n});\n";
    expect(findEmptyCatchBlocks(source)).toEqual([1]);
  });

  test("does not flag a catch body that logs the error", () => {
    const source = 'try {\n  work();\n} catch (error) {\n  console.warn("x", error);\n}\n';
    expect(findEmptyCatchBlocks(source)).toEqual([]);
  });

  test("does not flag a promise catch with an expression body", () => {
    const source = 'p.catch((e) => console.warn("x", e));\n';
    expect(findEmptyCatchBlocks(source)).toEqual([]);
  });

  test("does not flag a catch whose body is a return statement", () => {
    const source = "try {\n  work();\n} catch {\n  return null;\n}\n";
    expect(findEmptyCatchBlocks(source)).toEqual([]);
  });

  test("does not flag catch text inside a string literal", () => {
    const source = 'const sample = "try {} catch {}";\n';
    expect(findEmptyCatchBlocks(source)).toEqual([]);
  });
});
