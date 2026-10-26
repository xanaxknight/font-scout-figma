// The process Claude starts: MCP over stdin and stdout, one JSON message per line. The first bridge process holds
// the hub (hub.js) and answers itself; others pass each message on to it, and take the hub over when its
// process ends.
import readline from "node:readline";
import { Hub, PORT } from "./hub.js";
import { answer } from "./mcp.js";

export async function start() {
  let hub = null;
  const becomeHub = async () => {
    if (hub) return true;
    const candidate = new Hub(message => answer(message, candidate));
    if (!(await candidate.listen())) return false;
    hub = candidate;
    return true;
  };
  await becomeHub();
  // While another process holds the hub, check now and then whether it's gone
  const watch = setInterval(() => { if (!hub) becomeHub(); }, 5000);
  watch.unref();

  const handle = async line => {
    let message;
    try { message = JSON.parse(line); } catch {
      return write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "That isn't JSON." } });
    }
    let reply;
    if (hub) reply = await answer(message, hub);
    else {
      reply = await forward(line);
      if (reply === undefined) reply = (await becomeHub()) ? await answer(message, hub) : failure(message);
    }
    if (reply) write(reply);
  };

  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", line => { if (line.trim()) handle(line); });
  input.on("close", () => process.exit(0));
}

// The hub's answer (null for a notification), or undefined when no hub of ours is there
async function forward(line) {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: line, signal: AbortSignal.timeout(180_000),
    });
    if (response.status === 202) return null;
    if (!response.ok) return undefined;
    return await response.json();
  } catch {
    return undefined;
  }
}

function failure(message) {
  if (!message || message.id === undefined) return null;
  return { jsonrpc: "2.0", id: message.id, error: { code: -32000, message: `Port ${PORT} is taken by another program, so Font Scout's bridge can't start.` } };
}

function write(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}
