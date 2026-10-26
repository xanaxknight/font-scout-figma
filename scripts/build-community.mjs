// The plugin as it goes to Figma Community: Glyphs and Fonts, without the Claude tab. Figma doesn't take plugins
// that overlap with its own MCP server there, so everything between "CLAUDE {" and "} CLAUDE" in plugin/ is left
// out, and the manifest gets Figma's ID and no access to the bridge. Writes dist/community-plugin/.
//   node scripts/build-community.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "plugin"), out = path.join(root, "dist", "community-plugin");
// Markers on lines of their own, as JavaScript, HTML or CSS comments
const START = /^\s*(?:\/\/|<!--|\/\*)\s*CLAUDE \{\s*(?:-->|\*\/)?\s*$/, END = /^\s*(?:\/\/|<!--|\/\*)\s*\} CLAUDE\s*(?:-->|\*\/)?\s*$/;

function strip(text, name) {
  const kept = [];
  let inside = false;
  for (const line of text.split("\n")) {
    if (START.test(line)) { if (inside) throw new Error(`${name}: CLAUDE { inside another`); inside = true; continue; }
    if (END.test(line)) { if (!inside) throw new Error(`${name}: } CLAUDE without its start`); inside = false; continue; }
    if (!inside) kept.push(line);
  }
  if (inside) throw new Error(`${name}: CLAUDE { never closed`);
  return kept.join("\n");
}

fs.mkdirSync(out, { recursive: true });
for (const name of ["code.js", "ui.html"]) {
  const text = strip(fs.readFileSync(path.join(source, name), "utf8"), name);
  for (const left of ["51843", "AsyncFunction", "figma_pair", "pairingKey", "Claude"]) {
    if (text.includes(left)) throw new Error(`${name} still has "${left}" outside the CLAUDE markers`);
  }
  fs.writeFileSync(path.join(out, name), text);
}

const manifest = JSON.parse(fs.readFileSync(path.join(source, "manifest.json"), "utf8"));
manifest.name = "Font Scout";
manifest.id = "1696557990159965387";   // Figma's, for the Community listing
manifest.networkAccess = {
  allowedDomains: ["http://localhost:51842", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
  reasoning: "Talks to the optional Font Scout app on this computer, which installs missing fonts from the user's library when they say so. Loads Google Fonts to show the characters of fonts that aren't installed on the computer.",
};
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Built ${path.relative(root, out)}/`);
