import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { AgentRegistry } from "./agent-registry.js";
import { AgentUsageService } from "./agent-usage.js";
import { CodexThreadCatalog } from "./codex-threads.js";
import { loadConfig } from "./config.js";
import { EventHub } from "./event-hub.js";
import { createGatewayHttpServer } from "./http.js";
import { NativeHistoryService } from "./history.js";
import { PairingManager } from "./security.js";
import { GatewayService } from "./service.js";
import { GatewayStore } from "./store.js";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
const store = new GatewayStore(join(config.dataDir, "gateway.sqlite"));
const events = new EventHub();
const registry = new AgentRegistry();
const service = new GatewayService(store, registry, events, config.allowedRoots);
const pairing = new PairingManager(config.pairingTtlMs);
const history = new NativeHistoryService(
  config.historyDirs,
  config.allowedRoots,
  new CodexThreadCatalog(),
);
const usage = new AgentUsageService();
const server = createGatewayHttpServer({ config, service, pairing, events, history, usage });

server.listen(config.port, config.host, () => {
  process.stdout.write(
    `${JSON.stringify({
      event: "gateway.ready",
      url: `http://${config.host}:${config.port}`,
      roots: config.allowedRoots,
    })}\n`,
  );
});

const shutdown = (signal: string) => {
  process.stdout.write(`${JSON.stringify({ event: "gateway.stopping", signal })}\n`);
  service.stop();
  server.close(() => {
    store.close();
    process.exit(0);
  });
  const timer = setTimeout(() => process.exit(1), 5_000);
  timer.unref();
};

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
