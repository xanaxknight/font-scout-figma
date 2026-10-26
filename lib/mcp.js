// Claude's side: the MCP messages (JSON-RPC) and Font Scout's tools, each carried out by the plugin in Figma.
import { NOT_OPEN, VERSION } from "./hub.js";

const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `Font Scout changes the user's Figma files in Figma on their own computer, through the Font Scout plugin, \
where every font installed on the computer is available. Figma's own tools (use_figma) run on Figma's servers, which only \
have Google Fonts and fonts an organization shares: there, text set in any other font can't be changed ("font family does \
not exist", hasMissingFont). Use Font Scout's tools for that text and for any font that isn't a Google font. Node IDs are \
the same as in Figma's tools. Start with figma_status. A plugin window that isn't paired yet shows a 6-digit code: ask the \
user for it and call figma_pair.`;

const FILE = {
  type: "string",
  description: "Which Figma file to act in, by (part of) its name, when the plugin is open in more than one. Without it, the one it was opened in last.",
};

function tool(name, title, description, { readOnly, properties = {}, required = [], file = true }) {
  const schema = { type: "object", properties: file ? { ...properties, file: FILE } : properties };
  if (required.length) schema.required = required;
  return { name, title, description, inputSchema: schema, annotations: { readOnlyHint: readOnly, openWorldHint: false } };
}

const TOOLS = [
  tool("figma_status", "Figma files with Font Scout",
    "The Figma files the Font Scout plugin is open in, with each one's current page and selected layers, and any plugin window waiting to be paired. Call it first.",
    { readOnly: true, file: false }),
  tool("figma_pair", "Pair the plugin",
    "Pairs a Font Scout plugin window with Claude, once per computer. Its window shows a 6-digit code while it waits: ask the user to read it out.",
    { readOnly: false, file: false, properties: { code: { type: "string", description: "The 6 digits the plugin's window shows." } }, required: ["code"] }),
  tool("figma_find_fonts", "Find fonts",
    "Font families Figma on the user's computer can use (every font installed on it, Google fonts too) whose name holds the query, with their exact style names. Use the names exactly as given.",
    { readOnly: true, properties: { query: { type: "string", description: "Part of a family name, e.g. \"Suisse\". Empty lists all." } } }),
  tool("figma_get_texts", "Read text layers",
    "Text layers under a layer, or in the selection, or on the current page: id, name, text, fonts, size, and whether a font is missing on this computer.",
    { readOnly: true, properties: {
      nodeId: { type: "string", description: "A layer's id, e.g. \"2010:6066\". Without it, the selection, or the current page." },
      limit: { type: "integer", description: "At most this many layers (100 if not given)." } } }),
  tool("figma_set_text", "Change text",
    "Replaces a text layer's text, keeping its font and styling, in Figma on the user's computer, where its font loads even when it's missing in Figma's own tools. With mixed styles, the whole text takes its first character's style.",
    { readOnly: false, properties: { nodeId: { type: "string", description: "The text layer's id." }, text: { type: "string", description: "The new text." } },
      required: ["nodeId", "text"] }),
  tool("figma_set_font", "Change font",
    "Sets the font of text layers, or of the characters from start to end in one of them. The family and style must be exactly as figma_find_fonts gives them. Also replaces fonts that are missing.",
    { readOnly: false, properties: {
      nodeIds: { type: "array", items: { type: "string" }, description: "Text layers' ids." },
      family: { type: "string" }, style: { type: "string", description: "e.g. \"Regular\", \"Semi Bold\"." },
      start: { type: "integer", description: "First character, from 0 (with end: only these characters)." },
      end: { type: "integer", description: "The character after the last one." } },
      required: ["nodeIds", "family", "style"] }),
  tool("figma_run", "Run a Figma script",
    "Runs Figma Plugin API JavaScript in the user's open file, in Figma on their computer, where every font installed on it loads with figma.loadFontAsync. Top-level await and return work, as in use_figma; return plain data (layers come back as their id, name and type). Use the standard Plugin API: use_figma's extras (node.query, node.set, figma.createAutoLayout, node.screenshot, figma.notify) don't exist here. Load a text's fonts before changing it, and switch pages with await figma.setCurrentPageAsync(page). The user can turn scripts off in the plugin's window.",
    { readOnly: false, properties: { code: { type: "string", description: "The script." } }, required: ["code"] }),
  tool("figma_screenshot", "Picture of a layer",
    "A PNG of a layer as Figma on the user's computer draws it, with its real fonts. At most 2048 px on its longer side.",
    { readOnly: true, properties: { nodeId: { type: "string" }, scale: { type: "number", description: "1 if not given." } }, required: ["nodeId"] }),
];

