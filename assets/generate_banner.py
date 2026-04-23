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
PADDING = 30
LOGO_SIZE = 160

# Colors - blue theme
BG_COLOR = (26, 26, 46)  # Dark blue #1a1a2e
TEXT_COLOR = (255, 255, 255)  # White
ACCENT_COLOR = (79, 172, 254)  # Blue #4facfe

# Create banner
banner = Image.new('RGBA', (WIDTH, HEIGHT), BG_COLOR)
draw = ImageDraw.Draw(banner)

# Load logo
logo = Image.open(logo_path).convert('RGBA')
width, height = logo.size

# Create a mask to identify background (outside the black outline)
# Use flood fill from corners to find external yellow background
from collections import deque

pixels = logo.load()
visited = [[False] * height for _ in range(width)]
background_pixels = set()

def is_yellow_bg(r, g, b):
    """Check if pixel is yellow background color"""
    return r > 240 and g > 190 and g < 220 and b < 20

def is_black_outline(r, g, b):
    """Check if pixel is part of black outline"""
    return r < 60 and g < 60 and b < 60

# Flood fill from all four corners
queue = deque()
for start_x, start_y in [(0, 0), (width-1, 0), (0, height-1), (width-1, height-1)]:
    queue.append((start_x, start_y))

while queue:
    x, y = queue.popleft()
    if x < 0 or x >= width or y < 0 or y >= height:
        continue
    if visited[x][y]:
        continue
    visited[x][y] = True

    r, g, b, a = pixels[x, y]

    # Stop at black outline
    if is_black_outline(r, g, b):
        continue

    # Mark as background if it's yellow
    if is_yellow_bg(r, g, b):
        background_pixels.add((x, y))
        # Continue flood fill
        for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            queue.append((x + dx, y + dy))

# Replace only background pixels
for x, y in background_pixels:
    pixels[x, y] = (BG_COLOR[0], BG_COLOR[1], BG_COLOR[2], 255)

# Resize logo
logo = logo.resize((LOGO_SIZE, LOGO_SIZE), Image.Resampling.LANCZOS)

# Logo position
logo_x = PADDING + 20
logo_y = (HEIGHT - LOGO_SIZE) // 2

# Paste logo
banner.paste(logo, (logo_x, logo_y), logo)

# Text position - vertically centered with duck
text_x = logo_x + LOGO_SIZE + 30
text_y_title = HEIGHT // 2 - 48
text_y_tagline = HEIGHT // 2 - 2

# Try to load fonts
font_paths = [
    "/System/Library/AssetsV2/com_apple_MobileAsset_Font7/3419f2a427639ad8c8e139149a287865a90fa17e.asset/AssetData/PingFang.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
]

title_font = None
for font_path in font_paths:
    try:
        title_font = ImageFont.truetype(font_path, 36)
        print(f"Using font: {font_path}")
        break
    except:
        continue

if title_font is None:
    title_font = ImageFont.load_default()
    print("Using default font")

# Draw title
draw.text((text_x, text_y_title), "Zotero Agent", font=title_font, fill=TEXT_COLOR)

# Draw tagline - same size and color as title
draw.text((text_x, text_y_tagline), "给你的 Zotero 装上大脑", font=title_font, fill=TEXT_COLOR)

# Add decorative dots in upper right corner
draw.ellipse((WIDTH - 60, 35, WIDTH - 50, 45), fill=ACCENT_COLOR)
draw.ellipse((WIDTH - 85, 55, WIDTH - 77, 63), fill=(0, 242, 254))
draw.ellipse((WIDTH - 50, 70, WIDTH - 44, 76), fill=ACCENT_COLOR)

# Save as RGB
banner = banner.convert('RGB')
banner.save(output_path, "PNG", quality=95)
print(f"Banner saved to: {output_path}")
