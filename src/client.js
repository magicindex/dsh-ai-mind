'use strict'

const React = require('react')
const { useEffect, useMemo, useRef, useState } = React
const h = React.createElement

const TAB_ID = 'dsh-ai-mind:mind'
const STYLE_ID = 'dsh-ai-mind-style'
const CLOSED_SESSIONS = new Set()
const AUTO_OPENED = new Set()

const ICONS = {
  spark: ['M12 2.8l1.9 5.4 5.4 1.9-5.4 1.9L12 17.4l-1.9-5.4L4.7 10l5.4-1.9z', 'M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z'],
  goal: ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M12 15a3 3 0 100-6 3 3 0 000 6z', 'M12 3v2', 'M12 19v2', 'M3 12h2', 'M19 12h2'],
  think: ['M9.5 4.5a4 4 0 00-4 4c0 .8.2 1.5.7 2.1A4.5 4.5 0 009 18h1', 'M14.5 4.5a4 4 0 014 4c0 .8-.2 1.5-.7 2.1A4.5 4.5 0 0115 18h-1', 'M9 8h6', 'M9 12h6', 'M10 16h4'],
  terminal: ['M4 5h16v14H4z', 'M8 10l2.5 2L8 14', 'M13 14h3'],
  file: ['M6 3h8l4 4v14H6z', 'M14 3v5h4'],
  edit: ['M4 20h4l10-10-4-4L4 16z', 'M13 6l4 4'],
  search: ['M11 4a7 7 0 100 14 7 7 0 000-14z', 'M16.5 16.5L21 21'],
  web: ['M12 3a9 9 0 100 18 9 9 0 000-18z', 'M3 12h18', 'M12 3c2.5 2.7 4 5.7 4 9s-1.5 6.3-4 9c-2.5-2.7-4-5.7-4-9s1.5-6.3 4-9z'],
  check: ['M4 12.5l5 5L20 6.5'],
  agent: ['M12 3v3', 'M5 8h14v10H5z', 'M9 12h.01', 'M15 12h.01', 'M9 18v3', 'M15 18v3'],
  flow: ['M5 4h5v5H5z', 'M14 15h5v5h-5z', 'M7.5 9v3a3 3 0 003 3h6'],
  job: ['M4 6h16v12H4z', 'M8 6V4h8v2', 'M4 11h16'],
  skill: ['M12 3l2.2 4.6L19 8.5l-3.5 3.6.8 5-4.3-2.4-4.3 2.4.8-5L5 8.5l4.8-.9z'],
  zip: ['M6 3h12v18H6z', 'M12 3v4', 'M10.5 7h3', 'M10.5 10h3', 'M10.5 13h3', 'M11 16h2v3h-2z'],
  present: ['M4 4h16v12H4z', 'M12 16v5', 'M8 21h8'],
  panel: ['M3 5h18v14H3z', 'M15 5v14'],
  chat: ['M4 5h16v11H9l-5 5z'],
  tool: ['M14.5 6.5a4 4 0 01-5 5L5 16l3 3 4.5-4.5a4 4 0 015-5l-2-2z'],
  image: ['M4 5h16v14H4z', 'M8 11a1.5 1.5 0 100-3 1.5 1.5 0 000 3z', 'M4 16l5-5 4 4 3-3 4 4'],
  code: ['M8 8l-4 4 4 4', 'M16 8l4 4-4 4', 'M13 5l-2 14'],
  ask: ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M9.5 9a2.5 2.5 0 115 0c0 2-2.5 2-2.5 4', 'M12 17h.01'],
  pause: ['M9 5v14', 'M15 5v14'],
  sun: ['M12 8a4 4 0 100 8 4 4 0 000-8z', 'M12 2v2', 'M12 20v2', 'M2 12h2', 'M20 12h2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M19.1 4.9l-1.4 1.4', 'M6.3 17.7l-1.4 1.4'],
  moon: ['M20 14.5A8.5 8.5 0 019.5 4 7 7 0 1020 14.5z'],
  wallet: ['M4 7h16v12H4z', 'M4 10h16', 'M15 14h3v3h-3z'],
}

const BALANCE_PATH = 'dsh-ai-mind/balance'
const TOP_UP_URL = 'https://platform.deepseek.com/top_up'
const BALANCE_REFRESH_MS = 60_000
let balanceCache = null
let balanceRequest = null

