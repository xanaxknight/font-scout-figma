// Font Scout for Figma, in one window (ui.html):
// - Glyphs: every character in the font where the text cursor is, to put in with a click.
// - Fonts: the fonts missing on this computer, each with a replacement among the ones that are here (the same font
//   under another name, else a similar one), all swapped in with one click. Shown as soon as the plugin opens.
// CLAUDE {
// - Claude: does what Claude asks, here in this file, in Figma on this computer, where every font installed on it
//   loads. Claude's own Figma tools run on Figma's servers, which only have Google's fonts and the ones an
//   organisation shares. The window talks to Font Scout's bridge on this computer and hands the commands over;
//   this side runs them and hands back what came of them.
// Everything between "CLAUDE {" and "} CLAUDE" is for Claude only: the Figma Community version is built without it
// (scripts/build-community.mjs).
// } CLAUDE
figma.showUI(__html__, { width: 340, height: 500, themeColors: true });

// CLAUDE {
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const CHANGES = ["setText", "setFont", "run"];
// } CLAUDE

figma.ui.onmessage = async (message) => {
  if (!message) return;
  // The window has loaded: the page's missing fonts
  if (message.type === "ready") {
    // CLAUDE {
    // and for Claude which file this is, the key it's paired with, and whether scripts may run
    figma.ui.postMessage({
      type: "hello", file: figma.root.name, editor: figma.editorType,
      key: await figma.clientStorage.getAsync("pairingKey"),
      allowScripts: (await figma.clientStorage.getAsync("allowScripts")) !== false,
    });
    // } CLAUDE
    figma.ui.postMessage({ type: "missing", ...(await missingFonts("page")) });
  }
  // CLAUDE {
  if (message.type === "saveKey") await figma.clientStorage.setAsync("pairingKey", message.key);
  if (message.type === "allowScripts") await figma.clientStorage.setAsync("allowScripts", message.value);
  // } CLAUDE
  if (message.type === "insert") figma.ui.postMessage({ type: "inserted", glyph: message.glyph, ...(await insertGlyph(message.glyph)) });
  if (message.type === "scanMissing") figma.ui.postMessage({ type: "missing", ...(await missingFonts(message.scope)) });
  // One font, or all of them: either way one step for ⌘Z
  if (message.type === "replace") {
    let changed = 0;
    for (const swap of message.swaps) changed += await replaceFont(swap.from, swap.to, swap.nodeIds);
    figma.commitUndo();
    figma.ui.postMessage({ type: "replaced", fonts: message.swaps.length, changed });
  }
  if (message.type === "select") await selectLayers(message.nodeIds);
  // CLAUDE {
  if (message.type !== "command") return;
  let reply;
  try {
    reply = { type: "result", id: message.id, op: message.op, ok: true, value: plain(await run(message.op, message.args || {})) };
  } catch (error) {
    reply = { type: "result", id: message.id, op: message.op, ok: false, error: String((error && error.message) || error) };
  }
  // Each change Claude makes is one step for ⌘Z
  if (CHANGES.includes(message.op)) figma.commitUndo();
  figma.ui.postMessage(reply);
  // } CLAUDE
};

function fontsOf(node) {
  if (!node.characters.length) return node.fontName === figma.mixed ? [] : [node.fontName];
  return node.getRangeAllFontNames(0, node.characters.length);
}

// CLAUDE {
async function run(op, args) {
  switch (op) {
    case "status": return status();
    case "fonts": return fonts(args.query || "");
    case "texts": return texts(args.nodeId, args.limit || 100);
    case "setText": return setText(args.nodeId, args.text);
    case "setFont": return setFont(args.nodeIds || [], args.family, args.style, args.start, args.end);
    case "screenshot": return screenshot(args.nodeId, args.scale || 1);
    case "run":
      if ((await figma.clientStorage.getAsync("allowScripts")) === false) {
        throw new Error("Scripts are off in the Font Scout window in Figma. Use the other tools, or ask the user to turn scripts on there.");
      }
      return new AsyncFunction("figma", args.code)(figma);
    default: throw new Error("The Font Scout plugin doesn't know \"" + op + "\": it may need updating.");
  }
}

// What a script returned, as plain data the window can pass on: layers become their id, name and type
function plain(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (item && typeof item === "object" && typeof item.id === "string" && typeof item.type === "string" && "parent" in item) {
      return { id: item.id, name: item.name, type: item.type };
    }
    if (item instanceof Uint8Array) return figma.base64Encode(item);
    return item;
  }));
}

