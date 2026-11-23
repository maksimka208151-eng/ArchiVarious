import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { SourceDocument } from "@archivarious/core";
import { afterEach, describe, expect, it } from "vitest";
import { localEndpoint, sourceBatches, summarizeLocal } from "../src/local-summarize";

const source: SourceDocument = {
  schemaVersion: 1,
  id: "fixture",
  name: "fixture.pdf",
  mediaType: "application/pdf",
  sha256: "a".repeat(64),
  pageCount: 2,
  warnings: [],
  fragments: [
    { id: "p1-f1", page: 1, text: "Масса детали составляет 42 кг. Температура не превышает 80 градусов." },
    { id: "p2-f1", page: 2, text: "Допустима обработка только сухого материала при комнатной температуре." },
  ],
};
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});
async function serve(reply: (body: Record<string, unknown>) => unknown) {
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const result = await reply(JSON.parse(Buffer.concat(chunks).toString()));
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(result));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
}
function answer(fragmentId = "p1-f1", quote = source.fragments[0]?.text ?? "", reason = "stop") {
  return {
    choices: [
      {
        finish_reason: reason,
        message: {
          content: JSON.stringify({
            title: "Деталь",
            claims: [{ text: "Масса детали — 42 кг.", evidence: [{ fragmentId, quote }] }],
          }),
        },
      },
    ],
  };
}
describe("local summarization", () => {
  it("waits for delayed response headers within the configured model timeout", async () => {
    const endpoint = await serve(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
      return answer();
    });
    await expect(summarizeLocal(source, { endpoint, timeoutSeconds: 3 })).resolves.toHaveProperty("claims");
  });
  it("cancels slow generation and reports the configured timeout", async () => {
    const endpoint = await serve(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return answer();
    });
    await expect(summarizeLocal(source, { endpoint, timeoutSeconds: 1 })).rejects.toThrow("таймаут модели (1 с)");
  });
  it("sends structured text locally and reports uncited fragments without a completeness claim", async () => {
    const endpoint = await serve((body) => {
      expect(body.model).toBe("qwen3.5-9b");
      expect(body.stream).toBe(false);
      expect(body.response_format).toMatchObject({ type: "json_schema" });
      expect(JSON.stringify(body.messages)).toContain("42 кг");
      return answer();
    });
    const artifacts: string[] = [];
    const summary = await summarizeLocal(source, {
      endpoint,
      onBatch: async (name) => {
        artifacts.push(name);
      },
    });
    expect(summary.coverage?.uncitedFragmentIds).toEqual(["p2-f1"]);
    expect(artifacts).toEqual(["batch-001.json"]);
  });
  it.each([
    ["fabricated quote", answer("p1-f1", "Несуществующая дословная цитата"), "цитата модели не найдена"],
    ["fabricated ID", answer("p100-f1"), "цитата модели не найдена"],
    ["truncated output", answer("p1-f1", source.fragments[0]?.text, "length"), "причиной length"],
    ["empty response", { choices: [] }, "не соответствует схеме"],
  ])("rejects %s", async (_, payload, reason) => {
    const endpoint = await serve(() => payload);
    await expect(summarizeLocal(source, { endpoint })).rejects.toThrow(reason);
  });
  it("saves the rejected response and exact batch without exporting an accepted summary", async () => {
    const payload = answer("p1-f1", "Несуществующая дословная цитата");
    const endpoint = await serve(() => payload);
    const saved: { name: string; value: unknown }[] = [];
    await expect(
      summarizeLocal(source, {
        endpoint,
        onBatch: async (name, value) => {
          saved.push({ name, value });
        },
      }),
    ).rejects.toThrow("цитата модели не найдена");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      name: "rejected-batch-001.json",
      value: {
        status: "rejected",
        response: payload,
        fragments: [{ fragmentId: "p1-f1", text: source.fragments[0]?.text }, { fragmentId: "p2-f1" }],
      },
    });
  });
  it("accepts a JSON answer wrapped in Qwen reasoning and Markdown", async () => {
    const payload = answer();
    const choice = payload.choices[0];
    if (!choice) throw new Error("fixture should include one completion choice");
    choice.message.content = `<think>Сначала проверю формат.</think>\n\`\`\`json\n${choice.message.content}\n\`\`\``;
    const endpoint = await serve(() => payload);
    await expect(summarizeLocal(source, { endpoint })).resolves.toMatchObject({
      claims: [{ text: "Масса детали — 42 кг." }],
    });
  });
  it("preserves every character when a long fragment is split", () => {
    const text = "Условия: 42 кг.\n".repeat(1000);
    const batches = sourceBatches({ ...source, fragments: [{ id: "long", page: 1, text }] }, 1000);
    expect(
      batches
        .flat()
        .map((fragment) => fragment.text)
        .join(""),
    ).toBe(text);
    expect(batches.every((batch) => batch.reduce((n, f) => n + f.text.length, 0) <= 1000)).toBe(true);
  });
  it("processes batches sequentially, preserving evidence and order", async () => {
    const input = { ...source, fragments: source.fragments.map((f) => ({ ...f, text: f.text.repeat(16) })) };
    let calls = 0;
    const endpoint = await serve((body) => {
      calls++;
      const messages = body.messages as { content: string }[];
      const part = JSON.parse(messages[1]?.content ?? "");
      const f = part.fragments[0];
      return answer(f.fragmentId, f.text.slice(0, 30));
    });
    const summary = await summarizeLocal(input, { endpoint, batchCharacters: 1000 });
    expect(calls).toBeGreaterThan(1);
    expect(summary.claims).toHaveLength(calls);
    expect(summary.coverage?.uncitedFragmentIds).toEqual([]);
  });
  it("rejects citations belonging to another batch", async () => {
    const input = { ...source, fragments: source.fragments.map((f) => ({ ...f, text: f.text.repeat(16) })) };
    const endpoint = await serve(() => answer("p2-f1", source.fragments[1]?.text));
    await expect(summarizeLocal(input, { endpoint, batchCharacters: 1000 })).rejects.toThrow(
      "цитата модели не найдена",
    );
  });
  it("allows only loopback endpoints and prevents embedded credentials", () => {
    for (const url of ["https://example.org/v1", "http://user:secret@localhost/v1", "http://localhost/v1?key=secret"]) {
      expect(() => localEndpoint(url)).toThrow();
    }
    expect(localEndpoint()).toBe("http://127.0.0.1:8080/v1/chat/completions");
    expect(localEndpoint("http://[::1]:8080/v1/")).toContain("[::1]");
  });
});
