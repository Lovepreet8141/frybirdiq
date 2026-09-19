#!/usr/bin/env python3
"""
Contrast of the IQ readiness panel and the "Limited data" badge (staff surface),
read from src/app/globals.css. Text needs 4.5:1, a graphic 3:1. Exits non-zero
on a miss.

    python3 scripts/check-readiness-contrast.py
"""
import importlib.util, pathlib, sys

here = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("cs", here / "check-close-shop-contrast.py")
# Reuse the helpers without running that script's own checks: exec only the helper part.
src = (here / "check-close-shop-contrast.py").read_text().split('cust = theme(ROOT)')[0]
ns = {"__file__": str(here / "check-close-shop-contrast.py")}
exec(compile(src, "helpers", "exec"), ns)
theme, rgb, over, check = ns["theme"], ns["rgb"], ns["over"], ns["check"]
ROOT, DARK, IQ = ns["ROOT"], ns["DARK"], ns["IQ"]

t = theme(ROOT, DARK, IQ)
panel, bg = rgb(t("panel")), rgb(t("background"))
fg, muted = rgb(t("foreground")), rgb(t("muted-foreground"))
surface = rgb(t("surface"))
print("IQ readiness panel (staff surface)")
check("figures and labels: foreground on panel", fg, panel, 4.5)
check("definitions and counts: muted on panel", muted, panel, 4.5)
check("action box text: foreground on surface", fg, surface, 4.5)
check("action box muted heading: muted on surface", muted, surface, 4.5)
check("trend up text: gain on panel", rgb(t("gain")), panel, 4.5)
check("trend down / red stock text: loss on panel", rgb(t("loss")), panel, 4.5)
check("bar fill (ok): gain on muted track", rgb(t("gain")), rgb(t("muted")), 3)
check("bar fill (limited): flag on muted track", rgb(t("flag")), rgb(t("muted")), 3)
print("Limited data badge")
check("badge text: flag on flag-soft", rgb(t("flag")), rgb(t("flag-soft")), 4.5)
check("badge text over a card: flag on flag-soft over panel", rgb(t("flag")), over(rgb(t("flag-soft")), 1.0, panel), 4.5)
sys.exit(1 if ns["failed"] else 0)