const PHASE_ICON = {
  idle: 'spark',
  waiting: 'spark',
  thinking: 'think',
  writing: 'chat',
  acting: 'terminal',
  done: 'check',
  error: 'ask',
}

function cx(...parts) {
  return parts.filter(Boolean).join(' ')
}

function fmtDuration(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000))
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes < 60) return `${minutes}:${String(seconds).padStart(2, '0')}`
  const hours = Math.floor(minutes / 60)
  return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function fmtClock(ms) {
  const n = Number(ms)
  if (!n) return ''
  const d = new Date(n)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function fmtTokens(value) {
  const n = Number(value) || 0
  if (!n) return '—'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}m`
}

function truncate(text, max) {
  const value = String(text ?? '')
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function Icon({ name, size = 14, className }) {
  const paths = ICONS[name] || ICONS.tool
  return h(
    'svg',
    {
      className: cx('aim-icon', className),
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.6,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
    },
    paths.map((d, index) => h('path', { key: index, d })),
  )
}

function Orb({ name, size = 'md' }) {
  return h(
    'div',
    { className: cx('aim-orb', `aim-orb-${size}`) },
    h('span', { className: 'aim-orb-halo' }),
    h('span', { className: 'aim-orb-core' }),
    h('span', { className: 'aim-orb-glyph' }, h(Icon, { name, size: size === 'lg' ? 20 : 15 })),
  )
}

function SectionHead({ icon, title, hint, live, right }) {
  return h(
    'div',
    { className: 'aim-sec-head' },
    h('span', { className: 'aim-sec-icon' }, h(Icon, { name: icon, size: 13 })),
    h('span', { className: 'aim-sec-title' }, title),
    hint ? h('span', { className: 'aim-sec-hint' }, hint) : null,
    live ? h('span', { className: 'aim-sec-live' }, h('i'), 'STREAM') : null,
    right || null,
  )
}

const THEME_KEY = 'dsh-ai-mind:theme'

function detectTheme() {
  try {
    return document.body?.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function readTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark') return { mode: stored, explicit: true }
  } catch {
    // private mode / storage disabled
  }
  return { mode: detectTheme(), explicit: false }
}

function useAimTheme() {
  const [state, setState] = useState(readTheme)

  useEffect(() => {
    if (state.explicit) return undefined
    const body = document.body
    if (!body) return undefined
    const observer = new MutationObserver(() => {
      setState({ mode: detectTheme(), explicit: false })
    })
    observer.observe(body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    return () => observer.disconnect()
  }, [state.explicit])

  const toggle = () => {
    setState((previous) => {
      const mode = previous.mode === 'light' ? 'dark' : 'light'
      try {
        localStorage.setItem(THEME_KEY, mode)
      } catch {
        // keep the in-memory choice
      }
      return { mode, explicit: true }
    })
  }

  return { mode: state.mode, toggle }
}

function loadBalance(force) {
  if (!force && balanceCache && Date.now() - balanceCache.at < 60_000) {
    return Promise.resolve(balanceCache.value)
  }
  if (balanceRequest) return balanceRequest
  balanceRequest = fetch(BALANCE_PATH, { cache: 'no-store', headers: { Accept: 'application/json' } })
    .then(async (response) => {
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.ok) {
        const error = new Error(data?.reason || `HTTP ${response.status}`)
        error.reason = data?.reason || 'http'
        throw error
      }
      balanceCache = { at: Date.now(), value: data }
      return data
    })
    .finally(() => {
      balanceRequest = null
    })
  return balanceRequest
}

function useDeepSeekBalance() {
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    let alive = true
    let retry = null
    const load = (force) => {
      if (retry) {
        clearTimeout(retry)
        retry = null
      }
      loadBalance(force)
        .then((data) => {
          if (alive) setState({ status: 'ready', data })
        })
        .catch((error) => {
          if (!alive) return
          setState({ status: 'error', reason: error?.reason || 'network' })
          // The balance route arrives with a host restart; keep trying while
          // the server is still booting or a transient upstream error clears.
          retry = setTimeout(() => load(true), 15_000)
        })
    }
    load(false)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load(true)
    }, BALANCE_REFRESH_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') load(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearInterval(timer)
      if (retry) clearTimeout(retry)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return state
}

function walletDisplay(data) {
  const wallets = Array.isArray(data?.balances) ? data.balances : []
  const main = wallets.find((wallet) => wallet.currency === 'CNY') || wallets[0]
  if (!main) return null
  const total = Number(main.total)
  const amount = Number.isFinite(total) ? total.toFixed(2) : String(main.total || '0')
  const symbol = main.currency === 'CNY' ? '¥' : '$'
  const detail = wallets
    .map((wallet) => `${wallet.currency} ${wallet.total}（充值 ${wallet.toppedUp} · 赠送 ${wallet.granted}）`)
    .join('\n')
  return {
    text: `${symbol}${amount}`,
    title: `DeepSeek 充值中心余额\n${detail}\n点击打开充值中心`,
    low: Number(main.total) <= 0 || data?.available === false,
  }
}

function useSessionMind(ctx, sessionId, visible) {
  const [tick, setTick] = useState(0)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const dataRef = useRef({ entries: [], running: false })
  const bindingRef = useRef(null)

  useEffect(() => {
    let alive = true
    let hold
    let offEvents
    let offList
    setReady(false)
    setError('')

    const read = () => {
      if (!alive) return
      const binding = bindingRef.current
      if (!binding) return
      let entries = []
      try {
        entries = binding.eventSource.getSnapshot()?.entries || []
      } catch (cause) {
        setError(cause?.message ? String(cause.message) : '读取会话事件失败')
      }
      let running = false
      try {
        const info = ctx.sessions?.list?.getSnapshot?.()?.byId?.[sessionId]
        running = Boolean(info?.running)
      } catch {
        // running is best-effort; the event window still drives the panel
      }
      dataRef.current = { entries, running }
      setReady(true)
      setTick((value) => value + 1)
    }

    const attach = (binding) => {
      if (!alive || !binding) return
      try { offEvents?.() } catch { /* replace stale subscription */ }
      try { offList?.() } catch { /* replace stale subscription */ }
      offEvents = undefined
      offList = undefined
      bindingRef.current = binding
      try {
        offEvents = binding.eventSource.subscribe(read)
      } catch (cause) {
        setError(cause?.message ? String(cause.message) : '订阅会话事件失败')
      }
      try {
        offList = ctx.sessions?.list?.subscribe?.(read)
      } catch {
        // noop
      }
      read()
    }

    try {
      const binding = ctx.sessions?.binding?.(sessionId)
      if (binding) {
        attach(binding)
      } else if (ctx.sessions?.retain) {
        hold = ctx.sessions.retain(sessionId, { source: 'gateway' })
        attach(hold?.binding)
        if (hold?.ready?.then) {
          hold.ready
            .then((resolved) => {
              if (alive) attach(resolved)
            })
            .catch((cause) => {
              if (!alive) return
              setReady(true)
              setError(cause?.message ? String(cause.message) : '会话尚未就绪')
            })
        }
      } else {
        setReady(true)
        setError('会话服务不可用')
      }
    } catch (cause) {
      setReady(true)
      setError(cause?.message ? String(cause.message) : '无法连接会话')
    }

    return () => {
      alive = false
      try {
        offEvents?.()
      } catch {
        // noop
      }
      try {
        offList?.()
      } catch {
        // noop
      }
      try {
        hold?.release?.()
      } catch {
        // noop
      }
    }
  }, [ctx, sessionId])

  useEffect(() => {
    if (!visible) return undefined
    const timer = setInterval(() => setTick((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [visible, sessionId])

  const mind = useMemo(() => {
    if (!ready) return emptyMind()
    return deriveMind(dataRef.current.entries, {
      running: dataRef.current.running,
      now: Date.now(),
    })
  }, [ready, tick, sessionId])

  return { mind, ready, error }
}

function ThoughtMap({ nodes, phaseLabel }) {
  const items = nodes.slice(0, 6)
  const count = Math.max(items.length, 1)
  const width = 340
  const height = 220
  const center = { x: 170, y: 111 }
  const radiusX = count <= 3 ? 92 : 118
  const radiusY = count <= 3 ? 56 : 78
  const points = items.map((node, index) => {
    const angle = (-90 + (360 / count) * index) * (Math.PI / 180)
    return {
      node,
      x: center.x + radiusX * Math.cos(angle),
      y: center.y + radiusY * Math.sin(angle),
    }
  })

  return h(
    'div',
    { className: 'aim-map' },
    h(
      'svg',
      {
        className: 'aim-map-svg',
        viewBox: `0 0 ${width} ${height}`,
        preserveAspectRatio: 'none',
        'aria-hidden': 'true',
      },
      h(
        'defs',
        null,
        h(
          'radialGradient',
          { id: 'aim-core-fill', cx: '50%', cy: '50%', r: '50%' },
          h('stop', { offset: '0%', stopColor: 'currentColor', stopOpacity: '0.34' }),
          h('stop', { offset: '100%', stopColor: 'currentColor', stopOpacity: '0' }),
        ),
      ),
      h('circle', { className: 'aim-map-aura', cx: center.x, cy: center.y, r: 58, fill: 'url(#aim-core-fill)' }),
      points.map((point) => {
        const midX = (center.x + point.x) / 2
        const midY = (center.y + point.y) / 2
        const bend = point.node.kind === 'goal' ? 0.1 : 0.2
        const d = `M${center.x} ${center.y} C${midX} ${center.y - (center.y - midY) * bend}, ${midX} ${midY}, ${point.x} ${point.y}`
        return h('path', {
          key: `link-${point.node.id}`,
          d,
          className: cx('aim-map-link', point.node.active && 'is-active'),
          fill: 'none',
        })
      }),
    ),
    h(
      'div',
      { className: 'aim-map-core', style: { left: `${(center.x / width) * 100}%`, top: `${(center.y / height) * 100}%` } },
      h('span', { className: 'aim-core-pulse' }),
      h('span', { className: 'aim-core-word' }, 'AI'),
      h('span', { className: 'aim-core-state' }, phaseLabel),
    ),
    points.map((point) =>
      h(
        'div',
        {
          key: `node-${point.node.id}`,
          className: cx(
            'aim-map-node',
            `aim-kind-${point.node.kind}`,
            point.node.active && 'is-active',
            point.node.status === 'error' && 'is-error',
          ),
          style: { left: `${(point.x / width) * 100}%`, top: `${(point.y / height) * 100}%` },
          title: `${point.node.label}：${point.node.text}`,
        },
        h('span', { className: 'aim-map-node-dot' }),
        h('span', { className: 'aim-map-node-label' }, point.node.label),
        h('span', { className: 'aim-map-node-text' }, truncate(point.node.text, 28)),
      ),
    ),
  )
}

function TaskMap({ mind }) {
  const active = mind.activeTask || null
  const allTasks = active ? mind.tasks.filter((task) => task.id !== active.sourceId) : mind.tasks
  const tasks = allTasks.slice(0, 8)
  const hidden = Math.max(0, allTasks.length - tasks.length)
  const labels = { completed: '完成', in_progress: '进行中', pending: '待办', error: '异常' }

  return h(
    'div',
    { className: 'aim-tasks' },
    h(
      'div',
      { className: 'aim-task aim-task-root' },
      h('span', { className: 'aim-task-rail' }, h('span', { className: 'aim-rail-dot' })),
      h(
        'div',
        { className: 'aim-task-body' },
        h(
          'div',
          { className: 'aim-task-top' },
          h('span', { className: 'aim-task-kicker' }, '本轮目标'),
          h('span', { className: 'aim-task-index' }, `T${mind.turn}`),
        ),
        h('div', { className: 'aim-task-title' }, mind.promptShort || '等待指令'),
      ),
    ),
    active
      ? h(
          'div',
          { className: 'aim-task is-in_progress is-active aim-task-live' },
          h('span', { className: 'aim-task-rail' }, h('span', { className: 'aim-rail-dot' })),
          h(
            'div',
            { className: 'aim-task-body' },
            h(
              'div',
              { className: 'aim-task-top' },
              h('span', { className: 'aim-task-index' }, 'NOW'),
              h('span', { className: 'aim-task-state is-in_progress' }, '进行中'),
            ),
            h('div', { className: 'aim-task-title' }, active.title),
          ),
        )
      : null,
    tasks.length
      ? tasks.map((task, index) =>
          h(
            'div',
            {
              key: task.id,
              className: cx('aim-task', `is-${task.status}`, task.status === 'in_progress' && 'is-active'),
              style: { animationDelay: `${80 + index * 45}ms` },
            },
            h('span', { className: 'aim-task-rail' }, h('span', { className: 'aim-rail-dot' })),
            h(
              'div',
              { className: 'aim-task-body' },
              h(
                'div',
                { className: 'aim-task-top' },
                h('span', { className: 'aim-task-index' }, String(index + 1).padStart(2, '0')),
                h('span', { className: cx('aim-task-state', `is-${task.status}`) }, labels[task.status] || task.status),
              ),
              h('div', { className: 'aim-task-title' }, task.title),
            ),
          ),
        )
      : h(
          'div',
          { className: 'aim-task aim-task-ghost' },
          h('span', { className: 'aim-task-rail' }, h('span', { className: 'aim-rail-dot' })),
          h(
            'div',
            { className: 'aim-task-body' },
            h('div', { className: 'aim-task-title' }, 'AI 开始行动后，任务会在这里逐项展开'),
          ),
        ),
    hidden > 0 ? h('div', { className: 'aim-task-more' }, `还有 ${hidden} 项未展开`) : null,
  )
}

function Skeleton() {
  return h(
    'div',
    { className: 'aim-root aim-skeleton', 'data-tone': 'idle' },
    h('div', { className: 'aim-skel aim-skel-head' }),
    h('div', { className: 'aim-skel aim-skel-hero' }),
    h('div', { className: 'aim-skel aim-skel-line' }),
    h('div', { className: 'aim-skel aim-skel-line short' }),
    h('div', { className: 'aim-skel aim-skel-map' }),
    h('div', { className: 'aim-skel aim-skel-line' }),
    h('div', { className: 'aim-skel aim-skel-line short' }),
  )
}

function AiMindView(props) {
  const { ctx, scope, visible } = props
  const sessionId = scope?.sessionId
  const { mind, ready, error } = useSessionMind(ctx, sessionId, visible)
  const { mode: theme, toggle: toggleTheme } = useAimTheme()
  const [showProcess, setShowProcess] = useState(false)
  const processRef = useRef(null)
  const thoughtRef = useRef(null)
  const stickRef = useRef(true)
  const thoughtHistory = Array.isArray(mind.thoughtHistory) ? mind.thoughtHistory : []
  const canShowProcess = thoughtHistory.length > 1
  const balance = useDeepSeekBalance()
  const wallet = balance.status === 'ready' ? walletDisplay(balance.data) : null
  const balanceTitle =
    balance.status === 'loading'
      ? '正在读取 DeepSeek 充值中心余额'
      : balance.status === 'error'
        ? balance.reason === 'no-key'
          ? '未配置 DEEPSEEK_API_KEY，点击打开充值中心'
          : '余额读取失败，点击打开充值中心'
        : wallet?.title || '点击打开 DeepSeek 充值中心'

  useEffect(() => {
    setShowProcess(false)
    stickRef.current = true
  }, [sessionId])

  useEffect(() => {
    const el = processRef.current
    if (!showProcess || !el) return
    if (stickRef.current) el.scrollTop = el.scrollHeight
  }, [showProcess, thoughtHistory.length, mind.thought])

  useEffect(() => {
    if (!visible) return
    const el = thoughtRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [visible, sessionId, mind.thought, mind.thoughtLive, showProcess])

  if (!ready) return h(Skeleton)

  const active = mind.running || mind.phase === 'acting' || mind.phase === 'thinking' || mind.phase === 'writing'
  const liveSeconds = mind.elapsed
  const phaseIcon = PHASE_ICON[mind.phase] || 'spark'
  const detailText =
    mind.phase === 'error'
      ? String(mind.detail || '').includes('ToolOutcomeUnknownError')
        ? '工具结果未能确认，等待模型继续处理（ToolOutcomeUnknownError）'
        : mind.detail
      : mind.detail
  const pillText = active ? 'LIVE' : mind.phase === 'done' ? 'DONE' : mind.phase === 'error' ? 'ISSUE' : 'IDLE'
  const hasMind = Boolean(mind.prompt || mind.thought || mind.answer || mind.tools.length)
  const progressWidth = mind.progress > 0 ? mind.progress : active && mind.total > 0 ? 4 : 0

  return h(
    'div',
    { className: cx('aim-root', active && 'is-live'), 'data-tone': mind.tone, 'data-phase': mind.phase, 'data-aim-theme': theme },
    h(
      'header',
      { className: 'aim-head' },
      h(
        'div',
        { className: 'aim-brand' },
        h('span', { className: 'aim-mark' }, h(Icon, { name: 'spark', size: 15 })),
        h(
          'div',
          { className: 'aim-brand-text' },
          h('b', null, 'AI 心流'),
          h('span', null, 'LIVE MIND'),
        ),
      ),
      h(
        'div',
        { className: 'aim-head-actions' },
        h(
          'div',
          { className: 'aim-wallet' },
          h(
            'a',
            {
              className: 'aim-topup',
              href: TOP_UP_URL,
              target: '_blank',
              rel: 'noreferrer',
              title: '打开 DeepSeek 充值中心',
              'aria-label': '打开 DeepSeek 充值中心',
            },
            '充值',
          ),
          h('span', { className: 'aim-wallet-sep', 'aria-hidden': 'true' }, '\\'),
          h(
            'span',
            {
              className: cx('aim-balance', balance.status === 'loading' && 'is-loading', wallet?.low && 'is-low'),
              title: balanceTitle.replace(/\n点击打开充值中心$/, ''),
            },
            h(Icon, { name: 'wallet', size: 11 }),
            h('span', { className: 'aim-balance-label' }, '余额'),
            h('b', null, balance.status === 'loading' ? '…' : wallet?.text || '—'),
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'aim-theme',
            onClick: toggleTheme,
            title: theme === 'light' ? '切换到暗色主题' : '切换到亮色主题',
            'aria-label': theme === 'light' ? '切换到暗色主题' : '切换到亮色主题',
          },
          h(Icon, { name: theme === 'light' ? 'moon' : 'sun', size: 14 }),
        ),
        h(
          'span',
          { className: cx('aim-pill', active && 'is-on', mind.phase === 'error' && 'is-bad') },
          h('i'),
          pillText,
        ),
      ),
    ),

    error
      ? h('div', { className: 'aim-error' }, h(Icon, { name: 'ask', size: 14 }), h('span', null, error))
      : null,

    h(
      'section',
      { className: 'aim-hero aim-sec', style: { animationDelay: '0ms' } },
      h(
        'div',
        { className: 'aim-hero-main' },
        h(Orb, { name: phaseIcon, size: 'lg' }),
        h(
          'div',
          { className: 'aim-hero-copy' },
          h(
            'div',
            { className: 'aim-phase' },
            h('span', { className: 'aim-phase-dot' }),
            mind.phaseLabel,
            mind.phase === 'acting' && mind.focus ? h('span', { className: 'aim-phase-tool' }, mind.focus.label) : null,
          ),
          h('div', { className: 'aim-detail', title: detailText }, detailText || '等待任务开始'),
        ),
      ),
      h(
        'div',
        { className: 'aim-metrics' },
        h('div', { className: 'aim-metric' }, h('span', null, '轮次'), h('b', null, mind.phase === 'idle' ? '—' : `#${mind.turn}`)),
        h('div', { className: 'aim-metric' }, h('span', null, '步骤'), h('b', null, mind.phase === 'idle' || mind.step < 0 ? '—' : String(mind.step))),
        h('div', { className: 'aim-metric' }, h('span', null, '耗时'), h('b', null, mind.phase === 'idle' ? '—' : fmtDuration(liveSeconds))),
        h('div', { className: 'aim-metric' }, h('span', null, '生成'), h('b', null, fmtTokens(mind.tokens))),
        h(
          'div',
          {
            className: 'aim-metric aim-metric-total',
            title: `输入 ${fmtTokens(mind.contextInput)} · 缓存 ${fmtTokens(mind.contextCache)} · 输出 ${fmtTokens(mind.contextOutput)}`,
          },
          h('span', null, '总 token'),
          h('b', null, mind.phase === 'idle' || !mind.contextTokens ? '—' : fmtTokens(mind.contextTokens)),
        ),
      ),
      h(
        'div',
        { className: cx('aim-progress', active && 'is-active') },
        h(
          'div',
          { className: 'aim-progress-head' },
          h('span', null, mind.taskSource === 'todo' ? '任务进度' : '执行进度'),
          h('b', null, mind.total ? `${mind.completed} / ${mind.total} · ${mind.progress}%` : '暂无任务'),
        ),
        h(
          'div',
          { className: 'aim-bar' },
          h('i', { style: { width: `${progressWidth}%` } }),
        ),
      ),
    ),

    h('div', { className: 'aim-board' },
    h('div', { className: 'aim-col aim-col-main' },
    h(
      'section',
      { className: 'aim-card aim-goal-card aim-sec', style: { animationDelay: '50ms' } },
      h(SectionHead, { icon: 'goal', title: '本轮目标', hint: mind.taskSource === 'todo' ? '计划模式' : '轨迹推断' }),
      h('p', { className: cx('aim-prompt', !mind.prompt && 'is-empty') }, mind.prompt || '尚未收到指令，等待下一条消息…'),
    ),

    h(
      'section',
      { className: 'aim-card aim-thought-card aim-sec', style: { animationDelay: '100ms' } },
      h(SectionHead, {
        icon: 'think',
        title: showProcess && canShowProcess ? '推理过程' : '当前思路',
        live: mind.thoughtLive,
        right: canShowProcess
          ? h(
              'button',
              {
                type: 'button',
                className: cx('aim-process-toggle', showProcess && 'is-on'),
                onClick: () => {
                  stickRef.current = true
                  setShowProcess((value) => !value)
                },
                title: showProcess ? '返回当前思路' : '查看本轮完整推理过程',
                'aria-pressed': showProcess,
              },
              h(Icon, { name: 'think', size: 10 }),
              h('span', null, showProcess ? '返回当前' : `推理过程 ${thoughtHistory.length}`),
            )
          : null,
      }),
      showProcess && canShowProcess
        ? h(
            'div',
            {
              className: 'aim-process',
              ref: processRef,
              role: 'list',
              'aria-label': '本轮 AI 推理过程',
              onScroll: () => {
                const el = processRef.current
                if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 36
              },
            },
            thoughtHistory.map((item, index) =>
              h(
                'article',
                {
                  key: `${item.time || 0}-${index}`,
                  className: cx('aim-process-item', item.live && 'is-live'),
                  role: 'listitem',
                },
                h(
                  'div',
                  { className: 'aim-process-meta' },
                  h('span', { className: 'aim-process-step' }, item.live ? '正在推理' : `步骤 ${item.step || '—'}`),
                  item.live ? h('em', null, 'LIVE') : null,
                  h('time', null, fmtClock(item.time)),
                ),
                h('p', null, item.text),
              ),
            ),
          )
        : hasMind && mind.thought
          ? h(
              'div',
              { className: 'aim-thought', ref: thoughtRef },
              h('p', null, mind.thought, mind.thoughtLive ? h('span', { className: 'aim-caret' }) : null),
            )
          : h(
              'div',
              { className: 'aim-thought is-empty' },
              h('p', null, mind.phase === 'acting' ? '执行阶段，思路会在模型下一次推理时出现。' : '模型尚未产生可见推理。'),
            ),
      !showProcess && mind.thoughtBits.length > 1
        ? h(
            'div',
            { className: 'aim-chips' },
            mind.thoughtBits.map((bit, index) => h('span', { key: index, className: 'aim-chip', title: bit }, truncate(bit, 26))),
          )
        : null,
    ),
    ),
    h('div', { className: 'aim-col aim-col-viz' },
    h(
      'section',
      { className: 'aim-card aim-map-card aim-sec', style: { animationDelay: '150ms' } },
      h(SectionHead, { icon: 'flow', title: '思路导图', hint: `${mind.mapNodes.length} 个节点` }),
      h(ThoughtMap, { nodes: mind.mapNodes, phaseLabel: mind.phaseLabel }),
      h(
        'div',
        { className: 'aim-map-foot' },
        h('span', { className: 'aim-legend' }, h('i', { className: 'aim-legend-dot is-goal' }), '目标'),
        h('span', { className: 'aim-legend' }, h('i', { className: 'aim-legend-dot is-think' }), '思路'),
        h('span', { className: 'aim-legend' }, h('i', { className: 'aim-legend-dot is-tool' }), '动作'),
        h('span', { className: 'aim-legend' }, h('i', { className: 'aim-legend-dot is-answer' }), '输出'),
      ),
    ),

    h(
      'section',
      { className: 'aim-card aim-tasks-card aim-sec', style: { animationDelay: '200ms' } },
      h(SectionHead, {
        icon: 'check',
        title: '任务导图',
        hint: mind.taskSource === 'todo' ? '来自任务清单' : '从执行轨迹推断',
      }),
      h(TaskMap, { mind }),
    ),
    ),
    ),

    h(
      'footer',
      { className: 'aim-foot' },
      h('span', { className: 'aim-foot-status' }, '会话事件流 · 实时折叠'),
      h(
        'span',
        { className: 'aim-credit', title: '作者 CyberZero · MIT License 开源授权' },
        'CyberZero · MIT License',
      ),
      h(
        'span',
        { className: 'aim-foot-time' },
        mind.lastEventTime ? new Date(mind.lastEventTime).toLocaleTimeString('zh-CN', { hour12: false }) : '—',
      ),
    ),
  )
}

