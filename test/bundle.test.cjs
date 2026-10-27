'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const vm = require('node:vm')

function loadBundle() {
  let definition
  const window = {
    __ModuleLoader__: {
      load(next) { definition = next },
    },
  }
  const file = path.join(__dirname, '..', 'lib', 'client.js')
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window, require: () => ({}), setTimeout, clearTimeout }, { filename: file })
  // timers are part of the browser realm the bundle expects
  assert.equal(definition.id, 'dsh-ai-mind')
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: (value) => [value, () => {}],
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useRef: (value) => ({ current: value }),
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }
  return definition.factory((name) => {
    assert.equal(name, 'react')
    return react
  })
}

function fakeContext(onTab, options = {}) {
  const noop = () => {}
  const mounted = {
    getSnapshot: () => options.mountedId,
    subscribe: () => noop,
  }
  return {
    effect: (fn) => {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : noop
    },
    betterSidebar: {
      registerTab: (descriptor) => {
        onTab(descriptor)
        return noop
      },
      openTab: noop,
    },
    sidebarRight: {
      mounted,
      openTab: () => {
        options.opens = (options.opens || 0) + 1
      },
      active: () => options.active,
      close: (id) => {
        options.closed = id
      },
    },
    sessions: {
      list: {
        getSnapshot: () => ({ byId: options.byId || {} }),
      },
    },
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('client bundle applies cleanly and registers the right-sidebar tab', () => {
  let tab = null
  global.document = {
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: () => {} },
  }
  const mod = loadBundle()
  assert.deepEqual([...mod.inject].sort(), ['betterSidebar', 'sessions', 'sidebarRight'].sort())
  mod.apply(fakeContext((descriptor) => { tab = descriptor }))
  assert.ok(tab, 'a tab descriptor is registered')
  assert.equal(tab.id, 'dsh-ai-mind:mind')
  assert.equal(tab.single, true)
  assert.equal(typeof tab.component, 'function')
  assert.equal(tab.title, 'AI 心流')
  delete global.document
  delete global.window
})

test('bundle carries the package version for the footer', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8')
  assert.ok(bundle.includes(`const AI_MIND_VERSION = ${JSON.stringify(pkg.version)}`))
})

test('blank sessions never auto-open the sidebar tab', async () => {
  global.document = {
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: () => {} },
  }
  const options = {
    mountedId: 's-blank',
    byId: { 's-blank': { id: 's-blank', blank: true } },
    opens: 0,
  }
  const mod = loadBundle()
  mod.apply(fakeContext(() => {}, options))
  await delay(350)
  assert.equal(options.opens, 0, 'no open for a blank session')
  delete global.document
  delete global.window
})

test('a blank home also closes a tab left open by the previous session', async () => {
  global.document = {
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: () => {} },
  }
  const options = {
    mountedId: 's-blank',
    byId: { 's-blank': { id: 's-blank', blank: true } },
    active: { id: 'tab-1', type: 'dsh-ai-mind:mind' },
  }
  const mod = loadBundle()
  mod.apply(fakeContext(() => {}, options))
  await delay(350)
  assert.equal(options.closed, 'tab-1', 'the mind tab is closed on the blank home')
  delete global.document
  delete global.window
})

test('a real conversation auto-opens the tab', async () => {
  global.document = {
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: () => {} },
  }
  const options = {
    mountedId: 's-live',
    byId: { 's-live': { id: 's-live', blank: false } },
    opens: 0,
  }
  const mod = loadBundle()
  mod.apply(fakeContext(() => {}, options))
  await delay(350)
  assert.equal(options.opens, 1, 'the tab opens for a real session')
  delete global.document
  delete global.window
})
