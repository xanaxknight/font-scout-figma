# Font Scout for Figma

Glyphs, missing fonts, and a Claude that can change text in any font on your computer.

Claude's own Figma tools run on Figma's servers, which only have Google Fonts and the fonts an organization shares. Text set in any other font can't even be edited there ("The font family does not exist"). Font Scout runs inside your Figma, where every font installed on your computer is available, and does the work there.

<img src="assets/icon-128.png" width="64" alt="">

## What's in the plugin

- **Glyphs.** Every character in the font where your text cursor is, Private Use alternates included. Click one to put it in at the cursor, or to copy it. Find characters by typing them or their code (`00E9`).
- **Fonts.** The fonts a page uses that aren't on your computer, each with a replacement: the same font under another name where you have it ("Osé" for "Ose"), else a similar one of the same kind. A bar offers them all at once when the plugin opens; **Replace All** is one step for ⌘Z. With the [Font Scout app](https://xanaxknight.github.io/font-scout/) running, fonts that are in your Font Scout library can be installed instead, after a yes in the app.
- **Claude.** While the plugin is open in a file, Claude can read and change its text with the fonts on your computer, through the bridge below. Each change is one step for ⌘Z, the window lists what Claude did, and you can turn scripts off.

## Install

1. **The plugin.** From Figma Community (link coming). From this repository: in the Figma desktop app, *Plugins → Development → Import plugin from manifest…* and choose `plugin/manifest.json`.
2. **The bridge, for Claude** (needs [Node.js](https://nodejs.org) 18 or later):
   - Claude Code:
     ```bash
     claude mcp add --scope user font-scout -- npx -y github:xanaxknight/font-scout-figma
     ```
   - Claude Desktop: download `font-scout.mcpb` from [Releases](https://github.com/xanaxknight/font-scout-figma/releases/latest) and open it, or add this to `mcpServers` in *Settings → Developer → Edit Config*:
     ```json
     "font-scout": { "command": "npx", "args": ["-y", "github:xanaxknight/font-scout-figma"] }
     ```
3. **Pair them, once.** Run Font Scout in a Figma file. Its Claude tab shows a 6-digit code: tell Claude, e.g. *"Pair Font Scout with code 482 913"*.

Then ask Claude for what you need: *"In the deck, change the headline to 'Spring 2027' and set the captions in Suisse Intl Medium."*

## Claude's tools

| Tool | What it does |
| --- | --- |
| `figma_status` | The files the plugin is open in, with their page and selection, and windows waiting to be paired |
| `figma_pair` | Pairs a plugin window with the code it shows |
| `figma_find_fonts` | Font families Figma can use on your computer, with their exact style names |
| `figma_get_texts` | Text layers under a layer, in the selection or on the page: text, fonts, missing fonts |
| `figma_set_text` | Replaces a text layer's text, keeping its styling |
| `figma_set_font` | Sets the font of text layers, or of some of their characters |
| `figma_run` | Runs Figma Plugin API JavaScript in the file (can be turned off in the plugin) |
| `figma_screenshot` | A picture of a layer, drawn with its real fonts |

## How it works, and what stays on your computer

- The bridge (`font-scout-mcp`) is a small Node program Claude starts. It serves the plugin on `localhost:51843` and nothing else; several Claude windows share one bridge.
- The plugin only takes commands once paired. Its key stays in Figma's storage for the plugin and in `~/.font-scout/figma.json`. Requests from web pages to the bridge's `/mcp` are turned away.
- Nothing is sent anywhere else. The only outside requests are to Google Fonts, to show the characters of a Google font that isn't installed on your computer.
- The Fonts tab talks to the Font Scout app on `localhost:51842` when it runs; the app installs fonts only after you say yes in it.

The plugin is plain JavaScript in `plugin/`, the bridge in `bin/` and `lib/`, with no dependencies.

## License

MIT
