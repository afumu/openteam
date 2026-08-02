import { describe, expect, it, vi } from 'vitest'
import { RENDER_WAKE_INTERVAL_MS, RENDER_WAKE_VISIBLE_MS, createRenderWakeScheduler } from './renderWake'

describe('createRenderWakeScheduler', () => {
  it('does not activate the role tab immediately after scheduling', async () => {
    vi.useFakeTimers()
    const update = vi.fn<(tabId: number, active: { active: boolean }) => Promise<unknown>>().mockResolvedValue({})
    const query = vi.fn().mockResolvedValue([{ id: 10 }])
    const scheduler = createRenderWakeScheduler({ update, query })

    scheduler.schedule(101, 10)
    await vi.advanceTimersByTimeAsync(RENDER_WAKE_INTERVAL_MS - 1)

    expect(update).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('briefly activates the role tab after the render interval and restores the previously active tab', async () => {
    vi.useFakeTimers()
    const update = vi.fn<(tabId: number, active: { active: boolean }) => Promise<unknown>>().mockResolvedValue({})
    const query = vi.fn().mockResolvedValue([{ id: 77 }])
    const scheduler = createRenderWakeScheduler({ update, query })

    scheduler.schedule(101, 10)
    await vi.advanceTimersByTimeAsync(RENDER_WAKE_INTERVAL_MS)
    expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true })
    expect(update).toHaveBeenCalledWith(101, { active: true })

    await vi.advanceTimersByTimeAsync(RENDER_WAKE_VISIBLE_MS)
    expect(update).toHaveBeenLastCalledWith(77, { active: true })
    vi.useRealTimers()
  })

  it('keeps waking the role tab until the schedule is cancelled', async () => {
    vi.useFakeTimers()
    const update = vi.fn<(tabId: number, active: { active: boolean }) => Promise<unknown>>().mockResolvedValue({})
    const query = vi.fn().mockResolvedValue([{ id: 10 }])
    const scheduler = createRenderWakeScheduler({ update, query })

    scheduler.schedule(101, 10)
    await vi.advanceTimersByTimeAsync(RENDER_WAKE_INTERVAL_MS + RENDER_WAKE_VISIBLE_MS)
    await vi.advanceTimersByTimeAsync(RENDER_WAKE_INTERVAL_MS + RENDER_WAKE_VISIBLE_MS)

    expect(update.mock.calls.filter(([tabId]) => tabId === 101)).toHaveLength(2)
    expect(update.mock.calls.filter(([tabId]) => tabId === 10)).toHaveLength(2)
    vi.useRealTimers()
  })

  it('cancels scheduled render wakes after a reply arrives', async () => {
    vi.useFakeTimers()
    const update = vi.fn<(tabId: number, active: { active: boolean }) => Promise<unknown>>().mockResolvedValue({})
    const query = vi.fn().mockResolvedValue([{ id: 10 }])
    const scheduler = createRenderWakeScheduler({ update, query })

    scheduler.schedule(101, 10)
    scheduler.cancel(101)
    await vi.advanceTimersByTimeAsync(RENDER_WAKE_INTERVAL_MS + RENDER_WAKE_VISIBLE_MS)

    expect(update).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('restores the previous active tab when cancelled during a wake cycle', async () => {
    vi.useFakeTimers()
    const update = vi.fn<(tabId: number, active: { active: boolean }) => Promise<unknown>>().mockResolvedValue({})
    const query = vi.fn().mockResolvedValue([{ id: 10 }])
    const scheduler = createRenderWakeScheduler({ update, query })

    scheduler.schedule(101, 10)
    await vi.advanceTimersByTimeAsync(RENDER_WAKE_INTERVAL_MS)
    expect(update).toHaveBeenLastCalledWith(101, { active: true })

    scheduler.cancel(101)
    await vi.advanceTimersByTimeAsync(RENDER_WAKE_VISIBLE_MS)

    expect(update).toHaveBeenLastCalledWith(10, { active: true })
    vi.useRealTimers()
  })

  it('serializes wake cycles when multiple role tabs are generating', async () => {
    vi.useFakeTimers()
    const update = vi.fn<(tabId: number, active: { active: boolean }) => Promise<unknown>>().mockResolvedValue({})
    const query = vi.fn().mockResolvedValue([{ id: 10 }])
    const scheduler = createRenderWakeScheduler({ update, query })

    scheduler.schedule(101, 10)
    scheduler.schedule(102, 10)
    await vi.advanceTimersByTimeAsync(RENDER_WAKE_INTERVAL_MS)

    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenLastCalledWith(101, { active: true })

    await vi.advanceTimersByTimeAsync(RENDER_WAKE_VISIBLE_MS)
    expect(update.mock.calls.slice(0, 3)).toEqual([
      [101, { active: true }],
      [10, { active: true }],
      [102, { active: true }],
    ])

    await vi.advanceTimersByTimeAsync(RENDER_WAKE_VISIBLE_MS)
    expect(update.mock.calls.slice(0, 4)).toEqual([
      [101, { active: true }],
      [10, { active: true }],
      [102, { active: true }],
      [10, { active: true }],
    ])
    vi.useRealTimers()
  })
})
