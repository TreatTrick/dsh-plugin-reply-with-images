import { expect, it } from 'vitest'
import { CandidateStore, type ReplyScope } from '../src/candidates.js'
import type { SearchImage } from '../src/search/types.js'

const image: SearchImage = {
  provider: 'baidu',
  title: '熊猫',
  imageUrl: 'https://img1.baidu.com/panda.jpg',
  sourceUrl: 'https://example.com/panda',
  license: 'unknown',
}
const scope: ReplyScope = { owner: {}, turn: 1 }

it('候选只属于同一个 Agent 对象和轮次', () => {
  const store = new CandidateStore()
  const [candidate] = store.add(scope, [image])
  expect(() => store.claim({ owner: {}, turn: 1 }, [candidate!.candidateId], 2)).toThrow()
  expect(() => store.claim({ ...scope, turn: 2 }, [candidate!.candidateId], 2)).toThrow()
  expect(() => store.add(scope, [image])).toThrow(/旧轮次/)
})

it('搜索失败也消耗预算，仅新轮次重新获得预算', () => {
  const store = new CandidateStore()
  store.reserveSearch(scope, 2)
  store.reserveSearch(scope, 2)
  expect(() => store.reserveSearch(scope, 2)).toThrow(/搜图/)
  expect(() => store.reserveSearch({ ...scope, turn: 2 }, 2)).not.toThrow()
})

it('按图片数量累计预算，超额拒绝不消耗有效选择', () => {
  const store = new CandidateStore()
  const candidates = store.add(scope, [image, image, image])
  store.claim(scope, [candidates[0]!.candidateId], 2)
  expect(() =>
    store.claim(scope, [candidates[1]!.candidateId, candidates[2]!.candidateId], 2),
  ).toThrow(/图片/)
  expect(store.claim(scope, [candidates[1]!.candidateId], 2)).toHaveLength(1)
  expect(() => store.claim(scope, [candidates[2]!.candidateId], 2)).toThrow(/图片/)
})

it('拒绝重复和已消耗的候选，清理后候选失效', () => {
  const store = new CandidateStore()
  const id = store.add(scope, [image])[0]!.candidateId
  expect(() => store.claim(scope, [id, id], 2)).toThrow(/重复/)
  expect(store.claim(scope, [id], 2)).toHaveLength(1)
  expect(() => store.claim(scope, [id], 2)).toThrow(/已使用/)
  store.clear(scope.owner)
  expect(() => store.claim(scope, [id], 2)).toThrow(/过期/)
})
