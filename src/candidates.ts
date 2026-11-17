import { randomUUID } from 'node:crypto'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { SearchImage } from './search/types.js'

/** 同一个 Agent 对象和已提交轮次共同确定候选生命周期。 */
export interface ReplyScope {
  owner: object
  turn: number
}
export interface Candidate extends SearchImage {
  candidateId: string
}
interface TurnState {
  turn: number
  candidates: Map<string, Candidate>
  claimed: Set<string>
  searches: number
  images: number
}

/** 稳定错误码由 Harness 保存到 tool/result，模型可据此继续文字回答。 */
export class ReplyImagesError extends HarnessError {
  constructor(
    message: string,
    code: 'REPLY_IMAGES_BUDGET_EXCEEDED' | 'REPLY_IMAGES_CANDIDATE_INVALID' | 'REPLY_IMAGES_CLOSED',
  ) {
    super(message, code)
  }
}

/** 管理逐轮预算、会话隔离和候选消耗；所有预留在异步下载前完成。 */
export class CandidateStore {
  private readonly states = new WeakMap<object, TurnState>()

  private state(scope: ReplyScope): TurnState {
    let state = this.states.get(scope.owner)
    if (state !== undefined && state.turn > scope.turn)
      throw new ReplyImagesError('旧轮次已经结束。', 'REPLY_IMAGES_CANDIDATE_INVALID')
    if (state?.turn !== scope.turn) {
      state = {
        turn: scope.turn,
        candidates: new Map(),
        claimed: new Set(),
        searches: 0,
        images: 0,
      }
      this.states.set(scope.owner, state)
    }
    return state
  }

  /** 一次网络搜索占一次预算，即使上游失败也计数。 */
  reserveSearch(scope: ReplyScope, limit: number): void {
    const state = this.state(scope)
    if (state.searches >= limit)
      throw new ReplyImagesError(
        `本轮最多搜图 ${limit} 次，请继续文字回答。`,
        'REPLY_IMAGES_BUDGET_EXCEEDED',
      )
    state.searches += 1
  }

  /** 发布有唯一 ID 的候选；新轮次不会继承旧候选。 */
  add(scope: ReplyScope, images: readonly SearchImage[]): Candidate[] {
    const state = this.state(scope)
    return images.map((image) => {
      const candidate = { ...image, candidateId: `img_${randomUUID()}` }
      state.candidates.set(candidate.candidateId, candidate)
      return candidate
    })
  }

  /** 校验完整选择后原子预留图片张数，拒绝重复、已用及其他会话的 ID。 */
  claim(scope: ReplyScope, ids: readonly string[], limit: number): Candidate[] {
    const state = this.state(scope)
    if (ids.length === 0 || new Set(ids).size !== ids.length)
      throw new ReplyImagesError('请选择不重复的图片候选。', 'REPLY_IMAGES_CANDIDATE_INVALID')
    const selected = ids.map((id) => {
      const image = state.candidates.get(id)
      if (image === undefined || state.claimed.has(id))
        throw new ReplyImagesError(
          '候选已过期或已使用，请选择本轮未使用的候选。',
          'REPLY_IMAGES_CANDIDATE_INVALID',
        )
      return image
    })
    if (state.images + ids.length > limit)
      throw new ReplyImagesError(
        `本轮最多展示 ${limit} 张图片，请继续文字回答。`,
        'REPLY_IMAGES_BUDGET_EXCEEDED',
      )
    state.images += ids.length
    ids.forEach((id) => state.claimed.add(id))
    return selected
  }

  /** Agent 被销毁时释放状态；普通停止回调不会重置同轮预算。 */
  clear(owner: object): void {
    this.states.delete(owner)
  }
}
