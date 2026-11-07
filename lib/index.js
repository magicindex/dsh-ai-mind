export const name = 'dsh-ai-mind'

export const inject = ['webServer', 'credentials', 'connection']

const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const CACHE_MS = 60_000
const TIMEOUT_MS = 9_000

const LATENCY_BASE_URL = 'https://api.deepseek.com/anthropic'
const LATENCY_CACHE_MS = 20_000
const LATENCY_TIMEOUT_MS = 20_000
const LATENCY_CACHE_LIMIT = 8
const LATENCY_PENDING_LIMIT = 8
const LATENCY_WINDOW_MS = 60_000
const LATENCY_WINDOW_LIMIT = 60
const MAX_UPSTREAM_BYTES = 64 * 1024
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,79}$/

let cache = null
let pending = null
const latencyCache = new Map()
const latencyPending = new Map()
let latencyWindowStart = 0
let latencyWindowCount = 0

function sendJson(res, status, payload) {
  if (res.headersSent || res.writableEnded) return
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(JSON.stringify(payload))
}

async function readLimitedText(response) {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_UPSTREAM_BYTES) {
    try {
      await response.body?.cancel()
    } catch {
      /* connection already closed */
    }
    return null
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return text + decoder.decode()
      bytes += value.byteLength
      if (bytes > MAX_UPSTREAM_BYTES) {
        try {
          await reader.cancel()
        } catch {
          /* connection already closed */
        }
        return null
      }
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* already released */
    }
  }
}

function takeLatencySlot() {
  const now = Date.now()
  if (now - latencyWindowStart >= LATENCY_WINDOW_MS) {
    latencyWindowStart = now
    latencyWindowCount = 0
  }
  if (latencyWindowCount >= LATENCY_WINDOW_LIMIT) return false
  latencyWindowCount += 1
  return true
}

function publicPayload(data) {
  const infos = Array.isArray(data?.balance_infos) ? data.balance_infos : []
  const balances = infos
    .filter((info) => info && (info.currency === 'CNY' || info.currency === 'USD'))
    .map((info) => ({
      currency: info.currency,
      total: String(info.total_balance ?? '0'),
      granted: String(info.granted_balance ?? '0'),
      toppedUp: String(info.topped_up_balance ?? '0'),
    }))
  return {
    ok: true,
    available: data?.is_available === true,
    balances,
    fetchedAt: Date.now(),
  }
}