// The plugin's name for what each tool does, and the arguments it takes
const OPS = {
  figma_find_fonts: ["fonts", ["query"]],
  figma_get_texts: ["texts", ["nodeId", "limit"]],
  figma_set_text: ["setText", ["nodeId", "text"]],
  figma_set_font: ["setFont", ["nodeIds", "family", "style", "start", "end"]],
  figma_run: ["run", ["code"]],
  figma_screenshot: ["screenshot", ["nodeId", "scale"]],
};

// A message's answer, or null for notifications, which get none. Takes a batch too.
export async function answer(message, hub) {
  if (Array.isArray(message)) {
    const replies = (await Promise.all(message.map(item => answer(item, hub)))).filter(Boolean);
    return replies.length ? replies : null;
  }
  if (!message || typeof message !== "object") return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "That isn't a JSON-RPC message." } };
  const { id, method, params = {} } = message;
  if (id === undefined || typeof method !== "string") return null;
  const reply = result => ({ jsonrpc: "2.0", id, result });
  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "font-scout", title: "Font Scout", version: VERSION },
        instructions: INSTRUCTIONS,
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call":
      return reply(await call(params.name, params.arguments || {}, hub));
    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Font Scout has no method ${method}.` } };
  }
}

async function call(name, args, hub) {
  if (name === "figma_status") return status(hub);
  if (name === "figma_pair") return content(hub.pair(args.code));
  const entry = OPS[name];
  if (!entry) return content({ ok: false, error: `Font Scout has no tool ${name}.` });
  const [op, keys] = entry;
  const definition = TOOLS.find(t => t.name === name);
  const absent = (definition.inputSchema.required || []).filter(key => args[key] === undefined);
  if (absent.length) return content({ ok: false, error: `${name} needs ${absent.join(" and ")}.` });
  const { client, error } = hub.pick(args.file);
  if (!client) return content({ ok: false, error: unpairedNote(hub) || error });
  const outcome = await hub.run(op, Object.fromEntries(keys.filter(key => args[key] !== undefined).map(key => [key, args[key]])), client);
  if (op === "screenshot" && outcome.ok && outcome.value?.image) {
    return { content: [{ type: "image", data: outcome.value.image, mimeType: "image/png" }] };
  }
  return content(outcome);
}

async function status(hub) {
  const open = hub.live();
  const waiting = hub.waitingToPair();
  if (!open.length && !waiting.length) return content({ ok: false, error: NOT_OPEN });
  const files = [];
  for (const client of open) {
    const outcome = await hub.run("status", {}, client);
    files.push(outcome.ok ? outcome.value : { file: client.file, error: outcome.error });
  }
  const notes = [];
  if (waiting.length) notes.push(unpairedNote(hub));
  if (open.length > 1) notes.push(`The plugin is open in ${open.length} files. Pass file to the other tools to pick one; without it they act in “${open[0].file}”, opened last.`);
  return content({ ok: true, value: { files, waitingToPair: waiting.map(entry => entry.file), note: notes.join(" ") || "The other tools act in this file." } });
}

function unpairedNote(hub) {
  const waiting = hub.waitingToPair();
  if (!waiting.length) return null;
  const names = waiting.map(entry => `“${entry.file}”`).join(", ");
  return `The Font Scout plugin in ${names} isn't paired with Claude yet. Its window shows a 6-digit code: ask the user for it, then call figma_pair with it.`;
}

function content(outcome) {
  if (!outcome.ok) return { content: [{ type: "text", text: outcome.error }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(outcome.value, null, 2) }] };
}
