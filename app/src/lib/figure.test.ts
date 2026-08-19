import { afterEach, describe, expect, it, vi } from 'vitest'
import { EXERCISES } from '@/data/exercises'
import { FIGURES, getFigure } from '@/data/figures'
import {
  clockListenerCount,
  faceLine,
  fitView,
  GROUND_Y,
  HEAD_R,
  limbPath,
  pingPong,
  poseAt,
  spineControl,
  subscribeClock,
  TORSO_DEPTH,
  torsoEdges,
  TORSO_WIDTH,
  type Point,
  type Pose,
} from './figure'

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

describe('směr pohledu', () => {
  const dist = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1])

  it('nos čouhá ven z hlavy, ne dovnitř', () => {
    // Kdyby byl kratší než poloměr hlavy, schoval by se pod ni a obrázek
    // by o směru pohledu neřekl nic. Přesně tak to jednou vypadalo.
    for (const [id, figure] of Object.entries(FIGURES)) {
      for (const [index, pose] of figure.frames.entries()) {
        const line = faceLine(pose)
        if (!line) continue
        expect(dist(pose.head, line[1]), `${id} póza ${index}`).toBeGreaterThan(HEAD_R + 2)
      }
    }
  })

  it('nos se nezaboří do země', () => {
    // V lehu na břiše míří obličej dolů, ale hlava leží pár bodů nad zemí –
    // kolmo dolů by nos prošel podlahou. Hlídá se to i uprostřed přechodu,
    // protože se směr pohledu mezi pózami plynule otáčí.
    for (const [id, figure] of Object.entries(FIGURES)) {
      for (let phase = 0; phase < 1; phase += 0.02) {
        const tip = faceLine(poseAt(figure.frames, phase))?.[1]
        if (!tip) continue
        expect(tip[1], `${id} fáze ${phase.toFixed(2)}`).toBeLessThanOrEqual(GROUND_Y)
      }
    }
  })

  it('pohled na diváka nos nekreslí', () => {
    const front = { ...FIGURES['jumping-jacks']!.frames[0]!, look: [0, 0] as Point }
    expect(faceLine(front)).toBeNull()
  })

  it('bez zadaného směru se pohled odvodí z krku', () => {
    const pose: Pose = { ...FIGURES['prkno-na-predlokti']!.frames[0]!, look: undefined }
    const line = faceLine(pose)
    expect(line).not.toBeNull()
    // Prodloužení krku: z krku přes hlavu ven.
    expect(dist(pose.neck, line![1])).toBeGreaterThan(dist(pose.neck, pose.head))
  })
})

describe('tvar končetiny', () => {
  const nums = (d: string): number[] =>
    (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)

  it('každý úsek je vlastní podcesta', () => {
    // Jedna cesta s víc podcestami schválně: obrys se pak kreslí kolem celé
    // končetiny a švy v kloubech překryje výplň sousedního úseku.
    const d = limbPath(
      [
        [10, 10],
        [30, 10],
        [30, 40],
      ],
      [8, 6, 4],
    )
    expect(d.match(/M /g)).toHaveLength(2)
  })

  it('oblouky v kloubech míří ven, ne dovnitř', () => {
    // Obrácený oblouk vykousne kloub místo zakulacení a překryv dvou úseků
    // s opačným obtočením udělá pod pravidlem nonzero díru. Přesně tak to
    // jednou vypadalo: postavička plná černých kolečen.
    const d = limbPath(
      [
        [10, 10],
        [30, 20],
        [50, 50],
      ],
      [8, 6, 4],
    )
    const sweeps = [...d.matchAll(/A [\d.]+ [\d.]+ 0 (\d) (\d)/g)].map((m) => m[2])
    expect(sweeps.length).toBeGreaterThan(0)
    expect(new Set(sweeps)).toEqual(new Set(['0']))
  })

  it('končetina se ke konci zužuje', () => {
    const start = 9
    const end = 3
    const d = limbPath(
      [
        [20, 20],
        [20, 60],
      ],
      [start, end],
    )
    const n = nums(d)
    // Hrana je vnější tečna obou kruhů, ne kolmé odsazení osy, takže odstup
    // vychází o zlomek procenta menší než poloměr. Šířka na koncích tím pádem
    // sedí skoro přesně – ale ne na šest desetinných míst.
    const atBody = Math.abs(n[0]! - 20)
    const atEnd = Math.abs(n[2]! - 20)
    expect(atBody).toBeGreaterThan(atEnd)
    expect(atBody).toBeCloseTo(start / 2, 1)
    expect(atEnd).toBeCloseTo(end / 2, 1)
  })

  it('slepený kloub nevyrobí nesmysl, ale kolečko', () => {
    // Složená končetina, kde koleno sedí skoro na kyčli: mezi dvěma kruhy,
    // z nichž je jeden uvnitř druhého, žádný kužel neexistuje.
    const d = limbPath(
      [
        [20, 20],
        [20, 20.5],
      ],
      [9, 3],
    )
    expect(d.match(/M /g)).toHaveLength(1)
    expect(d).not.toMatch(/NaN/)
  })

  it('nikde nevznikne NaN', () => {
    for (const figure of Object.values(FIGURES)) {
      for (const pose of figure.frames) {
        const d = limbPath([pose.hip, pose.knee, pose.ankle, pose.toe], [7.8, 5.8, 4, 3.2])
        expect(d).not.toMatch(/NaN|Infinity/)
      }
    }
  })
})

