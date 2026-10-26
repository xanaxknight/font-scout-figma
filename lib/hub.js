// The hub: a small server on this computer (localhost) that the Font Scout plugin in Figma keeps asking for
// commands and sends back what came of them. One bridge process holds it; others that Claude starts (another
// Claude window, Claude Desktop next to Claude Code) pass their calls on to it through /mcp.
//
// Who may use it:
// - The plugin, once paired. A plugin it doesn't know shows a 6-digit code and waits; Claude pairs it with the
//   code the user reads off the plugin's window (figma_pair). The plugin keeps its key in Figma, the bridge in
//   ~/.font-scout/figma.json, so pairing is once per computer.
// - Bridge processes: POST /mcp, refused when it carries an Origin, as everything a browser sends does, so web
//   pages can't call Claude's tools.
// It only answers requests addressed to localhost or 127.0.0.1 themselves: a web page can't reach it through a
// name of its own pointed here.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PORT = Number(process.env.FONT_SCOUT_FIGMA_PORT) || 51843;
export const VERSION = "0.1.0";
const STATE = process.env.FONT_SCOUT_FIGMA_STATE || path.join(os.homedir(), ".font-scout", "figma.json");
const POLL_SECONDS = 20, LIVE_SECONDS = 30, MAX_WAITING_TO_PAIR = 5;

export class Hub {
  constructor(answerMCP) {
    this.answerMCP = answerMCP;   // (message) => reply or null, for bridge processes passing calls on
    this.clients = new Map();     // paired plugin windows by key
    this.unpaired = new Map();    // plugin windows waiting to be paired, by key
    this.pending = new Map();     // commands waiting for their result, by id
    this.paired = this.load();
  }

  // Holds the port: true, or false when something else has it
  listen() {
    return new Promise(resolve => {
      const server = http.createServer((request, response) => this.handle(request, response).catch(() => send(response, 500)));
      server.once("error", () => resolve(false));
      server.listen(PORT, "127.0.0.1", () => { this.server = server; resolve(true); });
    });
  }

  // MARK: Requests

  async handle(request, response) {
    const host = request.headers.host;
    if (host !== `localhost:${PORT}` && host !== `127.0.0.1:${PORT}`) return send(response, 403);
    const url = new URL(request.url, `http://${host}`);
    const query = Object.fromEntries(url.searchParams);
    if (request.method === "OPTIONS") return send(response, 204, null, true);
    switch (`${request.method} ${url.pathname}`) {
      case "GET /hello":
        return send(response, 200, { app: "font-scout-mcp", version: VERSION });
      case "POST /mcp": {
        if (request.headers.origin) return send(response, 403);
        const message = parse(await body(request));
        if (message === undefined) return send(response, 400);
        const reply = await this.answerMCP(message);
        return reply ? send(response, 200, reply) : send(response, 202);
      }
      case "GET /figma/poll":
        return this.poll(query, request, response);
      case "POST /figma/result":
        return this.result(query, parse(await body(request)), response);
      default:
        return send(response, 404);
    }
  }

  // A poll: answered at once with a command waiting for this window, else held until one comes or for 20
  // seconds. A window that isn't paired yet is told so, and shows its code.
  poll(query, request, response) {
    const key = query.key || "";
    if (!/^[0-9a-f]{32,128}$/.test(key)) return send(response, 400, null, true);
    if (!this.paired[key]) this.paired = this.load();   // paired while another bridge process held the port
    if (!this.paired[key]) {
      this.waitToPair(key, query);
      return send(response, 202, { pairing: true }, true);
    }
    const now = Date.now();
    const client = this.clients.get(key) || { key, since: now, queue: [] };
    Object.assign(client, { file: query.file || client.file || "", editor: query.editor || client.editor || "", lastSeen: now });
    if (client.waiting) send(client.waiting, 204, null, true);   // an earlier poll of its own, still open
    client.waiting = null;
    this.clients.set(key, client);
    if (client.queue.length) return send(response, 200, client.queue.shift(), true);
    client.waiting = response;
    const timer = setTimeout(() => {
      if (client.waiting !== response) return;
      client.waiting = null;
      send(response, 204, null, true);
    }, POLL_SECONDS * 1000);
    // The window gave up on the poll: it closed, so commands shouldn't wait for it
    response.on("close", () => {
      clearTimeout(timer);
      if (client.waiting === response && !response.writableEnded) {
        client.waiting = null;
        this.clients.delete(key);
      }
    });
  }

