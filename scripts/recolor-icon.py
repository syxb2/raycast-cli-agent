#!/usr/bin/env python3
"""Recolor a red icon with a white mark, preserving its alpha channel.

Requires Pillow. Example:
    python3 scripts/recolor-icon.py input.png output.png --color '#DB3827'

The source must have a red background and a white foreground. Recovering
the white coverage keeps antialiased edges free of red halos.
"""

import argparse
from pathlib import Path

from PIL import Image, ImageColor


def recolor(source: Path, destination: Path, color: str) -> None:
    if source.resolve() == destination.resolve():
        raise ValueError("Choose a separate output path to preserve the source.")

    background = ImageColor.getrgb(color)
    if len(background) != 3:
        raise ValueError("Use an RGB color such as #DB3827.")

    with Image.open(source) as original:
        icon = original.convert("RGBA")

    pixels = icon.load()
    for y in range(icon.height):
        for x in range(icon.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha == 0:
                continue

            # Red background has little green/blue; white has equal channels.
            # Clamp the generated image's slight color noise at both ends.
            white = min(green, blue) / max(red, 1)
            coverage = max(0.0, min(1.0, (white - 0.06) / 0.88))
            rgb = tuple(
                round(channel * (1.0 - coverage) + 255 * coverage)
                for channel in background
            )
            pixels[x, y] = (*rgb, alpha)

    icon.save(destination, format="PNG")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--color", default="#DB3827")
    args = parser.parse_args()
    recolor(args.source, args.destination, args.color)
    print(args.destination.resolve())


if __name__ == "__main__":
    main()
