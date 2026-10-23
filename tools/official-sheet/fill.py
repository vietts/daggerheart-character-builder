"""Write characters onto the official Daggerheart character sheets.

The official "Character Sheets and Guides" PDF (daggerheart.com) is flat — no form fields —
so this draws the text on top of each page at fixed coordinates. Every class sheet in that
PDF shares one layout, so one coordinate map covers all of them; a class without its own
sheet (the Void classes) goes on the blank generic sheet at the end of the PDF, with its
class features written into the empty Class Feature box.

The numbers come from derive.mjs (and so from shared/sheet-data.js), never from here.

    python3 tools/official-sheet/fill.py --template Character-Sheets.pdf \\
        --characters export.json --out pregens/

The template stays outside the repository: its artwork is Prohibited Content under the
DPCGL (see NOTICE.md).
"""

import argparse
import io
import logging
import re
import subprocess
import sys
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import Color
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

HERE = Path(__file__).resolve().parent
PAGE_H = 792

# 1-based page numbers in the Aug 2025 edition of the PDF. The extra pages are the ones a
# player needs at the table: the Druid's Beastform lists, the Beastbound Ranger's companion.
CLASS_PAGES = {
    "core_class_bard": [1],
    "core_class_druid": [3, 4, 5],
    "core_class_guardian": [7],
    "core_class_ranger": [9],
    "core_class_rogue": [12],
    "core_class_seraph": [14],
    "core_class_sorcerer": [16],
    "core_class_warrior": [18],
    "core_class_wizard": [20],
}
GENERIC_PAGE = 22
RANGER_COMPANION_PAGE = 10

INK = Color(0.08, 0.08, 0.2)
BOX = Color(0.3, 0.3, 0.3)
FONT, BOLD = "Helvetica", "Helvetica-Bold"


def y(top):
    """Coordinates below are measured from the top of the page, as they read off a render."""
    return PAGE_H - top


def fit(c, x, top, width, text, size=9, min_size=5.5, font=FONT, align="left"):
    """One line, shrunk until it fits; cut with an ellipsis only past min_size."""
    text = text or ""
    while size > min_size and stringWidth(text, font, size) > width:
        size -= 0.25
    while text and stringWidth(text, font, size) > width:
        text = text[:-2] + "…"
    c.setFont(font, size)
    if align == "center":
        c.drawCentredString(x, y(top), text)
    else:
        c.drawString(x, y(top), text)


def wrap(text, font, size, width):
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if stringWidth(trial, font, size) <= width or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def feature_lines(c, text, first, second, size=7.5, min_size=5.5):
    """A weapon/armor feature: two ruled lines, the second starting after the FEATURE label.
    `first`/`second` are (x, top, width)."""
    if not text:
        return
    while True:
        lines = wrap(text, FONT, size, first[2])
        if len(lines) == 1:
            return fit(c, first[0], first[1], first[2], text, size)
        rest = " ".join(lines[1:])
        if stringWidth(rest, FONT, size) <= second[2] or size <= min_size:
            fit(c, first[0], first[1], first[2], lines[0], size)
            return fit(c, second[0], second[1], second[2], rest, size, min_size)
        size -= 0.25


def flat(features, with_name=True):
    """deriveSheet()'s tagged description blocks, as one line of prose per feature."""
    out = []
    for f in features or []:
        parts = []
        for d in f["description"]:
            parts.append(d["text"] if d["type"] == "paragraph" else " ".join(f"• {i}" for i in d["items"]))
        body = " ".join(parts)
        out.append(f"{f['name']}: {body}" if with_name and f["name"] else body)
    return " ".join(out)


def short_damage_type(t):
    return "phy" if t.startswith("Phys") else "mag" if t.startswith("Mag") else t.lower()


def draw_weapon(c, w, top):
    """`top` is the name line; the feature lines sit 26 and 49 points below it."""
    trait_range = " ".join(p for p in (w["traitLabel"], w["range"]) if p)
    if w["attack"] not in ("—", "") and w["traitLabel"]:
        trait_range = f"{w['traitLabel']} {w['attack']} · {w['range']}"
    elif w["attack"] not in ("—", ""):
        trait_range = f"{w['attack']} · {w['range']}"
    fit(c, 296, top - 3, 112, w["name"], 9.5, font=BOLD)
    fit(c, 416, top - 3, 92, trait_range, 8.5)
    fit(c, 512, top - 3, 80, f"{w['damage']} {short_damage_type(w['damageType'])}".strip(), 9.5, font=BOLD)
    text = flat(w["features"])
    if w["burden"]:
        text = f"{w['burden']}. {text}".strip()
    feature_lines(c, text, (296, top + 23, 296), (330, top + 46, 262))