async function queryBalance(scope) {
  const credential = await scope.credentials.resolve('DEEPSEEK_API_KEY')
  if (!credential?.value) return { ok: false, reason: 'no-key' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(BALANCE_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${credential.value}`,
        Accept: 'application/json',
      },
      redirect: 'error',
      signal: controller.signal,
    })
    const text = await readLimitedText(response)
    if (text === null) return { ok: false, reason: 'protocol' }
    let data
    try {
      data = JSON.parse(text)
    } catch {
      return { ok: false, reason: 'protocol', status: response.status }
    }
    if (!response.ok) {
      return {
        ok: false,
        reason: response.status === 401 || response.status === 403 ? 'unauthorized' : 'upstream',
        status: response.status,
      }
    }
    if (!data || typeof data !== 'object') return { ok: false, reason: 'protocol' }
    return publicPayload(data)
  } catch (error) {
    return {
      ok: false,
      reason: error?.name === 'AbortError' ? 'timeout' : 'network',
    }
  } finally {
    clearTimeout(timer)
  }
}

async function getBalance(scope, force) {
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache
  if (pending) return pending
  pending = queryBalance(scope)
    .then((result) => {
      if (result.ok) cache = result
      return result
    })
    .finally(() => {
      pending = null
    })
  return pending
}

/** The Messages endpoint the harness uses, unless the deployment overrides it. */
function latencyEndpoint() {
  const fallback = LATENCY_BASE_URL
  let base
  try {
    base = new URL(process.env.DEEPSEEK_BASE_URL || fallback)
  } catch {
    base = new URL(fallback)
  }
  const loopbackHttp =
    base.protocol === 'http:' && LOOPBACK_HOSTS.has(base.hostname.replace(/^\[|\]$/g, ''))
  if ((base.protocol !== 'https:' && !loopbackHttp) || base.username || base.password || base.search || base.hash) {
    base = new URL(fallback)
  }
  const root = base.toString().replace(/\/+$/, '')
  return root.endsWith('/v1') ? `${root}/messages` : `${root}/v1/messages`
}

/** A one-token completion measures the current model round trip. */
async function queryLatency(scope, model) {
  const credential = await scope.credentials.resolve('DEEPSEEK_API_KEY')
  if (!credential?.value) return { ok: false, reason: 'no-key' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LATENCY_TIMEOUT_MS)
  const started = performance.now()
  try {
    const response = await fetch(latencyEndpoint(), {
      method: 'POST',
      headers: {
        'x-api-key': credential.value,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
      redirect: 'error',
      signal: controller.signal,
    })
    const text = await readLimitedText(response)
    if (text === null) return { ok: false, reason: 'protocol' }
    const ms = Math.round(performance.now() - started)
    if (!response.ok) {
      let reason = 'upstream'
      if (response.status === 401 || response.status === 403) reason = 'unauthorized'
      if (response.status === 402) reason = 'balance'
      if (response.status === 429) reason = 'busy'
      return { ok: false, reason, status: response.status }
    }
    let data
    try {
      data = JSON.parse(text)
    } catch {
      return { ok: false, reason: 'protocol' }
    }
    if (!data || typeof data !== 'object') return { ok: false, reason: 'protocol' }
    return { ok: true, model, ms, at: Date.now() }
  } catch (error) {
    return { ok: false, reason: error?.name === 'AbortError' ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
  }
}

async function getLatency(scope, model) {
  const cached = latencyCache.get(model)
  if (cached && Date.now() - cached.at < LATENCY_CACHE_MS) return cached
  const running = latencyPending.get(model)
  if (running) return running
  if (latencyPending.size >= LATENCY_PENDING_LIMIT || !takeLatencySlot()) {
    return { ok: false, reason: 'busy' }
  }
  const job = queryLatency(scope, model)
    .then((result) => {
      const value = { ...result, at: Date.now() }
      if (latencyCache.size >= LATENCY_CACHE_LIMIT) latencyCache.clear()
      latencyCache.set(model, value)
      return value
    })
    .finally(() => {
      latencyPending.delete(model)
    })
  latencyPending.set(model, job)
  return job
}

export function apply(ctx) {
  const connection = ctx.connection
  // DSH 0.2.1 removed the `webRuntime` service; `webServer` is the route host on
  // both 0.2.0 and 0.2.1, so wait for it instead of a service that never appears.
  ctx.inject(['webServer'], (scope) => {
    scope.effect(
      () =>
        scope.webServer.register({
          kind: 'exact',
          path: '/dsh-ai-mind/balance',
          async handler(req, res) {
            const rejection = connection.requestRejection(req)
            if (rejection !== undefined) {
              sendJson(res, rejection, { ok: false, reason: rejection === 401 ? 'unauthorized' : 'forbidden' })
              return
            }
            if (req.method !== 'GET') {
              res.setHeader('Allow', 'GET')
              sendJson(res, 405, { ok: false, reason: 'method' })
              return
            }
            const result = await getBalance(scope, false)
            sendJson(res, result.ok ? 200 : 502, result)
          },
        }),
      'ai-mind: DeepSeek balance route',
    )
    scope.effect(
      () =>
        scope.webServer.register({
          kind: 'exact',
          path: '/dsh-ai-mind/latency',
          async handler(req, res) {
            const rejection = connection.requestRejection(req)
            if (rejection !== undefined) {
              sendJson(res, rejection, { ok: false, reason: rejection === 401 ? 'unauthorized' : 'forbidden' })
              return
            }
            if (req.method !== 'GET') {
              res.setHeader('Allow', 'GET')
              sendJson(res, 405, { ok: false, reason: 'method' })
              return
            }
            let model = ''
            try {
              model = new URL(req.url, 'http://localhost').searchParams.get('model') || ''
            } catch {
              model = ''
            }
            if (!MODEL_ID.test(model)) {
              sendJson(res, 400, { ok: false, reason: 'model' })
              return
            }
            const result = await getLatency(scope, model)
            sendJson(res, result.ok ? 200 : 502, result)
          },
        }),
      'ai-mind: DeepSeek latency route',
    )
  })
}
