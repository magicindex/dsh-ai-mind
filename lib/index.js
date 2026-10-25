export const name = 'dsh-ai-mind'

export const inject = ['webServer', 'credentials']

const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const CACHE_MS = 60_000
const TIMEOUT_MS = 9_000

let cache = null
let pending = null

function sendJson(res, status, payload) {
  if (res.headersSent || res.writableEnded) return
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(JSON.stringify(payload))
}

function hostnameOf(authority) {
  if (typeof authority !== 'string' || !authority) return ''
  try {
    return new URL(`http://${authority}`).hostname.replace(/^\[|\]$/g, '')
  } catch {
    return ''
  }
}

function isTrusted(req, trustedHosts) {
  const host = req.headers.host
  if (!host) return false
  const hostname = hostnameOf(host)
  if (!hostname) return false
  const loopback = hostname === '127.0.0.1' || hostname === '::1' || hostname === 'localhost'
  const trusted = loopback || trustedHosts.some((entry) => hostnameOf(entry) === hostname)
  if (!trusted) return false
  if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return false
  const origin = req.headers.origin
  if (origin) {
    let originHost = ''
    try {
      originHost = new URL(origin).hostname.replace(/^\[|\]$/g, '')
    } catch {
      return false
    }
    if (originHost !== hostname) return false
  }
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
      signal: controller.signal,
    })
    const text = await response.text()
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

export function apply(ctx) {
  ctx.inject(['webRuntime'], (scope) => {
    scope.effect(
      () =>
        scope.webServer.register({
          kind: 'exact',
          path: '/dsh-ai-mind/balance',
          async handler(req, res) {
            if (!isTrusted(req, scope.webRuntime.trustedHosts)) {
              sendJson(res, 403, { ok: false, reason: 'forbidden' })
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
  })
}
