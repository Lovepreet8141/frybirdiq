#!/usr/bin/env python3
"""
Contrast of the Close Shop surfaces (Release 2), read from src/app/globals.css
rather than copied, so a token change is re-measured, not remembered.

    python3 scripts/check-close-shop-contrast.py

Themes measured:
  customer  :root                                  (cream; the only customer theme, `.dark` mirrors it)
  staff     :root < .surface-dark < [data-surface="iq"]   (what the (app) layout renders)
Text needs 4.5:1; a graphic or the coloured edge needs 3:1. Exits non-zero on a miss.
"""
import pathlib, re, sys

CSS = (pathlib.Path(__file__).resolve().parent.parent / "src" / "app" / "globals.css").read_text()


def block(selector_re):
    m = re.search(r"^" + selector_re + r"\s*\{(.*?)^\}", CSS, re.S | re.M)
    if not m:
        sys.exit(f"selector not found: {selector_re}")
    return dict(re.findall(r"^\s*--([\w-]+):\s*([^;]+);", m.group(1), re.M))


ROOT = block(r":root")
DARK = block(r"\.surface-dark")
IQ = block(r'\[data-surface="iq"\]')


def theme(*layers):
    merged = {}
    for layer in layers:
        merged.update(layer)

    def resolve(name, depth=0):
        v = merged[name].strip()
        m = re.fullmatch(r"var\(--([\w-]+)\)", v)
        if m and depth < 10:
            return resolve(m.group(1), depth + 1)
        return v

    return resolve


def rgb(v):
    v = v.strip()
    if v.startswith("#"):
        h = v[1:]
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))
    m = re.fullmatch(r"rgba?\(([^)]*)\)", v)
    if m:
        p = [float(x) for x in m.group(1).split(",")]
        return tuple(p[:3])
    sys.exit(f"cannot read colour {v!r}")


def over(fg, alpha, bg):
    return tuple(alpha * f + (1 - alpha) * b for f, b in zip(fg, bg))


def lum(c):
    def ch(x):
        x /= 255
        return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4

    r, g, b = (ch(x) for x in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


failed = False


def check(label, fg, bg, need):
    global failed
    r = ratio(fg, bg)
    ok = r >= need
    failed |= not ok
    print(f"  {label:<58} {r:5.2f}  need {need}  {'PASS' if ok else 'FAIL'}")


cust = theme(ROOT)
print("Customer banner (closed by hours / paused) — customer theme")
surface, fg, primary = (rgb(cust(n)) for n in ("surface", "foreground", "primary"))
page = rgb(cust("background"))
check("headline + detail: foreground on banner surface", fg, surface, 4.5)
check("phone link: foreground on banner surface", fg, surface, 4.5)
check("icon + 6px edge: primary on banner surface", primary, surface, 3)
check("banner edge: primary on the page background (it must not blend in)", primary, page, 3)

for name, layers in (("Staff surface (POS strip, reason buttons, Admin panel)", (ROOT, DARK, IQ)),):
    t = theme(*layers)
    print(name)
    bgc = rgb(t("background"))
    panel = rgb(t("panel"))
    destructive = rgb(t("destructive"))
    fgc = rgb(t("foreground"))
    muted = rgb(t("muted-foreground"))
    strip = over(destructive, 0.10, bgc)
    button = over(destructive, 0.10, panel)
    check("POS closed strip: foreground on destructive/10", fgc, strip, 4.5)
    check("POS closed strip: muted 'Reason:' text on destructive/10", muted, strip, 4.5)
    check("POS reason button label: foreground on destructive/10", fgc, button, 4.5)
    check("POS closed dot / button border: destructive on background", destructive, bgc, 3)
    loss, loss_soft = rgb(t("loss")), rgb(t("loss-soft"))
    gain, gain_soft = rgb(t("gain")), rgb(t("gain-soft"))
    closed = over(loss_soft, 0.60, bgc)
    opened = over(gain_soft, 0.60, bgc)
    check("Admin CLOSED panel: foreground on loss-soft/60", fgc, closed, 4.5)
    check("Admin CLOSED panel: muted labels on loss-soft/60", muted, closed, 4.5)
    check("Admin OPEN panel: foreground on gain-soft/60", fgc, opened, 4.5)
    check("Admin OPEN panel: muted labels on gain-soft/60", muted, opened, 4.5)
    check("Admin edge: loss on background", loss, bgc, 3)
    check("Admin edge: gain on background", gain, bgc, 3)


print("Status pill and its panel (staff surface)")
t = theme(ROOT, DARK, IQ)
panel = rgb(t("panel"))
fg = rgb(t("foreground"))
muted = rgb(t("muted-foreground"))
popover = rgb(t("popover")) if "popover" in {**ROOT, **DARK, **IQ} else panel
check("pill text: foreground on panel", fg, panel, 4.5)
check("pill panel body: foreground on popover", rgb(t("popover-foreground")) if "popover-foreground" in {**ROOT, **DARK, **IQ} else fg, popover, 4.5)
check("pill panel secondary lines: muted on popover", muted, popover, 4.5)
off_bg = over(rgb(t("destructive")), 0.10, panel)
check("Orders OFF pill: foreground on destructive/10", fg, off_bg, 4.5)
check("green dot: success on panel (graphic)", rgb(t("success")), panel, 3)
check("red dot: destructive on panel (graphic)", rgb(t("destructive")), panel, 3)
check("grey dot: muted-foreground on panel (graphic)", muted, panel, 3)
check("resume button: inverse-foreground on inverse", rgb(t("inverse-foreground")), rgb(t("inverse")), 4.5)
check("switch-off button: foreground on destructive/10 over popover", fg, over(rgb(t("destructive")), 0.10, popover), 4.5)

sys.exit(1 if failed else 0)