function status() {
  return {
    file: figma.root.name,
    editor: figma.editorType,
    page: { id: figma.currentPage.id, name: figma.currentPage.name },
    selection: figma.currentPage.selection.slice(0, 30).map(node => ({ id: node.id, name: node.name, type: node.type })),
  };
}

// The families Figma can use here whose name holds the query, with their exact style names
async function fonts(query) {
  const wanted = query.toLowerCase();
  const families = new Map();
  for (const font of await figma.listAvailableFontsAsync()) {
    const { family, style } = font.fontName;
    if (!family.toLowerCase().includes(wanted)) continue;
    if (!families.has(family)) families.set(family, []);
    families.get(family).push(style);
  }
  const list = [...families].slice(0, 60).map(([family, styles]) => ({ family, styles }));
  return { count: families.size, families: list };
}

async function nodeById(id) {
  const node = await figma.getNodeByIdAsync(id);
  if (!node) throw new Error("There's no layer " + id + " in this file.");
  let page = node;
  while (page && page.type !== "PAGE") page = page.parent;
  if (page && page !== figma.currentPage) await page.loadAsync();
  return node;
}

// Text layers under a layer, or the selection, or the current page
async function texts(nodeId, limit) {
  const roots = nodeId ? [await nodeById(nodeId)] : figma.currentPage.selection.length ? figma.currentPage.selection : [figma.currentPage];
  const found = [];
  for (const root of roots) {
    if (root.type === "TEXT") found.push(root);
    else if ("findAllWithCriteria" in root) found.push(...root.findAllWithCriteria({ types: ["TEXT"] }));
  }
  return {
    count: found.length,
    texts: found.slice(0, limit).map(node => ({
      id: node.id, name: node.name,
      text: node.characters.length > 300 ? node.characters.slice(0, 300) + "…" : node.characters,
      fonts: fontsOf(node).map(font => font.family + " " + font.style),
      fontSize: node.fontSize === figma.mixed ? "mixed" : node.fontSize,
      missingFont: node.hasMissingFont,
    })),
  };
}

async function load(font) {
  try { await figma.loadFontAsync(font); }
  catch (error) { throw new Error("\"" + font.family + " " + font.style + "\" isn't in Figma on this computer. Install it, or look up the exact names with figma_find_fonts."); }
}

async function setText(nodeId, text) {
  const node = await nodeById(nodeId);
  if (node.type !== "TEXT") throw new Error(node.name + " (" + node.id + ") is a " + node.type.toLowerCase() + ", not a text layer.");
  for (const font of fontsOf(node)) await load(font);
  node.characters = String(text);
  return { id: node.id, name: node.name, text: node.characters };
}

async function setFont(nodeIds, family, style, start, end) {
  const font = { family, style };
  const styles = (await figma.listAvailableFontsAsync()).filter(f => f.fontName.family === family).map(f => f.fontName.style);
  if (!styles.length) throw new Error("Figma on this computer has no family \"" + family + "\". Look up the exact name with figma_find_fonts.");
  if (!styles.includes(style)) throw new Error("\"" + family + "\" has no style \"" + style + "\" here. Its styles: " + styles.join(", ") + ".");
  await load(font);
  const changed = [];
  for (const id of nodeIds) {
    const node = await nodeById(id);
    if (node.type !== "TEXT") throw new Error(node.name + " (" + node.id + ") is not a text layer.");
    // Its own fonts too, where they're here: a missing one can still be replaced
    for (const current of fontsOf(node)) await figma.loadFontAsync(current).catch(() => {});
    if (start != null && end != null) node.setRangeFontName(start, end, font);
    else node.fontName = font;
    changed.push({ id: node.id, name: node.name });
  }
  return { font: family + " " + style, changed };
}

async function screenshot(nodeId, scale) {
  const node = await nodeById(nodeId);
  // No bigger than 2048 on its longer side
  const longest = Math.max(node.width || 1, node.height || 1);
  const value = Math.min(scale, 2048 / longest);
  const bytes = await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value } });
  return { image: figma.base64Encode(bytes), mimeType: "image/png", name: node.name };
}
// } CLAUDE

// MARK: Glyphs

