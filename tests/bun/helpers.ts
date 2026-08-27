/**
 * Bun-native behavioral test helpers.
 *
 * Deliberately avoids `node:test` mocks and vitest utilities so that the only
 * code under test is Cordis itself running on Bun. Timing assertions use real
 * timers with generous margins (Bun's test runner has no fake timers).
 */

export function spy<F extends (...args: any[]) => any>(impl?: F) {
  const calls: any[][] = []
  const wrapped = ((...args: any[]) => {
    calls.push(args)
    return impl?.(...args as any[])
  }) as F & { calls: any[][]; reset(): void }
  wrapped.calls = calls
  wrapped.reset = () => { calls.length = 0 }
  return wrapped
}

export function sleep(ms = 0) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

export const event = 'custom-event'

export function getHookSnapshot(ctx: any) {
  const result: Record<string, number> = {}
  for (const [name, callbacks] of Object.entries(ctx.events._hooks)) {
    if ((callbacks as any[]).length) result[name] = (callbacks as any[]).length
  }
  return result
}
