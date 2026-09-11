#!/usr/bin/env python3
"""
Checks every brand colour pair against WCAG 2.2 AA.

Referenced by design-system/accessibility.md. Run after adding or changing any
colour so the contrast table in that file stays true rather than aspirational.

    python3 scripts/check-contrast.py

Exits non-zero if a pair marked as body text drops below 4.5:1.
"""

import json
import pathlib
import sys

TOKENS = pathlib.Path(__file__).resolve().parent.parent / "design-system" / "tokens.json"


def channel(value: int) -> float:
    c = value / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(hex_colour: str) -> float:
    h = hex_colour.lstrip("#")
    r, g, b = (int(h[i : i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def ratio(a: str, b: str) -> float:
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


# fg, bg, must pass AA for body text
PAIRS = [
    # Customer site — cream ground.
    ("ink", "cream", True),
    ("ink", "creamHi", True),
    ("muted", "cream", True),
    ("muted", "creamHi", True),
    ("creamHi", "red", True),          # button label on a red fill
    ("redInk", "cream", True),         # red used as small text
    ("red", "cream", False),           # known: 4.15 — display type and fills only
    ("borderStrong", "cream", False),  # 3.04 — UI component boundary, not text
    ("creamHi", "ink", True),          # footer
]

STAFF_PAIRS = [
    ("cream", "charred", True),
    ("cream", "charred2", True),
    ("ash", "charred", True),
    ("amber", "charred", True),
    ("ember", "charred", False),       # known: 3.21 — large text and fills only
    ("cream", "ember", True),
    ("charred", "amber", True),
]


def main() -> int:
    colors = json.loads(TOKENS.read_text())["color"]
    palette = {name: spec["value"] for name, spec in colors["brand"].items()}
    palette.update({name: spec["value"] for name, spec in colors["staff"].items()})

    failures = []
    print(f"{'pair':<26} {'ratio':>6}  {'AA body':<8} {'AA large':<9}")
    print("-" * 54)

    for fg, bg, body_required in PAIRS + STAFF_PAIRS:
        value = ratio(palette[fg], palette[bg])
        body_ok = value >= 4.5
        large_ok = value >= 3.0
        note = "" if body_required else "   (large text and fills only)"
        print(
            f"{fg + ' on ' + bg:<26} {value:>6.2f}  "
            f"{'PASS' if body_ok else 'FAIL':<8} {'PASS' if large_ok else 'FAIL':<9}{note}"
        )
        if body_required and not body_ok:
            failures.append(f"{fg} on {bg} is {value:.2f}:1, below the 4.5:1 floor for body text")
        if not large_ok:
            failures.append(f"{fg} on {bg} is {value:.2f}:1, below 3:1 — unusable at any size")

    if failures:
        print("\nFAILED:")
        for failure in failures:
            print(f"  {failure}")
        return 1

    print("\nAll pairs within their stated limits.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
