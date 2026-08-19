import { afterEach, describe, expect, it, vi } from 'vitest'
import { playCue, resetSound, unlockSound } from './sound'

/**
 * Pípání při cvičení.
 *
 * Testy nehlídají, jak to zní – to se ověřit nedá. Hlídají to, co by cvičení
 * shodilo: že zvuk nikde nespadne, když ho prohlížeč neumí nebo ho uživatel
 * vypnul, a že se nepřehraje bez svolení.
 */
afterEach(() => {
  resetSound()
  vi.unstubAllGlobals()
})

describe('zvuk', () => {
  it('bez prohlížeče se nic nestane a nic nespadne', () => {
    // V testech `window` není. Pípnutí kvůli tomu nesmí shodit odpočet.
    expect(() => playCue('konec')).not.toThrow()
    expect(() => unlockSound()).not.toThrow()
  })

  it('vypnutý zvuk se ani nepokouší nastartovat', () => {
    const Ctx = vi.fn()
    vi.stubGlobal('window', { AudioContext: Ctx })
    playCue('konec', false)
    expect(Ctx).not.toHaveBeenCalled()
  })

  it('zapnutý zvuk si zvukový kontext vyrobí, a jen jednou', () => {
    const Ctx = vi.fn(function (this: Record<string, unknown>) {
      this.state = 'suspended'
      this.resume = vi.fn()
      this.close = vi.fn()
    })
    vi.stubGlobal('window', { AudioContext: Ctx })
    playCue('konec', true)
    playCue('start', true)
    expect(Ctx).toHaveBeenCalledTimes(1)
  })

  it('uspaný kontext se probudí, jinak by zůstalo ticho', () => {
    const resume = vi.fn()
    const Ctx = vi.fn(function (this: Record<string, unknown>) {
      this.state = 'suspended'
      this.resume = resume
      this.close = vi.fn()
    })
    vi.stubGlobal('window', { AudioContext: Ctx })
    unlockSound()
    expect(resume).toHaveBeenCalled()
  })

  it('rozbitý zvukový kontext cvičení nezastaví', () => {
    vi.stubGlobal('window', {
      AudioContext: vi.fn(() => {
        throw new Error('audio je mimo')
      }),
    })
    expect(() => playCue('hotovo', true)).not.toThrow()
  })
})
