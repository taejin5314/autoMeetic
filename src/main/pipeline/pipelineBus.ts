import { log } from '../telemetry/logger'
import type { PipelineEvent, PipelineSubscriber } from './types'

export class PipelineBus {
  private subscribers: PipelineSubscriber[] = []

  register(sub: PipelineSubscriber): () => void {
    this.subscribers.push(sub)
    return () => {
      const i = this.subscribers.indexOf(sub)
      if (i >= 0) this.subscribers.splice(i, 1)
    }
  }

  emit(event: PipelineEvent): void {
    for (const sub of this.subscribers) {
      try {
        const result = sub.onEvent(event)
        if (result instanceof Promise) {
          result.catch((err) => this.logFailure(sub.name, event, err))
        }
      } catch (err) {
        this.logFailure(sub.name, event, err)
      }
    }
  }

  private logFailure(name: string, event: PipelineEvent, err: unknown): void {
    log('error', 'pipeline', 'pipeline.subscriber.failed', {
      subscriber: name,
      event: event.type,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
