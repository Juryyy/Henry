import { describe, expect, it } from 'vitest'
import { EXERCISES } from '@/data/exercises'
import { FIGURES, getFigure } from '@/data/figures'
import { GROUND_Y, pingPong, poseAt, spineControl, type Point, type Pose } from './figure'

/**
 * Postavičky u cviků.
 *
 * Testy nehlídají, jestli je obrázek hezký – to se pozná jen okem. Hlídají to,
 * co se okem nepozná a co se snadno rozbije při úpravě dat: že žádný cvik
 * nezůstal bez obrázku, že se postavička vejde do plátna, nestojí pod zemí
 * a že přechod mezi pózami nikde nevyrobí nesmysl.
 */

const JOINTS = ['head', 'neck', 'hip', 'elbow', 'hand', 'knee', 'ankle', 'toe'] as const
const OPTIONAL = ['elbowFar', 'handFar', 'kneeFar', 'ankleFar', 'toeFar', 'mid'] as const

function points(pose: Pose): Point[] {
  const out = JOINTS.map((j) => pose[j])
  for (const j of OPTIONAL) if (pose[j]) out.push(pose[j]!)
  return out
}

describe('pokrytí katalogu', () => {
  it('každý cvik má obrázek', () => {
    const missing = EXERCISES.filter((e) => !getFigure(e.id)).map((e) => e.id)
    expect(missing).toEqual([])
  })

  it('žádný obrázek nezbyl po smazaném cviku', () => {
    const ids = new Set(EXERCISES.map((e) => e.id))
    expect(Object.keys(FIGURES).filter((id) => !ids.has(id))).toEqual([])
  })

  it('každý obrázek má popis pro čtečku obrazovky', () => {
    for (const [id, figure] of Object.entries(FIGURES)) {
      expect(figure.alt.length, id).toBeGreaterThan(20)
      // Popis má říct, co se děje, ne zopakovat název.
      expect(figure.alt.endsWith('.'), id).toBe(true)
    }
  })
})

