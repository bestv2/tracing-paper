/**
 * 颜色工具：sRGB → CIELab（D65）+ CIEDE2000 色差。
 * 只依赖 Math，浏览器与 Node 通用。
 */

export type Lab = [number, number, number]

const D65 = [0.95047, 1, 1.08883] as const
const EPSILON = 216 / 24389
const KAPPA = 24389 / 27

function linear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function pivot(t: number): number {
  return t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116
}

export function rgbToLab(r: number, g: number, b: number): Lab {
  const rl = linear(r)
  const gl = linear(g)
  const bl = linear(b)
  const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / D65[0]
  const y = 0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl
  const z = (0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl) / D65[2]
  const fx = pivot(x)
  const fy = pivot(y)
  const fz = pivot(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** 相对亮度 0..255，用于结构度量（SSIM / 边缘） */
export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function rgbToHex(r: number, g: number, b: number): string {
  const hex = (value: number) => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

export function parseHex(hex: string): [number, number, number] {
  const clean = hex.trim().replace(/^#/, '')
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.slice(0, 6)
  return [
    Number.parseInt(full.slice(0, 2), 16) || 0,
    Number.parseInt(full.slice(2, 4), 16) || 0,
    Number.parseInt(full.slice(4, 6), 16) || 0,
  ]
}

/** Figma/RGBA 0..1 数组 → #rrggbb */
export function rgbaUnitToHex(color: { r: number; g: number; b: number }): string {
  return rgbToHex(color.r * 255, color.g * 255, color.b * 255)
}

const deg = (value: number) => (value * Math.PI) / 180
const rad2deg = (value: number) => (value * 180) / Math.PI

function hueOf(a: number, b: number): number {
  if (a === 0 && b === 0) return 0
  const h = rad2deg(Math.atan2(b, a))
  return h >= 0 ? h : h + 360
}

/** CIEDE2000（Sharma 2005 实现口径） */
export function deltaE2000(lab1: Lab, lab2: Lab): number {
  const [L1, a1, b1] = lab1
  const [L2, a2, b2] = lab2

  const C1 = Math.hypot(a1, b1)
  const C2 = Math.hypot(a2, b2)
  const Cbar = (C1 + C2) / 2
  const Cbar7 = Cbar ** 7
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 25 ** 7)))

  const a1p = (1 + G) * a1
  const a2p = (1 + G) * a2
  const C1p = Math.hypot(a1p, b1)
  const C2p = Math.hypot(a2p, b2)
  const h1p = hueOf(a1p, b1)
  const h2p = hueOf(a2p, b2)

  const dLp = L2 - L1
  const dCp = C2p - C1p
  const chromaProduct = C1p * C2p

  let dhp = 0
  if (chromaProduct !== 0) {
    dhp = h2p - h1p
    if (dhp > 180) dhp -= 360
    else if (dhp < -180) dhp += 360
  }
  const dHp = 2 * Math.sqrt(chromaProduct) * Math.sin(deg(dhp) / 2)

  const Lbarp = (L1 + L2) / 2
  const Cbarp = (C1p + C2p) / 2
  let hbarp = h1p + h2p
  if (chromaProduct !== 0) {
    hbarp = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + 360) / 2 : (h1p + h2p) / 2
  }

  const T =
    1 -
    0.17 * Math.cos(deg(hbarp - 30)) +
    0.24 * Math.cos(deg(2 * hbarp)) +
    0.32 * Math.cos(deg(3 * hbarp + 6)) -
    0.2 * Math.cos(deg(4 * hbarp - 63))
  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2))
  const Cbarp7 = Cbarp ** 7
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + 25 ** 7))
  const SL = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2)
  const SC = 1 + 0.045 * Cbarp
  const SH = 1 + 0.015 * Cbarp * T
  const RT = -Math.sin(deg(2 * dTheta)) * RC

  const termL = dLp / SL
  const termC = dCp / SC
  const termH = dHp / SH
  return Math.sqrt(termL * termL + termC * termC + termH * termH + RT * termC * termH)
}

/** 两个 #rrggbb 的色差，供语义层比对颜色属性 */
export function deltaEHex(from: string, to: string): number {
  const [r1, g1, b1] = parseHex(from)
  const [r2, g2, b2] = parseHex(to)
  return deltaE2000(rgbToLab(r1, g1, b1), rgbToLab(r2, g2, b2))
}