def overlay(sheet, generic):
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(612, PAGE_H))
    c.setFillColor(INK)

    # Header
    fit(c, 211, 23.5, 180, sheet["name"], 11, font=BOLD)
    fit(c, 404, 23.5, 128, sheet["pronouns"], 9.5)
    heritage = " / ".join(sheet["ancestryNames"])
    fit(c, 200, 43.5, 166, f"{heritage} · {sheet['communityName']}", 9.5)
    sub = sheet["subclassName"]
    if generic:
        sub = f"{sheet['className']} · {sub}"
    if sheet.get("spellcast"):
        sub = f"{sub} · Spellcast: {sheet['spellcast']['display']}"
    fit(c, 374, 43.5, 158, sub, 9.5)
    fit(c, 572.5, 35, 30, str(sheet["level"]), 17, font=BOLD, align="center")

    # Evasion, Armor Score, traits
    for x, value in ((40, sheet["evasion"]), (106, sheet["armorScore"])):
        if value is not None:
            fit(c, x, 106, 34, str(value), 20, font=BOLD, align="center")
    for x, trait in zip((227.5, 295, 362, 430, 497, 564), sheet["traits"]):
        fit(c, x, 105, 40, trait["display"], 18, font=BOLD, align="center")

    # Damage thresholds (already level-adjusted) in the gaps between the three bands
    if sheet["thresholds"]:
        fit(c, 93, 203, 22, str(sheet["thresholds"]["major"]), 12, font=BOLD, align="center")
        fit(c, 181, 203, 22, str(sheet["thresholds"]["severe"]), 12, font=BOLD, align="center")

    # HP and Stress: the sheet prints the first few slots solid and the rest dashed, for the
    # player to ink in as they gain slots. Ink in the ones this character has.
    c.setStrokeColor(BOX)
    c.setLineWidth(1.1)
    for i in range(min(sheet["hitPoints"] or 0, 12)):
        c.roundRect(36.5 + i * 18.85, y(238), 15, 8, 2, stroke=1, fill=0)
    for i in range(min(sheet["stress"] or 0, 12)):
        c.roundRect(62.5 + i * 16.55, y(260), 13, 8, 2, stroke=1, fill=0)

    # Proficiency: the first circle is printed filled
    c.setFillColor(Color(0.2, 0.2, 0.2))
    for i in range(1, min(sheet["proficiency"] or 1, 6)):
        c.circle(443 + i * 12, y(176.5), 3.3, stroke=0, fill=1)
    # Every character starts with a handful of gold
    c.circle(18.8, y(517), 2.8, stroke=0, fill=1)
    c.setFillColor(INK)

    # Hope feature: printed on the class sheets, a blank line on the generic one
    if generic and sheet["hopeFeature"]:
        feature_lines(c, flat([sheet["hopeFeature"]]), (16, 325, 238), (16, 336, 238), 7, 5)

    # Experiences
    for i, exp in enumerate(sheet["experiences"][:5]):
        top = 394 + i * 19.6
        fit(c, 17, top, 195, exp["name"], 9.5)
        fit(c, 238, top, 36, exp["display"], 10, font=BOLD, align="center")

    # Weapons and armor
    for w, top in zip(sheet["weapons"], (212, 305)):
        draw_weapon(c, w, top)
    fit(c, 296, 406, 150, sheet["armorName"], 9.5, font=BOLD)
    if sheet.get("armorBase"):
        base = sheet["armorBase"]
        fit(c, 456, 406, 70, f"{base['major']} / {base['severe']}", 9.5, align="left")
        fit(c, 548, 406, 40, str(base["score"]), 9.5, font=BOLD, align="center")
    feature_lines(c, flat(sheet["armorFeatures"]), (296, 433, 296), (330, 456, 262))

    # Inventory: the starting kit every character gets, then the chosen potion
    items = ["Torch, 50 feet of rope, basic supplies"]
    if sheet["potionName"] not in ("—", ""):
        items.append(sheet["potionName"])
    for i, item in enumerate(items):
        fit(c, 296, 503 + i * 20, 290, item, 9)

    # Class features: printed on the class sheets, an empty box on the generic one
    if generic:
        text_top = 588
        for f in sheet["classFeatures"]:
            c.setFont(BOLD, 8)
            c.drawString(18, y(text_top), f["name"].upper())
            text_top += 10
            for line in wrap(flat([f], with_name=False), FONT, 7, 240):
                if text_top > 772:
                    break
                c.setFont(FONT, 7)
                c.drawString(18, y(text_top), line)
                text_top += 8.5
            text_top += 4

    c.save()
    buf.seek(0)
    return PdfReader(buf).pages[0]


