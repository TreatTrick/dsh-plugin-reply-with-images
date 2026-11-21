import { expect, it } from 'vitest'
import { CandidateStore, type ReplyScope } from '../src/candidates.js'
import type { SearchImage } from '../src/search/types.js'

const image: SearchImage = {
  provider: 'baidu',
  title: 'Panda',
  imageUrl: 'https://img1.baidu.com/panda.jpg',
  sourceUrl: 'https://example.com/panda',
  license: 'unknown',
}
const scope: ReplyScope = { owner: {}, turn: 1 }

it('scopes candidates to the same Agent object and turn', () => {
  const store = new CandidateStore()
  const [candidate] = store.add(scope, [image])
  expect(() => store.claim({ owner: {}, turn: 1 }, [candidate!.candidateId], 2)).toThrow()
  expect(() => store.claim({ ...scope, turn: 2 }, [candidate!.candidateId], 2)).toThrow()
  expect(() => store.add(scope, [image])).toThrow(/previous turn/)
})

it('consumes search budget on failure and resets it only for a new turn', () => {
  const store = new CandidateStore()
  store.reserveSearch(scope, 2)
  store.reserveSearch(scope, 2)
  expect(() => store.reserveSearch(scope, 2)).toThrow(/image searches/)
  expect(() => store.reserveSearch({ ...scope, turn: 2 }, 2)).not.toThrow()
})

it('counts image budgets and preserves valid selections when an excessive request is rejected', () => {
  const store = new CandidateStore()
  const candidates = store.add(scope, [image, image, image])
  store.claim(scope, [candidates[0]!.candidateId], 2)
  expect(() =>
    store.claim(scope, [candidates[1]!.candidateId, candidates[2]!.candidateId], 2),
  ).toThrow(/images/)
  expect(store.claim(scope, [candidates[1]!.candidateId], 2)).toHaveLength(1)
  expect(() => store.claim(scope, [candidates[2]!.candidateId], 2)).toThrow(/images/)
})

it('rejects duplicate or consumed candidates and invalidates candidates after cleanup', () => {
  const store = new CandidateStore()
  const id = store.add(scope, [image])[0]!.candidateId
  expect(() => store.claim(scope, [id, id], 2)).toThrow(/duplicates/)
  expect(store.claim(scope, [id], 2)).toHaveLength(1)
  expect(() => store.claim(scope, [id], 2)).toThrow(/already used/)
  store.clear(scope.owner)
  expect(() => store.claim(scope, [id], 2)).toThrow(/expired/)
})

it('independently reserves search and image counts without charging a rejected batch', () => {
  const store = new CandidateStore()
  store.reservePreparation(scope, 1, 4, 3, 5)
  const budget = expect.objectContaining({ code: 'REPLY_IMAGES_BUDGET_EXCEEDED' })
  expect(() => store.reservePreparation(scope, 1, 2, 3, 5)).toThrow(budget)
  expect(() => store.reservePreparation(scope, 3, 1, 3, 5)).toThrow(budget)
  store.reservePreparation(scope, 2, 1, 3, 5)
  expect(() => store.reserveSearch(scope, 3)).toThrow(budget)
  expect(() => store.reservePreparation({ owner: {}, turn: 1 }, 3, 5, 3, 5)).not.toThrow()
  expect(() => store.reservePreparation({ ...scope, turn: 2 }, 3, 5, 3, 5)).not.toThrow()
})
