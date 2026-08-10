import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HerdrRpcError, HerdrTransportError } from "../src/herdr-adapter.ts";
import { NodeHerdrSocketTransport } from "../src/herdr-socket-transport.ts";

async function listen(server: Server, path: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

test("socket transport correlates one newline-delimited response", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-socket-"));
  const socketPath = join(directory, "herdr.sock");
  const server = createServer((socket) => {
    socket.once("data", (data) => {
      const request = JSON.parse(data.toString("utf8").trim()) as { id: string; method: string };
      socket.end(
        `${JSON.stringify({ id: request.id, result: { type: "pong", version: "0.8.0", protocol: 19 } })}\n`,
      );
    });
  });
  await listen(server, socketPath);
  t.after(async () => {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  });

  const transport = new NodeHerdrSocketTransport({ socketPath, timeoutMs: 1_000 });
  const response = await transport.request("ping", {});

  assert.deepEqual(response, { type: "pong", version: "0.8.0", protocol: 19 });
});

test("socket close after request write is classified as ambiguous", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-socket-close-"));
  const socketPath = join(directory, "herdr.sock");
  const server = createServer((socket) => socket.once("data", () => socket.destroy()));
  await listen(server, socketPath);
  t.after(async () => {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  });

  const transport = new NodeHerdrSocketTransport({ socketPath, timeoutMs: 1_000 });
  await assert.rejects(
    transport.request("agent.start", { name: "reviewer", argv: ["pi"] }),
    (error) => {
      assert.ok(error instanceof HerdrTransportError);
      assert.equal(error.stage, "after-send");
      return true;
    },
  );
});

test("socket transport ignores events.wait internal probe responses", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-socket-probe-"));
  const socketPath = join(directory, "herdr.sock");
  const server = createServer((socket) => {
    socket.once("data", (data) => {
      const request = JSON.parse(data.toString("utf8").trim()) as { id: string };
      socket.write(
        `${JSON.stringify({ id: `${request.id}:sub:0:probe`, error: { code: "pane_not_found", message: "probe target missing" } })}\n`,
      );
      socket.end(
        `${JSON.stringify({ id: request.id, error: { code: "wait_failed", message: "target missing" } })}\n`,
      );
    });
  });
  await listen(server, socketPath);
  t.after(async () => {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  });

  const transport = new NodeHerdrSocketTransport({ socketPath, timeoutMs: 1_000 });
  await assert.rejects(transport.request("events.wait", {}), (error) => {
    assert.ok(error instanceof HerdrRpcError);
    assert.equal(error.code, "wait_failed");
    return true;
  });
});
