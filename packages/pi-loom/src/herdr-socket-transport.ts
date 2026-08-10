import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { HerdrRpcError, HerdrTransportError, type HerdrRequestTransport } from "./herdr-adapter.ts";

export type NodeHerdrSocketTransportOptions = {
  socketPath: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

export { HerdrRpcError } from "./herdr-adapter.ts";

export class NodeHerdrSocketTransport implements HerdrRequestTransport {
  constructor(private readonly options: NodeHerdrSocketTransportOptions) {}

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const requestId = `loom_${randomUUID()}`;
    const timeoutMs = this.options.timeoutMs ?? 10_000;
    const maxResponseBytes = this.options.maxResponseBytes ?? 8 * 1024 * 1024;

    return new Promise<unknown>((resolve, reject) => {
      const socket = createConnection(this.options.socketPath);
      let sent = false;
      let settled = false;
      let buffer = "";
      let receivedBytes = 0;

      const timeout = setTimeout(() => {
        fail(
          new HerdrTransportError(
            `Herdr request timed out after ${timeoutMs}ms`,
            sent ? "after-send" : "before-send",
          ),
        );
      }, timeoutMs);

      function finish(value: unknown): void {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.end();
        resolve(value);
      }

      function fail(error: Error): void {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        reject(error);
      }

      function handleLine(line: string): void {
        let envelope: Record<string, unknown>;
        try {
          const parsed = JSON.parse(line) as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("response is not an object");
          }
          envelope = parsed as Record<string, unknown>;
        } catch (error) {
          fail(new Error(`invalid Herdr JSON response: ${(error as Error).message}`));
          return;
        }
        if (envelope.id !== requestId) {
          if (typeof envelope.id === "string" && envelope.id.startsWith(`${requestId}:sub:`)) {
            return;
          }
          fail(new Error(`unexpected Herdr response id ${String(envelope.id)}`));
          return;
        }
        if ("error" in envelope) {
          const rpcError = envelope.error as Record<string, unknown>;
          fail(
            new HerdrRpcError(
              String(rpcError?.code ?? "unknown"),
              String(rpcError?.message ?? "Herdr request failed"),
            ),
          );
          return;
        }
        if (!("result" in envelope)) {
          fail(new Error("Herdr response has neither result nor error"));
          return;
        }
        finish(envelope.result);
      }

      socket.on("connect", () => {
        sent = true;
        socket.write(`${JSON.stringify({ id: requestId, method, params })}\n`);
      });
      socket.on("data", (chunk: Buffer) => {
        receivedBytes += chunk.length;
        if (receivedBytes > maxResponseBytes) {
          fail(new Error(`Herdr response exceeded ${maxResponseBytes} bytes`));
          return;
        }
        buffer += chunk.toString("utf8");
        let newline = buffer.indexOf("\n");
        while (newline >= 0 && !settled) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) handleLine(line);
          newline = buffer.indexOf("\n");
        }
      });
      socket.on("error", (error) => {
        fail(new HerdrTransportError(error.message, sent ? "after-send" : "before-send"));
      });
      socket.on("close", () => {
        if (!settled) {
          fail(
            new HerdrTransportError(
              "Herdr socket closed before a response",
              sent ? "after-send" : "before-send",
            ),
          );
        }
      });
    });
  }
}