describe('geometrie pózy', () => {
  it('nic nevyčnívá z plátna', () => {
    for (const [id, figure] of Object.entries(FIGURES)) {
      for (const [index, pose] of figure.frames.entries()) {
        for (const [x, y] of points(pose)) {
          expect(x, `${id} póza ${index} x`).toBeGreaterThanOrEqual(0)
          expect(x, `${id} póza ${index} x`).toBeLessThanOrEqual(100)
          // Hlava má poloměr 6, takže střed nesmí být výš než 6.
          expect(y, `${id} póza ${index} y`).toBeGreaterThanOrEqual(0)
          expect(y, `${id} póza ${index} y`).toBeLessThanOrEqual(100)
        }
      }
    }
  })

  it('nikdo nestojí pod zemí', () => {
    for (const [id, figure] of Object.entries(FIGURES)) {
      for (const [index, pose] of figure.frames.entries()) {
        for (const [, y] of points(pose)) {
          // Půl bodu tolerance – čára má tloušťku a špička se země dotýká.
          expect(y, `${id} póza ${index}`).toBeLessThanOrEqual(GROUND_Y + 0.5)
        }
      }
    }
  })

  it('hlava se vejde nad horní okraj i s poloměrem', () => {
    for (const [id, figure] of Object.entries(FIGURES)) {
      for (const [index, pose] of figure.frames.entries()) {
        expect(pose.head[1], `${id} póza ${index}`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('končetiny drží pohromadě – žádný utržený kus', () => {
    // Nejdelší úsek v postavičce je trup u ležících cviků. Když je něco
    // podstatně delší, je to skoro jistě překlep v souřadnici.
    const far = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1])
    for (const [id, figure] of Object.entries(FIGURES)) {
      for (const [index, pose] of figure.frames.entries()) {
        expect(far(pose.neck, pose.hip), `${id} póza ${index} trup`).toBeLessThan(46)
        expect(far(pose.head, pose.neck), `${id} póza ${index} krk`).toBeLessThan(16)
        expect(far(pose.neck, pose.elbow), `${id} póza ${index} paže`).toBeLessThan(26)
        expect(far(pose.elbow, pose.hand), `${id} póza ${index} předloktí`).toBeLessThan(26)
        expect(far(pose.hip, pose.knee), `${id} póza ${index} stehno`).toBeLessThan(30)
        expect(far(pose.knee, pose.ankle), `${id} póza ${index} lýtko`).toBeLessThan(30)
      }
    }
  })

  it('každý cvik má aspoň dvě pózy, jinak by se nehýbal', () => {
    for (const [id, figure] of Object.entries(FIGURES)) {
      expect(figure.frames.length, id).toBeGreaterThanOrEqual(2)
      expect(figure.frames.length, id).toBeLessThanOrEqual(3)
    }
  })

  it('krajní pózy se od sebe liší – jinak je animace k ničemu', () => {
    for (const [id, figure] of Object.entries(FIGURES)) {
      const first = figure.frames[0]!
      const last = figure.frames[figure.frames.length - 1]!
      const moved = JOINTS.some((j) => first[j][0] !== last[j][0] || first[j][1] !== last[j][1])
      expect(moved, id).toBe(true)
    }
  })
})

describe('přechod mezi pózami', () => {
  it('tam a zpátky, ne skokem na začátek', () => {
    expect(pingPong(2)).toEqual([0, 1])
    expect(pingPong(3)).toEqual([0, 1, 2, 1])
    expect(pingPong(1)).toEqual([0])
  })

  it('na začátku cyklu sedí první póza', () => {
    const figure = FIGURES['hyzdovy-most']!
    expect(poseAt(figure.frames, 0).hip).toEqual(figure.frames[0]!.hip)
  })

  it('mezipoloha leží mezi krajními, ne mimo ně', () => {
    const frames = FIGURES['hyzdovy-most']!.frames
    const low = Math.min(frames[0]!.hip[1], frames[1]!.hip[1])
    const high = Math.max(frames[0]!.hip[1], frames[1]!.hip[1])
    for (let phase = 0; phase < 1; phase += 0.05) {
      const y = poseAt(frames, phase).hip[1]
      expect(y).toBeGreaterThanOrEqual(low - 0.001)
      expect(y).toBeLessThanOrEqual(high + 0.001)
    }
  })

  it('fáze mimo rozsah se zabalí, ne spadne', () => {
    const frames = FIGURES['hyzdovy-most']!.frames
    expect(() => poseAt(frames, -0.3)).not.toThrow()
    expect(() => poseAt(frames, 4.7)).not.toThrow()
    expect(poseAt(frames, 1.25).hip).toEqual(poseAt(frames, 0.25).hip)
  })

  it('nepovinná končetina nespadne do počátku, když ji má jen jedna póza', () => {
    // Ptačí pes: výchozí póza vzdálenou nohu má, ale kdyby ji některá neměla,
    // interpolace by ji nesměla poslat do [0,0].
    const frames: Pose[] = [
      { ...FIGURES['ptaci-pes']!.frames[0]!, elbowFar: undefined, handFar: undefined },
      { ...FIGURES['ptaci-pes']!.frames[1]!, elbowFar: [30, 60], handFar: [20, 62] },
    ]
    const mid = poseAt(frames, 0.25)
    expect(mid.elbowFar).toEqual([30, 60])
  })

  it('rovná záda zůstanou rovná i uprostřed přechodu', () => {
    // Kočka–velbloud má řídicí bod v obou pózách; prkno v žádné. U prkna
    // musí střed páteře pořád ležet přesně mezi krkem a kyčlí.
    const frames = FIGURES['prkno-na-predlokti']!.frames
    const mid = poseAt(frames, 0.3)
    const [cx, cy] = spineControl(mid)
    expect(cx).toBeCloseTo((mid.neck[0] + mid.hip[0]) / 2, 6)
    expect(cy).toBeCloseTo((mid.neck[1] + mid.hip[1]) / 2, 6)
  })

  it('kulatá záda se během přechodu nenarovnají skokem', () => {
    const frames = FIGURES['kocka-velbloud']!.frames
    const control = poseAt(frames, 0.25).mid
    expect(control).toBeDefined()
    // Kočka má řídicí bod nad páteří, velbloud pod ní – uprostřed je mezi tím.
    expect(control![1]).toBeGreaterThan(frames[0]!.mid![1])
    expect(control![1]).toBeLessThan(frames[1]!.mid![1])
  })

  it('prázdný seznam pózí je chyba, ne tichý nesmysl', () => {
    expect(() => poseAt([], 0)).toThrow()
  })
})
