import { randomUUID } from 'node:crypto'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { SearchImage } from './search/types.js'

/** The Agent object and committed turn jointly determine the candidate lifetime. */
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
  attachments: Set<string>
  searches: number
  images: number
}

/** Harness persists stable error codes in tool/result so the model can continue in text. */
export class ReplyImagesError extends HarnessError {
  constructor(
    message: string,
    code: 'REPLY_IMAGES_BUDGET_EXCEEDED' | 'REPLY_IMAGES_CANDIDATE_INVALID' | 'REPLY_IMAGES_CLOSED',
  ) {
    super(message, code)
  }
}

/** Manage turn budgets, session isolation, and candidate consumption before asynchronous downloads. */
export class CandidateStore {
  private readonly states = new WeakMap<object, TurnState>()

  private state(scope: ReplyScope): TurnState {
    let state = this.states.get(scope.owner)
    if (state !== undefined && state.turn > scope.turn)
      throw new ReplyImagesError('The previous turn has ended.', 'REPLY_IMAGES_CANDIDATE_INVALID')
    if (state?.turn !== scope.turn) {
      state = {
        turn: scope.turn,
        candidates: new Map(),
        claimed: new Set(),
        attachments: new Set(),
        searches: 0,
        images: 0,
      }
      this.states.set(scope.owner, state)
    }
    return state
  }

  /** 记录同一轮已展示的附件，避免后续准备重复使用。 */
  rememberAttachment(scope: ReplyScope, id: string): boolean {
    const { attachments } = this.state(scope)
    if (attachments.has(id)) return false
    attachments.add(id)
    return true
  }

  /** Each network search consumes one search allowance, even if the provider fails. */
  reserveSearch(scope: ReplyScope, limit: number): void {
    const state = this.state(scope)
    if (state.searches >= limit)
      throw new ReplyImagesError(
        `At most ${limit} image searches are allowed per turn. Continue with a text answer.`,
        'REPLY_IMAGES_BUDGET_EXCEEDED',
      )
    state.searches += 1
  }

  /** 在开始准备图片前原子预留整批搜索与图片额度。 */
  reservePreparation(
    scope: ReplyScope,
    searchCount: number,
    imageCount: number,
    searchLimit: number,
    imageLimit: number,
  ): void {
    const state = this.state(scope)
    if (state.searches + searchCount > searchLimit || state.images + imageCount > imageLimit)
      throw new ReplyImagesError(
        `Preparing ${imageCount} images with ${searchCount} searches exceeds the remaining per-turn budget. Continue with text or request fewer images.`,
        'REPLY_IMAGES_BUDGET_EXCEEDED',
      )
    state.searches += searchCount
    state.images += imageCount
  }

  /** Publish candidates with unique IDs; new turns do not inherit previous candidates. */
  add(scope: ReplyScope, images: readonly SearchImage[]): Candidate[] {
    const state = this.state(scope)
    return images.map((image) => {
      const candidate = { ...image, candidateId: `img_${randomUUID()}` }
      state.candidates.set(candidate.candidateId, candidate)
      return candidate
    })
  }

  /** Validate the entire selection and reserve its budget atomically, rejecting duplicate, used, or foreign IDs. */
  claim(scope: ReplyScope, ids: readonly string[], limit: number): Candidate[] {
    const state = this.state(scope)
    if (ids.length === 0 || new Set(ids).size !== ids.length)
      throw new ReplyImagesError(
        'Select image candidates without duplicates.',
        'REPLY_IMAGES_CANDIDATE_INVALID',
      )
    const selected = ids.map((id) => {
      const image = state.candidates.get(id)
      if (image === undefined || state.claimed.has(id))
        throw new ReplyImagesError(
          'The candidate has expired or was already used. Select unused candidates from the current turn.',
          'REPLY_IMAGES_CANDIDATE_INVALID',
        )
      return image
    })
    if (state.images + ids.length > limit)
      throw new ReplyImagesError(
        `At most ${limit} images may be displayed per turn. Continue with a text answer.`,
        'REPLY_IMAGES_BUDGET_EXCEEDED',
      )
    state.images += ids.length
    ids.forEach((id) => state.claimed.add(id))
    return selected
  }

  /** Release state on Agent disposal; ordinary stop callbacks do not reset the current turn budget. */
  clear(owner: object): void {
    this.states.delete(owner)
  }
}
