// SPDX-License-Identifier: Apache-2.0
import { readFile, rename, writeFile } from "node:fs/promises";
import { acquireProjectMutationLock, withProjectMutation } from "../project-lock.js";

const [, , command, projectPath, iterationValue] = process.argv;
const lockOptions = {
  timeoutMs: 5_000,
  staleAfterMs: 5_000,
  retryDelayMs: 10,
  heartbeatMs: 1_000,
};

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function holdLock(path: string): Promise<void> {
  await acquireProjectMutationLock(path, lockOptions);
  process.stdout.write("acquired\n");
  setInterval(() => undefined, 1_000);
}

async function incrementCounter(path: string, iterations: number): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await withProjectMutation(path, async () => {
      const current = Number(await readFile(path, "utf8"));
      if (!Number.isSafeInteger(current)) throw new Error(`Invalid counter value: ${current}`);
      await delay(5);
      const temporaryPath = `${path}.${process.pid}.${index}.tmp`;
      await writeFile(temporaryPath, `${current + 1}\n`, "utf8");
      await rename(temporaryPath, path);
    }, lockOptions);
  }
}

async function main(): Promise<void> {
  if (!projectPath) throw new Error("A project path is required");
  if (command === "hold") {
    await holdLock(projectPath);
    return;
  }
  if (command === "increment") {
    const iterations = Number(iterationValue);
    if (!Number.isSafeInteger(iterations) || iterations < 1) {
      throw new Error(`Invalid iteration count: ${iterationValue}`);
    }
    await incrementCounter(projectPath, iterations);
    return;
  }
  throw new Error(`Unknown child command: ${command}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
