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
  assert.deepEqual([...mod.inject].sort(), ['betterSidebar', 'layout', 'sessions', 'sidebarRight'].sort())
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

test('the panel width is never restored from storage', () => {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8')
  assert.equal(bundle.includes('dsh-ai-mind:width'), false)
  assert.equal(bundle.includes('readStoredWidth'), false)
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

test('the dock is pinned to the 品型 floor before the panel opens', () => {
  global.document = {
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: () => {} },
  }
  const widths = []
  const ctx = fakeContext(() => {}, {})
  ctx.layout = {
    panels: {
      setRightbar: (px) => widths.push(px),
    },
  }
  const mod = loadBundle()
  mod.apply(ctx)
  assert.deepEqual(widths, [380], 'apply sets the dock to 380px, not the host 45%')
  delete global.document
  delete global.window
})

test('width pinning falls back when ctx.layout throws without inject', () => {
  global.document = {
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: () => {} },
  }
  const widths = []
  const ctx = fakeContext(() => {}, {})
  Object.defineProperty(ctx, 'layout', {
    get: () => {
      throw new Error('cannot get property "layout" without inject')
    },
  })
  ctx.get = (name) => (name === 'layout' ? { panels: { setRightbar: (px) => widths.push(px) } } : undefined)
  const mod = loadBundle()
  mod.apply(ctx)
  assert.deepEqual(widths, [380], 'the service is read through ctx.get instead')
  delete global.document
  delete global.window
})

test('width pinning retries until the layout service is available', async () => {
  global.document = {
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: () => {} },
  }
  const widths = []
  let layout
  const ctx = fakeContext(() => {}, {})
  Object.defineProperty(ctx, 'layout', { get: () => layout })
  const mod = loadBundle()
  mod.apply(ctx)
  assert.deepEqual(widths, [], 'nothing to pin before the service exists')
  layout = { panels: { setRightbar: (px) => widths.push(px) } }
  await delay(200)
  assert.deepEqual(widths, [380], 'the retry pins the width once the service appears')
  delete global.document
  delete global.window
})

test('the layout presets are 380px single column and 640px 品型', () => {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8')
  assert.ok(bundle.includes('const PANEL_SINGLE_WIDTH = 380'), 'the single-column preset is 380px')
  assert.ok(bundle.includes('const PANEL_DOUBLE_WIDTH = 640'), 'the two-column preset is 640px')
  assert.ok(bundle.includes('@container aim (max-width: 460px)'), 'a 380px panel stacks')
})

test('the model latency readout probes the live model on a configurable cadence', () => {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8')
  assert.ok(bundle.includes("dsh-ai-mind/latency'"), 'the client calls the latency route')
  assert.ok(bundle.includes('const LATENCY_PROBE_MS = 30_000'), 'the default sample cadence is 30s')
  assert.ok(bundle.includes('settings.probeSeconds * 1000'), 'the panel probes at the configured interval')
  assert.ok(bundle.includes('settings.probe && working'), 'the probe only runs while the task is working')
  assert.ok(bundle.includes('模型空闲，已暂停采样'), 'an idle panel says it stopped sampling')
  assert.ok(bundle.includes("h('span', null, '延时')"), 'the probe is labelled 延时 in the metrics row')
  const server = fs.readFileSync(path.join(__dirname, '..', 'lib', 'index.js'), 'utf8')
  assert.ok(server.includes("path: '/dsh-ai-mind/latency'"), 'the server registers the latency route')
  assert.ok(server.includes('max_tokens: 1'), 'the probe asks for a single token')
})

test('the plugin routes require the authenticated DSH session and bound upstream work', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'lib', 'index.js'), 'utf8')
  assert.equal(
    (server.match(/connection\.requestRejection\(req\)/g) || []).length,
    2,
    'both routes reuse the host browser-session check',
  )
  assert.ok(server.includes("redirect: 'error'"), 'upstream redirects cannot forward the API key')
  assert.ok(server.includes('const LATENCY_PENDING_LIMIT = 8'), 'the probe concurrency is capped')
  assert.ok(server.includes('const LATENCY_WINDOW_LIMIT = 60'), 'the probe rate is capped')
  assert.ok(server.includes('const MAX_UPSTREAM_BYTES = 64 * 1024'), 'upstream bodies are bounded')
  assert.ok(server.includes("base.protocol !== 'https:'"), 'the overridden base URL must be https')
})

test('the panel keeps its own surface so dark mode is really dark', () => {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8')
  assert.ok(bundle.includes('M19.4 15a1.65'), 'the settings button is a cog, not a sun')
  assert.ok(!bundle.includes("'data-phase': mind.phase"), 'the host glass rule targets [data-phase] and would erase the panel background')
})

test('the panel settings page can switch the probe and set the cadence and width', () => {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8')
  assert.ok(bundle.includes("const SETTINGS_KEY = 'dsh-ai-mind:settings'"), 'settings persist per browser')
  assert.ok(bundle.includes('const PROBE_MIN_SECONDS = 10'), 'the probe interval has a floor')
  assert.ok(bundle.includes('const PROBE_MAX_SECONDS = 600'), 'the probe interval has a ceiling')
  assert.ok(bundle.includes('const PANEL_MIN_WIDTH = 320'), 'the width setting has a floor')
  assert.ok(bundle.includes('const PANEL_MAX_WIDTH = 960'), 'the width setting has a ceiling')
  assert.ok(bundle.includes("'实时延时探测'"), 'the probe switch is explained')
  assert.ok(bundle.includes('max_tokens=1'), 'the settings explain the one-token probe cost')
  assert.ok(bundle.includes("'打开宽度'"), 'the panel width is configurable')
  assert.ok(bundle.includes("'单列'"), 'the settings offer a one-click single-column preset')
  assert.ok(bundle.includes("'双列'"), 'the settings offer a one-click two-column preset')
  assert.ok(bundle.includes('readSettings().width'), 'the first paint uses the configured width')
})