def reference_pages(sheet):
    """What the official sheet has no room for: subclass, heritage and domain card text.
    Printed as plain pages after the sheet so the table needs neither app nor cards."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=(612, PAGE_H), leftMargin=40, rightMargin=40,
                            topMargin=36, bottomMargin=36, title=sheet["name"])
    h1 = ParagraphStyle("h1", fontName=BOLD, fontSize=15, leading=19, spaceAfter=4)
    h2 = ParagraphStyle("h2", fontName=BOLD, fontSize=10.5, leading=13, spaceBefore=10, spaceAfter=3,
                        textColor=Color(0.25, 0.25, 0.25))
    name = ParagraphStyle("name", fontName=BOLD, fontSize=9, leading=11.5, spaceBefore=4)
    body = ParagraphStyle("body", fontName=FONT, fontSize=8.5, leading=11)

    def esc(t):
        return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    def block(features, label=None):
        out = []
        for f in features:
            title = f["name"] + (f" ({f['source']})" if label and f.get("source") else "")
            out.append(Paragraph(esc(title), name))
            for d in f["description"]:
                if d["type"] == "paragraph":
                    out.append(Paragraph(esc(d["text"]), body))
                else:
                    out.extend(Paragraph("• " + esc(i), body) for i in d["items"])
        return out

    story = [Paragraph(esc(f"{sheet['name']} — {sheet['className']}, {sheet['subclassName']}"), h1)]
    if sheet["unresolvedChoicePrompts"]:
        story.append(Paragraph("Still to choose: " + esc("; ".join(sheet["unresolvedChoicePrompts"])), body))
    if sheet["subclassFeatures"]:
        story += [Paragraph("Subclass", h2)] + block(sheet["subclassFeatures"], label=True)
    heritage = sheet["ancestryFeatures"] + sheet["communityFeatures"]
    if heritage:
        story += [Paragraph("Heritage", h2)] + block(heritage, label=True)
    if sheet["loadout"]:
        story.append(Paragraph("Domain cards", h2))
        for card in sheet["loadout"]:
            meta = f"{card['domain'].title()} · level {card['level']} · {card['type']} · recall {card['recallCost']}"
            story.append(Paragraph(esc(f"{card['name']}  ") + f"<font name='{FONT}' size='7.5'>{esc(meta)}</font>", name))
            story += block(card["features"])[1:] if card["features"] and card["features"][0]["name"] in ("", card["name"]) \
                else block(card["features"])
    for title, text in (("Background", sheet["background"]), ("Description", sheet["appearance"]),
                        ("Connections", sheet["connections"])):
        if text:
            story += [Paragraph(title, h2), Paragraph(esc(text).replace("\n", "<br/>"), body)]
    story.append(Spacer(1, 1))
    doc.build(story)
    buf.seek(0)
    return PdfReader(buf).pages


def slug(text):
    return re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-") or "character"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--template", required=True, help="the official Character Sheets and Guides PDF")
    ap.add_argument("--characters", required=True, help="the app's Export JSON file")
    ap.add_argument("--out", required=True, help="directory for the filled PDFs")
    ap.add_argument("--no-reference", action="store_true", help="skip the feature/domain card text pages")
    args = ap.parse_args()

    logging.disable(logging.WARNING)  # pypdf grumbles about the sheet's fonts; harmless here
    derived = subprocess.run(["node", str(HERE / "derive.mjs"), args.characters],
                             capture_output=True, text=True)
    if derived.returncode:
        sys.exit(derived.stderr.strip())
    import json
    sheets = json.loads(derived.stdout)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    everyone = PdfWriter()
    for sheet in sheets:
        template = PdfReader(args.template)
        pages = CLASS_PAGES.get(sheet["classId"])
        generic = pages is None
        pages = pages or [GENERIC_PAGE]
        if sheet["classId"] == "core_class_ranger" and sheet["subclassName"] == "Beastbound":
            pages = pages + [RANGER_COMPANION_PAGE]

        writer = PdfWriter()
        for n, number in enumerate(pages):
            page = writer.add_page(template.pages[number - 1])
            if n == 0:
                page.merge_page(overlay(sheet, generic))
        if not args.no_reference:
            for page in reference_pages(sheet):
                writer.add_page(page)

        path = out / f"{slug(sheet['name'])}.pdf"
        with open(path, "wb") as fh:
            writer.write(fh)
        everyone.append(str(path))
        print(f"{path}  ({sheet['className']}{' — generic sheet' if generic else ''})")

    if len(sheets) > 1:
        with open(out / "all-pregens.pdf", "wb") as fh:
            everyone.write(fh)
        print(out / "all-pregens.pdf")


if __name__ == "__main__":
    main()
