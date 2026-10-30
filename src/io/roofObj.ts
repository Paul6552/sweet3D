import type { BufferGeometry } from 'three'
import { argbToCss } from '../model/colors'
import type { Surface, TextureRef } from '../model/home'

export interface RoofObj {
  obj: string
  mtl: string
  /** Texturbilder, die neben dem MTL liegen müssen (Dateiname → Textur). */
  textures: Map<string, TextureRef>
  /** Umgebender Quader in Szenenkoordinaten (x, Höhe, Plan-y). */
  min: [number, number, number]
  max: [number, number, number]
}

const MATERIALS = ['roof_top', 'roof_underside', 'roof_sides']
const fixed = (n: number) => String(Math.round(n * 1000) / 1000)

/**
 * Dachgeometrie aus roofGeometry als OBJ mit MTL für Sweet Home 3D: eine Materialgruppe je Fläche,
 * Farben bzw. Texturen der Oberflächen, sonst {@code colors}. Die UV in cm werden auf die Kachelgröße
 * der Textur umgerechnet.
 */
export function roofObj(geometry: BufferGeometry, surfaces: (Surface | undefined)[], colors: string[], name: string): RoofObj {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const uv = geometry.getAttribute('uv')
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  const lines = [`# ${name}`, '# Sweet3D', 'mtllib roof.mtl']
  for (let i = 0; i < position.count; i++) {
    const p = [position.getX(i), position.getY(i), position.getZ(i)]
    p.forEach((v, k) => {
      min[k] = Math.min(min[k], v)
      max[k] = Math.max(max[k], v)
    })
    lines.push(`v ${p.map(fixed).join(' ')}`)
  }
  for (let i = 0; i < normal.count; i++) lines.push(`vn ${fixed(normal.getX(i))} ${fixed(normal.getY(i))} ${fixed(normal.getZ(i))}`)
  const textures = new Map<string, TextureRef>()
  const mtl = ['# Sweet3D']
  for (const group of geometry.groups) {
    const index = group.materialIndex ?? 0
    const surface = surfaces[index]
    const texture = surface?.texture ?? null
    for (let i = group.start; i < group.start + group.count; i++) {
      const [w, h] = texture ? [texture.width || 100, texture.height || 100] : [100, 100]
      lines.push(`vt ${fixed(uv.getX(i) / w)} ${fixed(uv.getY(i) / h)}`)
    }
    lines.push(`g ${MATERIALS[index]}`, `usemtl ${MATERIALS[index]}`)
    for (let i = group.start; i < group.start + group.count; i += 3) {
      lines.push(`f ${[i, i + 1, i + 2].map((k) => `${k + 1}/${k + 1}/${k + 1}`).join(' ')}`)
    }
    const css = surface?.color != null && !texture ? argbToCss(surface.color) : colors[index]
    const rgb = [1, 3, 5].map((k) => fixed(Number.parseInt(css.slice(k, k + 2), 16) / 255)).join(' ')
    mtl.push('', `newmtl ${MATERIALS[index]}`, `Ka ${rgb}`, `Kd ${texture ? '1 1 1' : rgb}`, 'Ks 0 0 0', 'illum 1')
    if (texture) {
      const file = `${MATERIALS[index]}${extension(texture.image)}`
      textures.set(file, texture)
      mtl.push(`map_Kd ${file}`)
    }
  }
  return { obj: lines.join('\n') + '\n', mtl: mtl.join('\n') + '\n', textures, min, max }
}

function extension(image: string): string {
  const match = /\.(png|jpe?g|gif|bmp)$/i.exec(image)
  return match ? `.${match[1].toLowerCase()}` : '.png'
}
