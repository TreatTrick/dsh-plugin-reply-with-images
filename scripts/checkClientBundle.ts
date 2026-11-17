import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

interface ClientRegistration {
  id: string
  factory: (require: (name: string) => never) => { apply: (ctx: unknown) => void }
}

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const path: string = manifest.exports['./client']
const code = await readFile(new URL(path, root), 'utf8')
let registration: ClientRegistration | undefined
runInNewContext(code, {
  window: {
    __ModuleLoader__: {
      load: (value: ClientRegistration) => {
        registration = value
      },
    },
  },
})
assert.equal(registration?.id, manifest.name)
assert.ok(registration)
const exports = registration.factory((name) => {
  throw new Error(`Unexpected client external: ${name}`)
})
assert.equal(typeof exports.apply, 'function')
let effects = 0
exports.apply({
  effect: (register: unknown) => {
    assert.equal(typeof register, 'function')
    effects += 1
  },
})
assert.equal(effects, 1)
assert.equal(manifest.dsh.client.platform, 'web')
process.stdout.write(
  `Verified ${path}: DSH loader registration, no external modules, and deferred Cordis effect\n`,
)