  waitToPair(key, query) {
    const code = String(query.code || "").replace(/\D/g, "");
    if (code.length !== 6) return;
    this.unpaired.delete(key);
    this.unpaired.set(key, { key, code, file: query.file || "", editor: query.editor || "", lastSeen: Date.now() });
    // Only the latest few, so a page can't fill it with every code
    while (this.unpaired.size > MAX_WAITING_TO_PAIR) this.unpaired.delete(this.unpaired.keys().next().value);
  }

  // What came of a command: { id, ok, value | error }
  result(query, message, response) {
    if (!this.paired[query.key]) return send(response, 403, null, true);
    const client = this.clients.get(query.key);
    if (client) client.lastSeen = Date.now();
    if (!message || typeof message.id !== "string") return send(response, 400, null, true);
    this.finish(message.id, message.ok ? { ok: true, value: message.value ?? null } : { ok: false, error: message.error || "Something went wrong in Figma." });
    send(response, 204, null, true);
  }

  // MARK: Commands

  // Plugin windows that are waiting or asked lately, newest first
  live() {
    const now = Date.now();
    for (const [key, client] of this.clients) if (!client.waiting && now - client.lastSeen > LIVE_SECONDS * 1000) this.clients.delete(key);
    return [...this.clients.values()].sort((a, b) => b.since - a.since);
  }

  waitingToPair() {
    const now = Date.now();
    return [...this.unpaired.values()].filter(entry => now - entry.lastSeen < LIVE_SECONDS * 1000);
  }

  pick(file) {
    const open = this.live();
    if (!file) return open[0] ? { client: open[0] } : { error: NOT_OPEN };
    const client = open.find(c => c.file.toLowerCase().includes(String(file).toLowerCase()));
    return client ? { client } : { error: `The Font Scout plugin isn't open in a Figma file called “${file}”. Open in: ${open.map(c => c.file).join(", ") || "none"}.` };
  }

  run(op, args, client) {
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const command = { id, op, args };
    return new Promise(resolve => {
      const timer = setTimeout(() => this.finish(id, { ok: false, error: `Figma didn't answer. Is the Font Scout plugin still open in “${client.file}”?` }),
        (op === "run" ? 120 : 60) * 1000);
      this.pending.set(id, { resolve, timer });
      if (client.waiting) {
        const waiting = client.waiting;
        client.waiting = null;
        send(waiting, 200, command, true);
      } else {
        client.queue.push(command);
      }
    });
  }

  finish(id, outcome) {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    entry.resolve(outcome);
  }

  // MARK: Pairing

  pair(code) {
    const wanted = String(code || "").replace(/\D/g, "");
    const matches = this.waitingToPair().filter(entry => entry.code === wanted);
    if (matches.length !== 1) {
      return { ok: false, error: matches.length
        ? "More than one window shows that code. Ask the user to close Font Scout in Figma, run it again, and read the new code."
        : "No Font Scout plugin window shows that code. Its window shows the code while it waits to be paired: ask the user to read it again." };
    }
    const [entry] = matches;
    this.unpaired.delete(entry.key);
    this.paired[entry.key] = { pairedAt: new Date().toISOString() };
    this.save();
    return { ok: true, value: { paired: entry.file, note: "Paired. The plugin connects within a few seconds; then the other tools act in this file." } };
  }

  load() {
    try { return JSON.parse(fs.readFileSync(STATE, "utf8")).paired || {}; } catch { return {}; }
  }

  // Only the keys and when they were paired: nothing from the files themselves
  save() {
    // Another bridge process may have paired a window meanwhile
    const paired = Object.fromEntries(Object.entries({ ...this.load(), ...this.paired }).map(([key, entry]) => [key, { pairedAt: entry.pairedAt }]));
    this.paired = paired;
    fs.mkdirSync(path.dirname(STATE), { recursive: true });
    fs.writeFileSync(STATE, JSON.stringify({ paired }, null, 2), { mode: 0o600 });
  }
}

export const NOT_OPEN = "The Font Scout plugin isn't open in Figma. Ask the user to run it in their file (Plugins → Font Scout; ⌥⌘P or Ctrl+Alt+P runs it again).";

function send(response, status, payload = null, cors = false) {
  if (response.writableEnded) return;
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", Connection: "close" };
  if (cors) Object.assign(headers, {
    "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST",
    "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Private-Network": "true",
  });
  response.writeHead(status, headers);
  response.end(payload === null ? undefined : JSON.stringify(payload));
}

function body(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", chunk => {
      size += chunk.length;
      if (size > 20_000_000) { reject(new Error("too big")); request.destroy(); }
      else chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function parse(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}