// The text the cursor is in, or the one text layer selected
function currentText() {
  let range = null;
  try { range = figma.currentPage.selectedTextRange; } catch (error) {}   // not every editor has it
  if (range) return { node: range.node, start: range.start, end: range.end, editing: true };
  const selection = figma.currentPage.selection;
  if (selection.length === 1 && selection[0].type === "TEXT") return { node: selection[0], editing: false };
  return null;
}

// Its font at the cursor (the character before it), or at its start
function fontAt(text) {
  const length = text.node.characters.length;
  if (!length) return text.node.fontName === figma.mixed ? null : text.node.fontName;
  const at = text.editing ? Math.min(Math.max(text.start - 1, 0), length - 1) : 0;
  const font = text.node.getRangeFontName(at, at + 1);
  return font === figma.mixed ? null : font;
}

// Tells the window when the font under the cursor changes; moving the cursor inside a text doesn't change the
// selection, so it also looks every so often
let reported = null;
function reportFont() {
  const text = currentText();
  const font = text && fontAt(text);
  const state = JSON.stringify([font, !!(text && text.editing)]);
  if (state === reported) return;
  reported = state;
  figma.ui.postMessage({ type: "font", font: font ? { family: font.family, style: font.style } : null, editing: !!(text && text.editing) });
}
figma.on("selectionchange", reportFont);
setInterval(reportFont, 400);
figma.on("currentpagechange", async () => figma.ui.postMessage({ type: "missing", ...(await missingFonts("page")) }));

// Puts a character in at the cursor, in place of what's selected there
async function insertGlyph(glyph) {
  const text = currentText();
  if (!text || !text.editing) return { ok: false, reason: "notEditing" };
  const { node, start, end } = text;
  try {
    for (const font of fontsOf(node)) await figma.loadFontAsync(font);
  } catch (error) {
    return { ok: false, reason: "missingFont" };
  }
  if (end > start) node.deleteCharacters(start, end);
  node.insertCharacters(start, glyph, start > 0 ? "BEFORE" : "AFTER");
  try { figma.currentPage.selectedTextRange = { node, start: start + glyph.length, end: start + glyph.length }; } catch (error) {}
  figma.commitUndo();
  return { ok: true };
}

// MARK: Missing fonts

// Fonts used on the page (or in the selection) that this computer doesn't have, with the layers that use them
// and a match among the fonts it does have
async function missingFonts(scope) {
  const selection = figma.currentPage.selection;
  const roots = scope === "selection" && selection.length ? selection : [figma.currentPage];
  const found = [];
  for (const root of roots) {
    if (root.type === "TEXT") found.push(root);
    else if ("findAllWithCriteria" in root) found.push(...root.findAllWithCriteria({ types: ["TEXT"] }));
  }
  const available = await figma.listAvailableFontsAsync();
  const families = new Map();
  for (const font of available) {
    const { family, style } = font.fontName;
    if (!families.has(family)) families.set(family, []);
    families.get(family).push(style);
  }
  const missing = new Map();
  const used = new Map();   // families here the file uses, by how many layers
  for (const node of found) {
    if (!node.hasMissingFont) {
      for (const font of fontsOf(node)) used.set(font.family, (used.get(font.family) || 0) + 1);
      continue;
    }
    for (const font of fontsOf(node)) {
      if ((families.get(font.family) || []).includes(font.style)) { used.set(font.family, (used.get(font.family) || 0) + 1); continue; }
      const key = font.family + "\u0000" + font.style;
      if (!missing.has(key)) missing.set(key, { family: font.family, style: font.style, nodeIds: [] });
      const entry = missing.get(key);
      if (!entry.nodeIds.includes(node.id)) entry.nodeIds.push(node.id);
    }
  }
  return {
    scope: roots === selection ? "selection" : "page",
    page: figma.currentPage.name,
    missing: [...missing.values()].map(entry => ({ ...entry, match: match(entry, families, used) })),
    families: [...families].map(([family, styles]) => ({ family, styles })),
  };
}

const squash = (name) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const WEIGHTS = [["thin", 100], ["hairline", 100], ["extralight", 200], ["ultralight", 200], ["light", 300], ["book", 400],
  ["regular", 400], ["normal", 400], ["roman", 400], ["medium", 500], ["semibold", 600], ["demibold", 600],
  ["extrabold", 800], ["ultrabold", 800], ["bold", 700], ["black", 900], ["heavy", 900]];
function weightOf(style) {
  const name = squash(style);
  const hit = WEIGHTS.find(([word]) => name.includes(word));
  return hit ? hit[1] : 400;
}
const italic = (style) => /italic|oblique/i.test(style);