describe('objem trupu', () => {
  /** Kolik z trupu leží na té straně páteře, kam míří obličej. 0,5 = souměrně. */
  function bellyShare(pose: Pose): number {
    const edges = torsoEdges(pose)!
    return Math.abs(edges.belly) / (Math.abs(edges.belly) + Math.abs(edges.back))
  }

  it('trup je z profilu tenký a zepředu široký, nic mimo tenhle rozsah', () => {
    // Kdyby hloubka utekla mimo, postavičky by v seznamu vedle sebe vypadaly
    // jako různě tlusté podle toho, kam se zrovna dívají.
    let thinnest = Infinity
    let widest = 0
    for (const [id, figure] of Object.entries(FIGURES)) {
      for (const pose of figure.frames) {
        const edges = torsoEdges(pose)!
        const depth = Math.abs(edges.belly - edges.back)
        expect(depth, id).toBeGreaterThanOrEqual(TORSO_DEPTH - 0.001)
        expect(depth, id).toBeLessThanOrEqual(TORSO_WIDTH + 0.001)
        thinnest = Math.min(thinnest, depth)
        widest = Math.max(widest, depth)
      }
    }
    // Oba konce rozsahu se v katalogu opravdu vyskytují – jinak by jedna
    // z těch dvou hodnot byla jen teorie.
    expect(thinnest).toBeCloseTo(TORSO_DEPTH, 6)
    expect(widest).toBeCloseTo(TORSO_WIDTH, 6)
  })

  it('z profilu je páteř vzadu, čelem k divákovi je trup souměrný', () => {
    // Stoj z profilu: většina objemu je před páteří, ale ne všechen –
    // páteř leží uvnitř těla, ne na jeho zadní hraně.
    expect(bellyShare(FIGURES['brisk-walk']!.frames[0]!)).toBeCloseTo(0.75, 2)
    // Jumping jacks čelem k divákovi: žádná strana zad se ukázat nedá.
    expect(bellyShare(FIGURES['jumping-jacks']!.frames[0]!)).toBeCloseTo(0.5, 6)
  })

  it('kdo leží na zádech, má břicho nahoře – a na břiše dole', () => {
    // Přesně tohle měl objem trupu vyřešit: bez něj vypadá leh na zádech
    // úplně stejně jako leh na břiše.
    const above = (id: string): number => {
      const pose = FIGURES[id]!.frames[0]!
      const edges = torsoEdges(pose)!
      // Kladné = těžiště trupu je nad páteří (y roste dolů).
      return -(edges.normal[1] * (edges.back + edges.belly)) / 2
    }
    expect(above('branicni-dychani')).toBeGreaterThan(1)
    expect(above('lodicka-na-brise')).toBeLessThan(-1)
  })

  it('při otočce se trup nepřeklopí skokem', () => {
    // Sed 90/90 překlápí kolena z jedné strany na druhou, takže postavička
    // projde čelem k divákovi. Kdyby se objem přehazoval podle znaménka,
    // tělo by uprostřed cvičení blafnulo z jedné strany na druhou.
    const frames = FIGURES['ninety-ninety-hip']!.frames
    let previous = bellyShare(poseAt(frames, 0))
    for (let phase = 0.01; phase <= 1; phase += 0.01) {
      const share = bellyShare(poseAt(frames, phase))
      expect(Math.abs(share - previous), `fáze ${phase.toFixed(2)}`).toBeLessThan(0.1)
      previous = share
    }
  })

  it('výřez sedí na postavičce, ne někde vedle', () => {
    // `look` je směr, ne bod na plátně. Když se omylem počítal do obalu,
    // výřez se natáhl až k počátku souřadnic – obrázky se nepokazily,
    // jen se scvrkly do rohu, což je přesně ten druh chyby, kterou testy
    // na „nic se neořízne" nechytí.
    for (const [id, figure] of Object.entries(FIGURES)) {
      const [x, y, w, h] = fitView(figure.frames)
      let minX = 100
      let maxX = 0
      let minY = 100
      let maxY = GROUND_Y
      for (const pose of figure.frames) {
        for (const joint of JOINTS) {
          minX = Math.min(minX, pose[joint][0])
          maxX = Math.max(maxX, pose[joint][0])
          minY = Math.min(minY, pose[joint][1])
          maxY = Math.max(maxY, pose[joint][1])
        }
      }
      // Kolem obsahu se přidává jen okraj; poměr stran se dorovnává v jednom
      // směru, ten druhý musí zůstat těsný. Tolerance pokrývá poloměr hlavy.
      const slackX = minX - x + (x + w - maxX)
      const slackY = minY - y + (y + h - maxY)
      expect(Math.min(slackX, slackY), id).toBeLessThan(24)
    }
  })

  it('výřez počítá i s trupem a nosem, nic se neořízne', () => {
    for (const [id, figure] of Object.entries(FIGURES)) {
      const [x, y, w, h] = fitView(figure.frames)
      for (const [index, pose] of figure.frames.entries()) {
        const edges = torsoEdges(pose)!
        const corners: Point[] = []
        for (const depth of [edges.back, edges.belly]) {
          for (const joint of [pose.neck, pose.hip, spineControl(pose)]) {
            corners.push([joint[0] + edges.normal[0] * depth, joint[1] + edges.normal[1] * depth])
          }
        }
        const nose = faceLine(pose)?.[1]
        if (nose) corners.push(nose)
        for (const [cx, cy] of corners) {
          expect(cx, `${id} póza ${index} x`).toBeGreaterThanOrEqual(x)
          expect(cx, `${id} póza ${index} x`).toBeLessThanOrEqual(x + w)
          expect(cy, `${id} póza ${index} y`).toBeGreaterThanOrEqual(y)
          expect(cy, `${id} póza ${index} y`).toBeLessThanOrEqual(y + h)
        }
      }
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

describe('společné hodiny', () => {
  /**
   * Smyčka `requestAnimationFrame` se musí zastavit, jakmile na stránce
   * nezůstane jediná animovaná postavička. Uniklá smyčka by běžela dál
   * v pozadí a na telefonu se to pozná na baterce.
   */
  let running = 0

  function fakeRaf(): void {
    vi.stubGlobal('requestAnimationFrame', () => {
      running++
      return running
    })
    vi.stubGlobal('cancelAnimationFrame', () => {
      running--
    })
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    running = 0
  })

  it('se rozběhnou při prvním odběrateli a stojí po posledním', () => {
    fakeRaf()
    const stopA = subscribeClock(() => {})
    const stopB = subscribeClock(() => {})
    expect(clockListenerCount()).toBe(2)
    // Druhý odběratel nesmí rozjet druhou smyčku.
    expect(running).toBe(1)

    stopA()
    expect(running).toBe(1)
    stopB()
    expect(clockListenerCount()).toBe(0)
    expect(running).toBe(0)
  })

  it('dvojité odhlášení nic nerozbije', () => {
    fakeRaf()
    const stop = subscribeClock(() => {})
    stop()
    stop()
    expect(clockListenerCount()).toBe(0)
    expect(running).toBe(0)
  })
})
