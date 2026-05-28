import { describe, expect, it, vi } from 'vitest'
import { PipelineBus } from '../main/pipeline/pipelineBus'
import type { PipelineEvent, PipelineSubscriber } from '../main/pipeline/types'

const ev: PipelineEvent = { type: 'turn-source-updated', id: 's1', text: 'hi' }

function sub(name: string, onEvent: PipelineSubscriber['onEvent']): PipelineSubscriber {
  return { name, onEvent }
}

describe('PipelineBus', () => {
  it('delivers events to all subscribers', () => {
    const bus = new PipelineBus()
    const a = vi.fn()
    const b = vi.fn()
    bus.register(sub('a', a))
    bus.register(sub('b', b))
    bus.emit(ev)
    expect(a).toHaveBeenCalledWith(ev)
    expect(b).toHaveBeenCalledWith(ev)
  })

  it('runs subscribers in registration order', () => {
    const bus = new PipelineBus()
    const order: string[] = []
    bus.register(sub('first', () => void order.push('first')))
    bus.register(sub('second', () => void order.push('second')))
    bus.register(sub('third', () => void order.push('third')))
    bus.emit(ev)
    expect(order).toEqual(['first', 'second', 'third'])
  })

  it('isolates a synchronous throw: later subscribers still run', () => {
    const bus = new PipelineBus()
    const after = vi.fn()
    bus.register(sub('boom', () => {
      throw new Error('sync boom')
    }))
    bus.register(sub('after', after))
    expect(() => bus.emit(ev)).not.toThrow()
    expect(after).toHaveBeenCalledWith(ev)
  })

  it('isolates an async rejection: emit does not reject and later subs run', async () => {
    const bus = new PipelineBus()
    const after = vi.fn()
    bus.register(sub('asyncBoom', async () => {
      throw new Error('async boom')
    }))
    bus.register(sub('after', after))
    bus.emit(ev)
    expect(after).toHaveBeenCalledWith(ev)
    await Promise.resolve()
  })

  it('unregister stops delivery', () => {
    const bus = new PipelineBus()
    const a = vi.fn()
    const off = bus.register(sub('a', a))
    off()
    bus.emit(ev)
    expect(a).not.toHaveBeenCalled()
  })
})