// What a family is, going by its name: most say it (Grotesk, Serif, Mono), and some well-known ones don't
const KINDS = [
  ["mono", /mono|code|courier|consol|menlo|typewriter/],
  ["script", /script|hand|brush|signature|calligraph|marker/],
  ["sans", /sans|grot|gothic|helvetica|arial|inter|haas|akkurat|suisse|montreal|circular|graphik|aeonik|mori|apercu|favorit|founders|universe|univers|futura|avenir|gill|din|roboto|manrope|poppins|grotesk|neue|lato|montserrat|nunito|work|ibm plex sans|sf pro|system/],
  ["serif", /serif|garamond|caslon|baskerville|bodoni|didot|times|georgia|roman|antiqua|playfair|tiempos|canela|freight|lyon|editorial|noe|saol|domaine|sangbleu|ogg|minion|merriweather|lora|cormorant|libre|chronicle|mercury|tiempos/],
];
function kindOf(family, unknown = "sans") {
  const name = family.toLowerCase();
  const hit = KINDS.find(([, pattern]) => pattern.test(name));
  return hit ? hit[0] : unknown;
}
// Stand-ins for each kind, the first that's here
const STAND_INS = {
  sans: ["Inter", "Helvetica Neue", "SF Pro", "Helvetica", "Arial", "Roboto"],
  serif: ["Georgia", "Times New Roman", "Playfair Display", "Source Serif 4", "PT Serif", "Times"],
  mono: ["SF Mono", "JetBrains Mono", "Roboto Mono", "Menlo", "Courier New"],
  script: ["Snell Roundhand", "Dancing Script", "Brush Script MT"],
};

// The replacement for a missing font: the same family under another spelling ("Osé" for "Ose", "Suisse Intl" for
// "Suisse Int'l") or one whose name starts the same; else a similar one, of the same kind, that the file uses most,
// or a common one. Then its style closest in weight, upright or italic alike.
function match(entry, families, used) {
  const wanted = squash(entry.family);
  const names = [...families.keys()];
  const same = (families.has(entry.family) && entry.family)
    || names.find(name => squash(name) === wanted)
    || (wanted.length >= 4 && names.find(name => squash(name).startsWith(wanted) || wanted.startsWith(squash(name)) && squash(name).length >= 4));
  const kind = kindOf(entry.family);
  // From the file only a family whose name says its kind: an unknown one may be anything
  const similar = !same && ([...(used || new Map())].filter(([family]) => kindOf(family, null) === kind && families.has(family))
    .sort((a, b) => b[1] - a[1]).map(([family]) => family)[0] || STAND_INS[kind].find(family => families.has(family)));
  const family = same || similar;
  if (!family) return null;
  return { family, style: closestStyle(entry.style, families.get(family)), same: !!same, kind };
}

function closestStyle(wanted, styles) {
  const exact = styles.find(style => squash(style) === squash(wanted));
  if (exact) return exact;
  const sameSlant = styles.filter(style => italic(style) === italic(wanted));
  const pool = sameSlant.length ? sameSlant : styles;
  const target = weightOf(wanted);
  return pool.slice().sort((a, b) => Math.abs(weightOf(a) - target) - Math.abs(weightOf(b) - target))[0];
}

// Swaps one font for another in the given layers, only where it's used
async function replaceFont(from, to, nodeIds) {
  await figma.loadFontAsync(to);
  let changed = 0;
  for (const id of nodeIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node || node.type !== "TEXT") continue;
    // Its other fonts too, where they're here
    for (const font of fontsOf(node)) await figma.loadFontAsync(font).catch(() => {});
    const same = (font) => font.family === from.family && font.style === from.style;
    if (!node.characters.length) {
      if (node.fontName !== figma.mixed && same(node.fontName)) { node.fontName = to; changed++; }
      continue;
    }
    for (const segment of node.getStyledTextSegments(["fontName"])) {
      if (same(segment.fontName)) { node.setRangeFontName(segment.start, segment.end, to); changed++; }
    }
  }
  return changed;
}

async function selectLayers(nodeIds) {
  const nodes = [];
  for (const id of nodeIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (node && "visible" in node) nodes.push(node);
  }
  const here = nodes.filter(node => { let page = node; while (page && page.type !== "PAGE") page = page.parent; return page === figma.currentPage; });
  figma.currentPage.selection = here;
  if (here.length) figma.viewport.scrollAndZoomIntoView(here);
}
