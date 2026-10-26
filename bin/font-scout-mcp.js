#!/usr/bin/env node
// font-scout-mcp: Claude's tools for changing text in Figma with the fonts on this computer, carried out by the
// Font Scout plugin in Figma. Claude starts it and talks to it over stdin and stdout (MCP).
import { start } from "../lib/stdio.js";

start();
