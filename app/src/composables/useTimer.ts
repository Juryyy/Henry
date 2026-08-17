import { onUnmounted, ref } from 'vue'

/**
 * Odpočet, který se nespoléhá na počítání tiků.
 *
 * `setInterval` se v pozadí na mobilu škrtí a po deseti minutách v kapse by
 * odpočet byl mimo. Proto se pokaždé počítá rozdíl proti `Date.now()`.
 */
export function useTimer() {
  const remaining = ref(0)
  const total = ref(0)
  const running = ref(false)

  let endsAt = 0
  let handle: ReturnType<typeof setInterval> | undefined
  let onDone: (() => void) | undefined

  function stopInterval(): void {
    if (handle) clearInterval(handle)
    handle = undefined
  }

  function step(): void {
    const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
    remaining.value = left
    if (left <= 0) {
      running.value = false
      stopInterval()
      onDone?.()
    }
  }

  function start(seconds: number, done?: () => void): void {
    total.value = seconds
    remaining.value = seconds
    endsAt = Date.now() + seconds * 1000
    onDone = done
    running.value = true
    stopInterval()
    handle = setInterval(step, 200)
  }

  function pause(): void {
    if (!running.value) return
    running.value = false
    stopInterval()
    remaining.value = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
  }

  function resume(): void {
    if (running.value || remaining.value <= 0) return
    endsAt = Date.now() + remaining.value * 1000
    running.value = true
    stopInterval()
    handle = setInterval(step, 200)
  }

  function reset(): void {
    stopInterval()
    running.value = false
    remaining.value = 0
    total.value = 0
  }

  onUnmounted(stopInterval)

  return { remaining, total, running, start, pause, resume, reset }
}

/** Krátká vibrace na konci intervalu. Na iOS zatím nefunguje, jinde ano. */
export function buzz(pattern: number | number[] = 120): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // Prohlížeč to neumí – nevadí.
  }
}
