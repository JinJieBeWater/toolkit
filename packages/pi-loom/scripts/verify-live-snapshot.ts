import { HERDR_PROTOCOL, HerdrAdapter } from "../src/herdr-adapter.ts";
import { NodeHerdrSocketTransport } from "../src/herdr-socket-transport.ts";

const socketPath = process.env.HERDR_SOCKET_PATH;
if (!socketPath) throw new Error("HERDR_SOCKET_PATH is required");

const adapter = new HerdrAdapter({
  transport: new NodeHerdrSocketTransport({ socketPath }),
  supportedProtocol: HERDR_PROTOCOL,
});
const snapshot = await adapter.snapshot();
console.log(
  JSON.stringify({
    version: snapshot.version,
    protocol: snapshot.protocol,
    workspaces: snapshot.workspaces.length,
    tabs: snapshot.tabs.length,
    panes: snapshot.panes.length,
    agents: snapshot.agents.length,
    focusedPane: Boolean(snapshot.focusedPaneId),
  }),
);
