from PIL import Image, ImageDraw, ImageFont

FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'
def f(size, bold=False):
    return ImageFont.truetype(FONT, size, index=1 if bold else 0)

INK = '#14100c'
PAPER = '#f7f2ea'
CARD = '#fffdfa'
LINE = '#e2d8c9'
MUTED = '#8a8073'
ACCENT = '#c8542a'
DARK = '#171310'

W, H = 390, 844
img = Image.new('RGB', (W, H), PAPER)
d = ImageDraw.Draw(img)

def text(xy, s, size, color=INK, bold=False, anchor='la'):
    d.text(xy, s, font=f(size, bold), fill=color, anchor=anchor)

def card(box, radius=12):
    d.rounded_rectangle(box, radius=radius, fill=CARD, outline=LINE, width=1)

# 顶部栏
d.rectangle((0, 0, W, 56), fill='#fbf7f0')
d.line((0, 56, W, 56), fill=LINE, width=1)
text((20, 28), 'Atlas.Commerce', 13, INK, True, 'lm')
for i, y in enumerate((21, 27, 33)):
    d.line((358, y, 376, y), fill=INK, width=2)
d.ellipse((326, 17, 348, 39), fill='#e6d9c6')

# 标题
text((20, 74), '今日运营概览', 26, INK, True)
text((20, 116), '聚合同步状态、库存水位与渠道转化，', 11, MUTED)
text((20, 134), '用于每天早上 10 点的例行巡检。', 11, MUTED)

# KPI 2×2
kpis = [
    ('GMV', '¥486,210', '+12.4%'),
    ('订单', '3,182', '+4.1%'),
    ('客单价', '¥152.7', '-1.8%'),
    ('退款率', '1.24%', '+0.2%'),
]
for i, (label, value, delta) in enumerate(kpis):
    x = 20 + (i % 2) * 182
    y = 160 + (i // 2) * 92
    card((x, y, x + 168, y + 82))
    text((x + 14, y + 13), label, 10, MUTED)
    text((x + 14, y + 33), value, 20, INK, True)
    text((x + 14, y + 62), delta, 9, ACCENT)

# 深色横幅
d.rounded_rectangle((20, 348, 370, 436), radius=14, fill=DARK)
text((36, 364), '春季新品池已开放报名', 15, PAPER, True)
text((36, 390), '3 月 18 日前完成商品图与卖点补齐，', 10, '#b6a898')
text((36, 406), '可进入首页新品频道首屏。', 10, '#b6a898')
d.rounded_rectangle((294, 392, 354, 418), radius=6, fill=PAPER)
text((324, 405), '去报名', 10, INK, True, 'mm')

# 商品明细
text((20, 456), '商品明细', 14, INK, True)
text((370, 460), '共 128 条', 10, MUTED, False, 'ra')
rows = [
    ('亚麻短袖衬衫 / 米白', '天猫 · 库存 1,240', '正常', '#e7f0e6', '#3f6b45'),
    ('工装直筒裤 / 卡其', '抖音 · 库存 86', '低库存', '#f7e3dc', '#b1542f'),
    ('手工皮质托特包 / 深棕', '京东 · 库存 512', '正常', '#e7f0e6', '#3f6b45'),
]
card((20, 480, 370, 648))
for i, (name, meta, chip, chip_bg, chip_fg) in enumerate(rows):
    top = 480 + i * 56
    text((36, top + 11), name, 12, INK, True)
    text((36, top + 30), meta, 10, MUTED)
    d.rounded_rectangle((306, top + 18, 354, top + 38), radius=10, fill=chip_bg)
    text((330, top + 28), chip, 9, chip_fg, False, 'mm')
    if i < 2:
        d.line((36, top + 56, 354, top + 56), fill='#efe7db', width=1)

# 渠道转化
card((20, 660, 370, 778))
text((36, 670), '近 7 日渠道转化', 12, INK, True)
bars = [38, 48, 42, 58, 40, 36, 64]
for i, h in enumerate(bars):
    x = 36 + i * 36
    color = ACCENT if h == max(bars) else '#cbb094'
    d.rounded_rectangle((x, 754 - h, x + 22, 754), radius=4, fill=color)
    text((x + 11, 758), ['一', '二', '三', '四', '五', '六', '日'][i], 9, MUTED, False, 'ma')

# 底部 tab
d.rectangle((0, 788, W, H), fill=CARD)
d.line((0, 788, W, 788), fill=LINE, width=1)
for i, label in enumerate(('首页', '商品', '渠道', '我的')):
    cx = 48 + i * 98
    color = ACCENT if i == 0 else '#b3a898'
    d.ellipse((cx - 5, 800, cx + 5, 810), fill=color)
    text((cx, 824), label, 9, color, i == 0, 'mm')

img.save('/Users/wangduo/workspace/visual-inspector/.e2e/assets/design-mobile.png')
print('ok', img.size)
