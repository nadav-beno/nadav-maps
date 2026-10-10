#!/usr/bin/env python3
"""
iOS home-screen images, made from our own app icon (apps/web/public/icons/icon-512.png):

- icons/apple-touch-icon.png: 180x180, opaque (iOS paints transparent pixels black).
- splash/*.png: apple-touch-startup-image launch screens, a white screen with the icon in the
  middle, for the common iPhone and iPad portrait sizes. Prints the <link> tags for index.html.

Needs Pillow (pip install pillow). Run from the repo root: python3 scripts/gen-pwa-images.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

PUBLIC = Path('apps/web/public')
ICON = Image.open(PUBLIC / 'icons/icon-512.png').convert('RGBA')
BG = (255, 255, 255)

# (CSS width, CSS height, device pixel ratio, devices) - portrait.
SCREENS = [
    (440, 956, 3, 'iPhone 16 Pro Max'),
    (402, 874, 3, 'iPhone 16 Pro'),
    (430, 932, 3, 'iPhone 14 Pro Max, 15 Plus/Pro Max, 16 Plus'),
    (393, 852, 3, 'iPhone 14 Pro, 15, 15 Pro, 16'),
    (390, 844, 3, 'iPhone 12, 13, 14, 12/13 Pro'),
    (428, 926, 3, 'iPhone 12/13 Pro Max, 14 Plus'),
    (375, 812, 3, 'iPhone X, XS, 11 Pro, 12/13 mini'),
    (414, 896, 3, 'iPhone XS Max, 11 Pro Max'),
    (414, 896, 2, 'iPhone XR, 11'),
    (375, 667, 2, 'iPhone SE (2nd/3rd), 8'),
    (1024, 1366, 2, 'iPad Pro 12.9"'),
    (834, 1194, 2, 'iPad Pro 11"'),
    (820, 1180, 2, 'iPad Air'),
    (810, 1080, 2, 'iPad 10.2"'),
    (744, 1133, 2, 'iPad mini'),
]


def rounded_icon(size: int) -> Image.Image:
    icon = ICON.resize((size, size), Image.LANCZOS)
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * 0.225), fill=255)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(icon, (0, 0), mask)
    return out


def main() -> None:
    touch = Image.new('RGB', (180, 180), BG)
    touch.paste(ICON.resize((180, 180), Image.LANCZOS), (0, 0), ICON.resize((180, 180), Image.LANCZOS))
    touch.save(PUBLIC / 'icons/apple-touch-icon.png', optimize=True)

    (PUBLIC / 'splash').mkdir(exist_ok=True)
    links = []
    for w, h, dpr, devices in SCREENS:
        pw, ph = w * dpr, h * dpr
        img = Image.new('RGB', (pw, ph), BG)
        size = 96 * dpr
        icon = rounded_icon(size)
        img.paste(icon, ((pw - size) // 2, (ph - size) // 2), icon)
        name = f'splash/launch-{pw}x{ph}.png'
        img.save(PUBLIC / name, optimize=True)
        media = f'(device-width: {w}px) and (device-height: {h}px) and (-webkit-device-pixel-ratio: {dpr}) and (orientation: portrait)'
        links.append(f'    <!-- {devices} -->\n    <link rel="apple-touch-startup-image" media="{media}" href="{name}" />')
    print('\n'.join(links))


if __name__ == '__main__':
    main()
