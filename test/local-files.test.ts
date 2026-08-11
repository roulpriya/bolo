import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import { LocalFiles } from "../src/main/agent/local-files.ts";

async function withFiles(callback) {
  const cwd = await mkdtemp(path.join(tmpdir(), "bolo-files-"));
  try {
    await callback(
      new LocalFiles({ cwd, signal: new AbortController().signal }),
      cwd
    );
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
}

test("reads numbered file ranges and writes new workspace files", async () => {
  await withFiles(async (files, cwd) => {
    await files.write({
      content: "one\ntwo\nthree",
      filePath: "nested/example.txt",
    });
    assert.equal(
      await readFile(path.join(cwd, "nested/example.txt"), "utf8"),
      "one\ntwo\nthree"
    );
    const result = await files.read({
      filePath: "nested/example.txt",
      limit: 1,
      offset: 2,
    });
    assert.equal(result.content, "    2 | two");
    assert.equal(result.truncated, true);
  });
});

test("edits one exact match and rejects ambiguous matches", async () => {
  await withFiles(async (files) => {
    await files.write({
      content: "before target after",
      filePath: "example.txt",
    });
    await files.edit({
      filePath: "example.txt",
      newText: "replacement",
      oldText: "target",
    });
    assert.equal(
      (await files.read({ filePath: "example.txt" })).content,
      "    1 | before replacement after"
    );
    await assert.rejects(
      () => files.edit({ filePath: "example.txt", newText: "x", oldText: "e" }),
      /more than once/i
    );
  });
});

test("does not expose paths outside the workspace or sensitive files", async () => {
  await withFiles(async (files, cwd) => {
    await writeFile(path.join(cwd, ".env"), "SECRET=value");
    await assert.rejects(() => files.read({ filePath: ".env" }), /credential/i);
    await assert.rejects(
      () => files.write({ content: "no", filePath: "../escape.txt" }),
      /workspace/i
    );
  });
});

test("does not follow symlinks outside the workspace", async () => {
  await withFiles(async (files, cwd) => {
    const outside = await mkdtemp(path.join(tmpdir(), "bolo-outside-"));
    try {
      await writeFile(path.join(outside, "secret.txt"), "nope");
      await mkdir(path.join(cwd, "links"));
      await symlink(
        path.join(outside, "secret.txt"),
        path.join(cwd, "links/secret.txt")
      );
      await assert.rejects(
        () => files.read({ filePath: "links/secret.txt" }),
        /workspace/i
      );
    } finally {
      await rm(outside, { force: true, recursive: true });
    }
  });
});