function injectStyles() {
  if (typeof document === 'undefined') return
  let element = document.getElementById(STYLE_ID)
  if (!element && document.head) {
    element = document.createElement('style')
    element.id = STYLE_ID
    document.head.appendChild(element)
  }
  if (element) element.textContent = AI_MIND_CSS
}

function autoOpen(ctx, disposeRef) {
  const right = ctx.sidebarRight
  if (!right?.mounted) return () => {}
  let disposed = false
  const timers = new Set()

  const later = (run, delay) => {
    const timer = setTimeout(() => {
      timers.delete(timer)
      if (!disposed) {
        try {
          run()
        } catch (cause) {
          console.warn('[dsh-ai-mind]', cause)
        }
      }
    }, delay)
    timers.add(timer)
  }

  const ensure = (sessionId) => {
    if (!sessionId || CLOSED_SESSIONS.has(sessionId) || AUTO_OPENED.has(sessionId)) return
    // A fresh home / new-task session is mounted but blank. Opening the tab there
    // squeezes the whole app for a panel that has nothing to show yet.
    let info
    try {
      info = ctx.sessions?.list?.getSnapshot?.()?.byId?.[sessionId]
    } catch {
      info = undefined
    }
    if (info?.blank) {
      // Home / new-task sessions have nothing to show. If the panel survived from
      // the previous session, close our tab so the app gets its width back.
      try {
        const tab = right.active?.()
        const kind = tab && (tab.type || tab.kind)
        if (tab && kind === TAB_ID) right.close(tab.id)
      } catch {
        // closing is best-effort
      }
      return
    }
    if (!info) return
    let attempts = 0
    const attempt = () => {
      if (disposed || CLOSED_SESSIONS.has(sessionId)) return
      try {
        right.openTab(TAB_ID)
        AUTO_OPENED.add(sessionId)
      } catch (cause) {
        attempts += 1
        if (attempts < 10) later(attempt, 350 * attempts)
        else console.warn('[dsh-ai-mind] could not open the right-sidebar tab:', cause)
      }
    }
    later(attempt, 250)
  }

  const off = right.mounted.subscribe(() => ensure(right.mounted.getSnapshot()))
  let offList
  try {
    offList = ctx.sessions?.list?.subscribe?.(() => ensure(right.mounted.getSnapshot()))
  } catch {
    // the mounted subscription is enough when the list is unavailable
  }
  ensure(right.mounted.getSnapshot())
  disposeRef.push(() => {
    disposed = true
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    try {
      off?.()
    } catch {
      // noop
    }
    try {
      offList?.()
    } catch {
      // noop
    }
  })
  return () => {}
}

function apply(ctx) {
  injectStyles()

  ctx.effect(() =>
    ctx.betterSidebar.registerTab({
      id: TAB_ID,
      title: 'AI 心流',
      description: '实时思路、任务进度与思路/任务导图',
      icon: (size) => h(Icon, { name: 'spark', size }),
      order: 1,
      single: true,
      component: (props) => h(AiMindView, props),
      onClose: (_tab, scope) => {
        if (scope?.sessionId) CLOSED_SESSIONS.add(scope.sessionId)
      },
      onOpen: (_tab, scope) => {
        if (scope?.sessionId) CLOSED_SESSIONS.delete(scope.sessionId)
      },
    }),
  )

  ctx.effect(() => {
    const disposers = []
    autoOpen(ctx, disposers)
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          // noop
        }
      }
    }
  })
}
