# The blank font the plugin's window measures characters against: every character there is, empty and zero wide.
# Put after a font in a CSS stack, it takes every character that font lacks, so a character measures wider than
# zero only when the font itself has it. Prints the font as base64, for BLANK_FONT in ui.html.
# usage: python3 make_blank_font.py   (needs fontTools)
import base64
import io

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib.tables._c_m_a_p import CmapSubtable

builder = FontBuilder(1000, isTTF=True)
builder.setupGlyphOrder([".notdef", "blank"])
builder.setupCharacterMap({})
empty = TTGlyphPen(None).glyph()
builder.setupGlyf({".notdef": empty, "blank": empty})
builder.setupHorizontalMetrics({".notdef": (0, 0), "blank": (0, 0)})
builder.setupHorizontalHeader(ascent=800, descent=-200)
builder.setupNameTable({"familyName": "FS Blank", "styleName": "Regular"})
builder.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
builder.setupPost()

# Every code point but the surrogates, all to the one blank glyph: format 13 keeps that to two ranges
everything = CmapSubtable.newSubtable(13)
everything.platformID, everything.platEncID, everything.language = 3, 10, 0
everything.cmap = {point: "blank" for point in range(0x10FFFF + 1) if not 0xD800 <= point <= 0xDFFF}
builder.font["cmap"].tables = [everything]

out = io.BytesIO()
builder.font.save(out)
print(base64.b64encode(out.getvalue()).decode())
