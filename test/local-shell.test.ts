import assert from "node:assert/strict";
import { test } from "vitest";
import { LocalShell, shellRisk } from "../src/main/agent/local-shell.ts";

test("classifies routine, consequential, and catastrophic shell commands", () => {
  assert.equal(shellRisk(["pwd"]), "routine");
  assert.equal(shellRisk(["rm old.txt"]), "confirmation");
  assert.equal(shellRisk(["rm -rf /"]), "blocked");
  assert.equal(shellRisk(["security dump-keychain"]), "blocked");
});

test("runs bounded local commands and captures their output", async () => {
  const shell = new LocalShell({
    cwd: process.cwd(),
    signal: new AbortController().signal,
  });
  const result = await shell.run({
    commands: ["printf hello"],
    maxOutputLength: 100,
  });
  assert.equal(result.output[0].stdout, "hello");
  assert.deepEqual(result.output[0].outcome, {
    exitCode: 0,
    type: "exit",
  });
});

test("refuses catastrophic commands before spawning them", async () => {
  const shell = new LocalShell({
    cwd: process.cwd(),
    signal: new AbortController().signal,
  });
  await assert.rejects(() => shell.run({ commands: ["rm -rf /"] }), /blocked/i);
});
