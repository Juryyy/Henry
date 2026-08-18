/**
 * Vygeneruje sadu ikon pro PWA z jednoho SVG.
 *
 *   node scripts/generate-icons.mjs
 *
 * Značka: tři stoupající sloupce a tečka – schod nahoru, ne raketa.
 * Pozadí je neprůhledné schválně: iOS u apple-touch-icon ignoruje
 * průhlednost a podložil by ji černou.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(here, '../public')
const iconsDir = resolve(publicDir, 'icons')

const BG = '#0f1115'
const GREEN_A = '#4ade80'
const GREEN_B = '#22c55e'

/**
 * @param {object} opts
 * @param {number} [opts.scale] zmenšení značky (maskable ikony potřebují rezervu)
 * @param {boolean} [opts.transparent] pozadí bez výplně
 * @param {string} [opts.mono] jednobarevná varianta (odznak v Androidu)
 */
function markSvg({ scale = 1, transparent = false, mono = '' } = {}) {
  const S = 512
  const fill = mono || 'url(#g)'
  const bars = [
    { x: 96, y: 312, w: 84, h: 104 },
    { x: 214, y: 236, w: 84, h: 180 },
    { x: 332, y: 160, w: 84, h: 256 },
  ]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <linearGradient id="g" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="${GREEN_B}"/>
      <stop offset="1" stop-color="${GREEN_A}"/>
    </linearGradient>
  </defs>
  ${transparent ? '' : `<rect width="${S}" height="${S}" fill="${BG}"/>`}
  <g transform="translate(${S / 2} ${S / 2}) scale(${scale}) translate(${-S / 2} ${-S / 2})">
    ${bars.map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="26" fill="${fill}"/>`).join('\n    ')}
    <circle cx="374" cy="106" r="30" fill="${mono || GREEN_A}"/>
  </g>
</svg>`
}

/** Malá varianta pro favicon – tři sloupce bez tečky, ať to nezaniká. */
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="${BG}"/>
  <rect x="104" y="304" width="88" height="112" rx="28" fill="${GREEN_B}"/>
  <rect x="212" y="224" width="88" height="192" rx="28" fill="${GREEN_A}"/>
  <rect x="320" y="144" width="88" height="272" rx="28" fill="${GREEN_A}"/>
</svg>`

const targets = [
  { file: 'icons/icon-192.png', size: 192, svg: markSvg() },
  { file: 'icons/icon-512.png', size: 512, svg: markSvg() },
  // Maskable: systém si z ikony ukousne okraje, značka musí zůstat uvnitř
  // vnitřních 80 %.
  { file: 'icons/icon-maskable-192.png', size: 192, svg: markSvg({ scale: 0.72 }) },
  { file: 'icons/icon-maskable-512.png', size: 512, svg: markSvg({ scale: 0.72 }) },
  // iOS: přesně 180×180 a neprůhledné pozadí.
  { file: 'icons/apple-touch-icon.png', size: 180, svg: markSvg() },
  // Android odznak: jednobarevný, průhledné pozadí.
  { file: 'icons/badge-96.png', size: 96, svg: markSvg({ transparent: true, mono: '#ffffff', scale: 0.86 }) },
]

await mkdir(iconsDir, { recursive: true })

for (const target of targets) {
  const out = resolve(publicDir, target.file)
  await sharp(Buffer.from(target.svg)).resize(target.size, target.size).png({ compressionLevel: 9 }).toFile(out)
  console.log(`✓ ${target.file} (${target.size}×${target.size})`)
}

await writeFile(resolve(publicDir, 'favicon.svg'), faviconSvg, 'utf8')
console.log('✓ favicon.svg')
