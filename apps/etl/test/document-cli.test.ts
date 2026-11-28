import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const run = promisify(execFile);

it("returns an Obsidian-compatible result from the CLI with a local model and exact source text", async () => {
  const root = await mkdtemp(join(tmpdir(), "archivarious-cli-"));
  const quote = "Температура материала составляет 200 °C.";
  const models: string[] = [];
  const server = createServer(async (request, response) => {
    const buffers = [];
    for await (const buffer of request) buffers.push(buffer);
    const body = JSON.parse(Buffer.concat(buffers).toString());
    models.push(body.model);
    const { fragments } = JSON.parse(body.messages[1].content);
    response.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify({ claims: [{ text: quote, evidenceIds: [fragments[0].evidenceId] }] }) },
          },
        ],
      }),
    );
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const input = join(root, "Материал.txt");
    await writeFile(input, quote);
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const { stdout } = await run(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/cli.ts",
        "--input",
        input,
        "--output",
        join(root, "output"),
        "--provider",
        "local",
        "--model",
        "bonsai-2.5-27b",
        "--endpoint",
        endpoint,
        "--json-result",
      ],
      { cwd: fileURLToPath(new URL("../", import.meta.url)), timeout: 10000 },
    );
    const result = JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
    expect(result).toMatchObject({ status: "complete", note: "summary.md" });
    expect(models).toEqual(["bonsai-2.5-27b"]);
    expect(await readFile(join(result.directory, result.note), "utf8")).toContain(quote);
    expect(await readFile(join(result.directory, "original.txt"), "utf8")).toBe(quote);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}, 12000);
