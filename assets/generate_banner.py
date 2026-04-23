#!/usr/bin/env python3
"""Generate banner image for Zotero Agent README."""

from PIL import Image, ImageDraw, ImageFont
import os

# Paths
script_dir = os.path.dirname(os.path.abspath(__file__))
logo_path = "/Users/haozhihui02/Downloads/duck.jpeg"
output_path = os.path.join(script_dir, "banner.png")

# Banner dimensions
WIDTH = 800
HEIGHT = 200
PADDING = 40
LOGO_SIZE = 120

# Colors
BG_COLOR = (26, 26, 46)  # Dark blue #1a1a2e
TEXT_COLOR = (255, 255, 255)  # White
TAGLINE_COLOR = (160, 174, 192)  # Gray #a0aec0
ACCENT_COLOR = (79, 172, 254)  # Blue #4facfe

# Create banner
banner = Image.new('RGB', (WIDTH, HEIGHT), BG_COLOR)
draw = ImageDraw.Draw(banner)

# Load and resize logo
logo = Image.open(logo_path)
logo = logo.resize((LOGO_SIZE, LOGO_SIZE), Image.Resampling.LANCZOS)

# Make logo circular with anti-aliasing
mask = Image.new('L', (LOGO_SIZE * 4, LOGO_SIZE * 4), 0)
mask_draw = ImageDraw.Draw(mask)
mask_draw.ellipse((0, 0, LOGO_SIZE * 4, LOGO_SIZE * 4), fill=255)
mask = mask.resize((LOGO_SIZE, LOGO_SIZE), Image.Resampling.LANCZOS)

# Paste logo
logo_x = PADDING + 20
logo_y = (HEIGHT - LOGO_SIZE) // 2
banner.paste(logo, (logo_x, logo_y), mask)

# Draw circle border around logo
draw.ellipse(
    (logo_x - 3, logo_y - 3, logo_x + LOGO_SIZE + 3, logo_y + LOGO_SIZE + 3),
    outline=ACCENT_COLOR,
    width=3
)

# Text position
text_x = logo_x + LOGO_SIZE + 40
text_y_title = HEIGHT // 2 - 35
text_y_tagline = HEIGHT // 2 + 15

# Try to load fonts (fallback to default if not available)
font_paths = [
    "/System/Library/AssetsV2/com_apple_MobileAsset_Font7/3419f2a427639ad8c8e139149a287865a90fa17e.asset/AssetData/PingFang.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
]

title_font = None
tagline_font = None

for font_path in font_paths:
    try:
        title_font = ImageFont.truetype(font_path, 48)
        tagline_font = ImageFont.truetype(font_path, 20)
        print(f"Using font: {font_path}")
        break
    except Exception as e:
        continue

if title_font is None:
    title_font = ImageFont.load_default()
    tagline_font = ImageFont.load_default()
    print("Using default font")

# Draw title
draw.text((text_x, text_y_title), "Zotero Agent", font=title_font, fill=TEXT_COLOR)

# Draw tagline
draw.text((text_x, text_y_tagline), "给你的 Zotero 装上大脑", font=tagline_font, fill=TAGLINE_COLOR)

# Add decorative dots
draw.ellipse((WIDTH - 60, 35, WIDTH - 50, 45), fill=(*ACCENT_COLOR, 128))
draw.ellipse((WIDTH - 85, 55, WIDTH - 77, 63), fill=(0, 242, 254))
draw.ellipse((WIDTH - 50, 70, WIDTH - 44, 76), fill=(*ACCENT_COLOR, 80))

# Save
banner.save(output_path, "PNG", quality=95)
print(f"Banner saved to: {output_path}")
