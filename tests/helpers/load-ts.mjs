import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
const require = createRequire(import.meta.url)
export function loader(overrides = {}, env = {}, globals = {}) {
  const cache = new Map()
  function load(path) {
    const url = new URL(path, new URL('../', import.meta.url))
    if (cache.has(url.href)) return cache.get(url.href)
    const exports = {}; cache.set(url.href, exports)
    vm.runInNewContext(ts.transpileModule(readFileSync(url, 'utf8'), { fileName: url.pathname, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
      ...globals, exports, URL, process: { env }, require(name) {
        if (name in overrides) return overrides[name]
        if (name === 'server-only') return {}
        if (name.startsWith('.') || name.startsWith('@/')) {
          const base = name.startsWith('@/') ? new URL(`../../src/${name.slice(2)}`, import.meta.url) : new URL(name, url)
          const file = ['.ts', '.tsx'].map(extension => `${base.href}${extension}`).find(file => existsSync(new URL(file)))
          if (!file) throw Error(`Missing dependency ${name}`)
          return load(file)
        }
        return require(name)
      },
    })
    return exports
  }
  return load
}
