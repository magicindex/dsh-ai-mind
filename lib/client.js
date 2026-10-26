window.__ModuleLoader__.load({ id: "dsh-ai-mind", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;

'use strict'

/**
 * Pure folding of a DSH client session-event window into the "AI mind" model.
 *
 * Input is the array carried by `session.eventSource` entries:
 *   { type: 'event', event } | { type: 'transient', event }
 * where transient events are live `assistant/live-chunk` frames.
 * No React, no browser APIs — unit-testable in plain Node.
 */

const TOOL_META = {
  bash: { label: '执行命令', icon: 'terminal' },
  read: { label: '读取文件', icon: 'file' },
  read_image: { label: '查看图片', icon: 'image' },
  write: { label: '写入文件', icon: 'file' },
  edit: { label: '修改文件', icon: 'edit' },
  grep: { label: '搜索内容', icon: 'search' },
  glob: { label: '查找文件', icon: 'search' },
  code: { label: '代码操作', icon: 'code' },
  web_search: { label: '网络搜索', icon: 'web' },
  web_fetch: { label: '抓取网页', icon: 'web' },
  todo_write: { label: '更新任务', icon: 'check' },
  ask_user_question: { label: '询问用户', icon: 'ask' },
  subagent: { label: '委派子代理', icon: 'agent' },
  subagent_fork: { label: '委派子代理', icon: 'agent' },
  workflow: { label: '编排子任务', icon: 'flow' },
  job_output: { label: '读取后台任务', icon: 'job' },
  job_list: { label: '查看后台任务', icon: 'job' },
  skill: { label: '加载技能', icon: 'skill' },
  compress: { label: '压缩上下文', icon: 'zip' },
  present: { label: '展示成果', icon: 'present' },
  sidebar_open: { label: '打开侧栏', icon: 'panel' },
  list_agents: { label: '查看代理', icon: 'agent' },
  send_message: { label: '发送消息', icon: 'chat' },
}

const PHASES = {
  idle: { label: '待命', tone: 'muted' },
  waiting: { label: '等待响应', tone: 'muted' },
  thinking: { label: '推理中', tone: 'violet' },
  writing: { label: '组织回答', tone: 'cyan' },
  acting: { label: '执行操作', tone: 'amber' },
  done: { label: '本轮完成', tone: 'green' },
  error: { label: '需要处理', tone: 'red' },
}

function isObject(value) {
  return value !== null && typeof value === 'object'
}

function parseArgs(raw) {
  if (isObject(raw)) return raw
  if (typeof raw !== 'string' || raw.trim() === '') return {}
  try {
    const parsed = JSON.parse(raw)
    return isObject(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function partText(part) {
  if (typeof part === 'string') return part
  if (!isObject(part)) return ''
  if (typeof part.text === 'string') return part.text
  if (typeof part.content === 'string') return part.content
  if (Array.isArray(part.content)) return part.content.map(partText).join('')
  return ''
}

function contentText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(partText).join('')
  if (isObject(content)) return partText(content)
  return ''
}

function assistantParts(message) {
  const blocks = Array.isArray(message?.content) ? message.content : []
  let reasoning = ''
  let text = ''
  const tools = []
  for (const block of blocks) {
    if (!isObject(block)) continue
    const type = String(block.type || block.kind || '')
    if (type === 'reasoning' || type === 'reasoning-content' || type === 'thinking') {
      reasoning += contentText(block.text ?? block.reasoning ?? block.content)
    } else if (type === 'tool-call' || type === 'tool_call') {
      tools.push({
        id: block.id ?? block.toolCallId ?? block.tool_call_id,
        name: block.name ?? block.toolName ?? 'tool',
        args: parseArgs(block.arguments ?? block.input),
      })
    } else if (type === 'text' || type === 'output') {
      text += contentText(block.text ?? block.content)
    } else if (typeof block.text === 'string' && !type) {
      text += block.text
    }
  }
  if (!reasoning && typeof message?.reasoning === 'string') reasoning = message.reasoning
  if (!reasoning && typeof message?.reasoning_content === 'string') reasoning = message.reasoning_content
  return { reasoning, text, tools }
}

function collapse(value, max = 240) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function splitThoughts(text, limit = 3) {
  const cleaned = String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[`*_>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return []
  const parts = cleaned
    .split(/(?<=[。！？!?；;])\s*|(?<=\.)\s+(?=[A-Z0-9])|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 6)
  const picked = parts.length ? parts : [cleaned]
  return picked.slice(-limit).map((part) => collapse(part, 88))
}

function firstLine(value, max = 70) {
  const text = collapse(value, max * 2)
  return collapse(text.split(/(?:\n|&&|\|\||;)/)[0], max)
}

function toolMeta(name) {
  const key = String(name || '').toLowerCase()
  const meta = TOOL_META[key]
  if (meta) return meta
  return { label: key ? key.replace(/[-_]+/g, ' ') : '调用工具', icon: 'tool' }
}

function toolTarget(name, args) {
  if (!isObject(args) || !args) return ''
  const key = String(name || '').toLowerCase()
  const pick = (...names) => {
    for (const candidate of names) {
      if (typeof args[candidate] === 'string' && args[candidate].trim()) return args[candidate]
    }
    return ''
  }
  const raw =
    key === 'bash'
      ? pick('description') || pick('command')
      : pick('description', 'file_path', 'path', 'pattern', 'query', 'url', 'question', 'header', 'name', 'prompt')
  if (key === 'bash' && !pick('description') && pick('command')) return firstLine(raw, 64)
  return firstLine(raw, 64)
}

function describeTool(name, args) {
  const meta = toolMeta(name)
  const target = toolTarget(name, args)
  return {
    name: String(name || 'tool'),
    label: meta.label,
    icon: meta.icon,
    target,
    detail: target ? `${meta.label} · ${target}` : meta.label,
  }
}

function readUsage(usage) {
  if (!isObject(usage)) return { output: 0, input: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  const output = Number(usage.outputTokens) || 0
  const input = Number(usage.inputTokens) || 0
  const cacheRead = Number(usage.cacheReadTokens) || 0
  const cacheWrite = Number(usage.cacheWriteTokens) || 0
  const total = Number(usage.totalTokens) || input + output + cacheRead + cacheWrite
  return { output, input, cacheRead, cacheWrite, total }
}

function isTodoTool(name) {
  return /^todo_?write$/i.test(String(name || ''))
}

function todoList(raw) {
  if (!Array.isArray(raw)) return null
  return raw.map((item, index) => {
    const status = String(item?.status || '').toLowerCase()
    return {
      id: String(item?.id ?? index),
      content: collapse(item?.content ?? item?.task ?? item?.title ?? `任务 ${index + 1}`, 120),
      status:
        status === 'completed' || status === 'done'
          ? 'completed'
          : status === 'in_progress' || status === 'running' || status === 'active'
            ? 'in_progress'
            : 'pending',
    }
  })
}

function unwrapEntry(entry) {
  if (!isObject(entry)) return undefined
  if (entry.type === 'event' || entry.type === 'transient') return entry.event
  if (entry.type && entry.seq !== undefined) return entry
  return undefined
}

function deriveMind(entries, options = {}) {
  const now = Number(options.now) || Date.now()
  const running = Boolean(options.running)
  const events = []
  const live = []

  for (const entry of Array.isArray(entries) ? entries : []) {
    const event = unwrapEntry(entry)
    if (!event || !event.type) continue
    if (entry?.type === 'transient' || event.type === 'assistant/live-chunk') live.push(event)
    else events.push(event)
  }

  // A real user prompt (not the runtime/time-context snapshots DSH injects).
  let userIndex = -1
  let prompt = ''
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i]
    if (event.type !== 'user/message') continue
    const kind = event.data?.source?.kind
    if (kind && kind !== 'user') continue
    userIndex = i
    prompt = contentText(event.data?.content ?? event.data?.message?.content ?? event.data?.message)
  }

  const lastTurnStart = [...events].reverse().find((event) => event.type === 'turn/start')
  const turn = lastTurnStart?.data?.turn ?? 0
  const tail = userIndex >= 0 ? events.slice(userIndex) : events.slice(-60)

  let step = 0
  let startedAt = lastTurnStart?.time ?? 0
  let lastEventTime = 0
  let lastUserTime = 0
  let lastAssistant = null
  let lastAssistantStep = -1
  let totalOutput = 0
  let windowUsage = null
  let todos = null
  let lastTodoStep = -1
  const tools = []
  const byCall = new Map()
  const reasoningHistory = []

  for (const event of tail) {
    const data = event.data || {}
    const time = Number(event.time) || 0
    lastEventTime = Math.max(lastEventTime, time)
    if (event.type === 'turn/start') startedAt = time
    if (event.type === 'step/start') {
      if ((data.step || 0) >= step) step = data.step || step
    }
    if (event.type === 'user/message' && event.data?.source?.kind === 'user') lastUserTime = time
    if (event.type === 'assistant/message') {
      lastAssistant = event
      lastAssistantStep = data.step || 0
      const usage = readUsage(data.usage ?? data.message?.usage)
      totalOutput += usage.output
      windowUsage = usage
      const parts = assistantParts(data.message)
      if (parts.reasoning) {
        const text = collapse(parts.reasoning, 900)
        const prev = reasoningHistory[reasoningHistory.length - 1]
        if (!prev || prev.text !== text) {
          reasoningHistory.push({
            turn: data.turn || turn,
            step: data.step || step,
            time,
            text,
            live: false,
          })
        }
      }
      for (const call of parts.tools) {
        if (!call.name) continue
        const id = call.id || `${event.seq || time}:${call.name}`
        if (isTodoTool(call.name)) {
          const parsed = todoList(call.args?.todos)
          if (parsed) {
            todos = parsed
            lastTodoStep = data.step || step
          }
          continue
        }
        if (byCall.has(id)) continue
        const tool = {
          id,
          name: call.name,
          args: call.args,
          status: 'done',
          step: data.step || 0,
          at: time,
          fromMessage: true,
        }
        tools.push(tool)
        byCall.set(id, tool)
      }
    }
    if (event.type === 'tool/call') {
      const callId = data.callId || data.id
      if (!callId) continue
      if (isTodoTool(data.name)) {
        const parsed = todoList(parseArgs(data.arguments).todos)
        if (parsed) {
          todos = parsed
          lastTodoStep = data.step || step
        }
        continue
      }
      const known = byCall.get(callId)
      if (known) {
        // assistant/message already exposed this call; the tool/call event marks it live.
        known.status = 'running'
        known.name = data.name || known.name
        if (!known.at) known.at = time
        known.rawArgs = typeof data.arguments === 'string' ? data.arguments : known.rawArgs
      } else {
        const tool = {
          id: callId,
          name: data.name || data.toolName || 'tool',
          args: parseArgs(data.arguments),
          rawArgs: typeof data.arguments === 'string' ? data.arguments : '',
          status: 'running',
          step: data.step || 0,
          at: time,
        }
        tools.push(tool)
        byCall.set(callId, tool)
      }
    }
    if (event.type === 'tool/result') {
      const message = data.message || {}
      const callId = message.toolCallId || message.source?.callId || data.callId
      const tool = byCall.get(callId)
      if (tool) {
        tool.status = data.error || message.isError ? 'error' : 'done'
        tool.endedAt = time
        tool.duration = Math.max(0, time - tool.at)
        const text = contentText(message.content)
        if (text) tool.result = collapse(text, 180)
        if (data.error) tool.error = collapse(data.error.reason || data.error.name || '工具执行失败', 140)
      }
    }
    if (event.type === 'todo/write') {
      const parsed = todoList(data.todos)
      if (parsed) {
        todos = parsed
        lastTodoStep = step
      }
    }
  }

  // Live streaming attempt.
  const liveBlocks = new Map()
  let liveText = ''
  let liveReasoning = ''
  let liveToolName = ''
  let liveToolArgs = ''
  let liveStep = 0
  let liveTurn = 0
  let liveAt = 0
  for (const event of live) {
    const data = event.data || {}
    const chunk = data.chunk
    if (!chunk) continue
    liveAt = Math.max(liveAt, Number(event.time) || 0)
    if (data.step) liveStep = data.step
    if (data.turn) liveTurn = data.turn
    if (chunk.type === 'block-start') {
      liveBlocks.set(chunk.index, {
        kind: chunk.blockType || '',
        text: '',
        name: '',
        args: '',
      })
      continue
    }
    const block =
      liveBlocks.get(chunk.index) ||
      (() => {
        const created = { kind: '', text: '', name: '', args: '' }
        liveBlocks.set(chunk.index, created)
        return created
      })()
    if (chunk.type === 'reasoning-delta') block.text += chunk.text || ''
    else if (chunk.type === 'text-delta') block.text += chunk.text || ''
    else if (chunk.type === 'tool-call-delta') {
      if (chunk.name) block.name = chunk.name
      if (chunk.argumentsDelta) block.args += chunk.argumentsDelta
    } else if (chunk.type === 'block-end' && isObject(chunk.block)) {
      const final = chunk.block
      const kind = final.type || final.kind || block.kind
      if (kind === 'tool-call' || kind === 'tool_call') {
        block.name = final.name || block.name
        block.args = typeof final.arguments === 'string' ? final.arguments : block.args
      } else {
        block.text = contentText(final.text ?? final.content) || block.text
      }
      block.kind = kind || block.kind
    }
    if (!block.kind) {
      if (chunk.type === 'reasoning-delta') block.kind = 'reasoning'
      else if (chunk.type === 'text-delta') block.kind = 'text'
      else if (chunk.type === 'tool-call-delta') block.kind = 'tool-call'
    }
  }
  for (const block of liveBlocks.values()) {
    const kind = String(block.kind || '')
    if (kind === 'reasoning' || kind === 'thinking') liveReasoning += block.text
    else if (kind === 'tool-call' || kind === 'tool_call') {
      liveToolName = block.name || liveToolName
      liveToolArgs = block.args || liveToolArgs
    } else if (kind === 'text') liveText += block.text
    else if (block.text) liveText += block.text
  }
  if (liveStep > step) step = liveStep
  if (liveReasoning) {
    const text = collapse(liveReasoning, 900)
    const prev = reasoningHistory[reasoningHistory.length - 1]
    if (prev && prev.text === text) prev.live = true
    else {
      reasoningHistory.push({
        turn: liveTurn || turn,
        step: liveStep || step,
        time: liveAt || now,
        text,
        live: true,
      })
    }
  }
  const thoughtHistory = reasoningHistory.filter((item) => item.text).slice(-20)

  const assistant = assistantParts(lastAssistant?.data?.message)
  const reasoning = liveReasoning || assistant.reasoning
  const answer = liveText || assistant.text
  const currentStep = step || lastAssistantStep || 0
  // When a plan has not been refreshed for a long stretch, the tool trace is the
  // only honest picture of what the agent is actually doing.
  const todoStale = Boolean(todos) && lastTodoStep > 0 && currentStep - lastTodoStep > 40
  const activeTool = [...tools].reverse().find((tool) => tool.status === 'running')
  const liveTool = liveToolName
    ? {
        id: 'live',
        name: liveToolName,
        args: parseArgs(liveToolArgs),
        status: 'running',
        live: true,
        step: liveStep || currentStep,
        at: liveAt || now,
      }
    : null
  const focusTool = activeTool || liveTool
  const lastTool = tools[tools.length - 1]
  const lastAssistantTime = Number(lastAssistant?.time) || 0
  const lastIsFailure =
    lastTool &&
    lastTool.status === 'error' &&
    !activeTool &&
    !liveTool &&
    (lastTool.endedAt || 0) >= lastAssistantTime

  let phase = 'idle'
  if (!events.length && !live.length) phase = 'idle'
  else if (!running && !prompt && !tools.length && !lastAssistant && !live.length) phase = 'idle'
  else if (lastIsFailure) phase = 'error'
  else if (focusTool) phase = 'acting'
  else if (liveReasoning || reasoning) phase = running ? 'thinking' : lastAssistant ? 'done' : 'thinking'
  else if (liveText) phase = 'writing'
  else if (running) phase = lastAssistant ? 'thinking' : 'waiting'
  else if (lastAssistant) phase = 'done'
  else phase = 'waiting'

  if (!running && phase === 'acting') phase = 'done'
  if (!events.length) phase = 'idle'

  const focus = focusTool ? describeTool(focusTool.name, focusTool.args) : null
  const detail =
    phase === 'acting' && focus
      ? focus.detail
      : phase === 'error'
        ? lastTool?.error || lastTool?.result || '工具执行失败'
        : phase === 'thinking'
          ? splitThoughts(reasoning, 1)[0] || '模型正在推理下一步'
          : phase === 'writing'
            ? '正在生成回复'
            : phase === 'waiting'
              ? '等待模型响应'
              : phase === 'done'
                ? `本轮已完成${tools.length ? ` · ${tools.length} 次工具调用` : ''}`
                : phase === 'idle'
                  ? '等待任务开始'
                  : ''

  const startAt = startedAt || lastUserTime || tail[0]?.time || now
  const endAt = phase === 'done' || phase === 'error' || phase === 'idle' ? lastEventTime || now : now
  const elapsed = Math.max(0, endAt - startAt)

  let taskSource = 'trace'
  let tasks = []
  if (todos && todos.length && !todoStale) {
    taskSource = 'todo'
    tasks = todos.map((todo) => ({
      id: `todo-${todo.id}`,
      title: todo.content,
      status: todo.status === 'in_progress' ? 'in_progress' : todo.status === 'completed' ? 'completed' : 'pending',
    }))
  } else {
    tasks = tools
      .filter((tool) => !isTodoTool(tool.name))
      .slice(-7)
      .map((tool) => {
        const info = describeTool(tool.name, tool.args)
        return {
          id: tool.id,
          title: info.detail,
          status: tool.status === 'done' ? 'completed' : tool.status === 'running' ? 'in_progress' : tool.status === 'error' ? 'error' : 'pending',
          tool: tool.name,
        }
      })
  }
  const activeTask =
    phase === 'acting' && focusTool
      ? {
          id: `active-${focusTool.id}`,
          sourceId: focusTool.id,
          title: describeTool(focusTool.name, focusTool.args).detail,
          tool: focusTool.name,
          status: 'in_progress',
        }
      : null
  const completed = tasks.filter((task) => task.status === 'completed').length
  const progress = tasks.length ? Math.round((completed / tasks.length) * 100) : 0

  const thought = collapse(reasoning, 1600)
  const thoughtBits = splitThoughts(thought, 3)
  const mapNodes = []
  if (prompt) {
    mapNodes.push({ id: 'goal', kind: 'goal', label: '目标', text: collapse(prompt, 64), status: 'completed', active: false })
  }
  for (let i = 0; i < Math.min(2, thoughtBits.length); i += 1) {
    mapNodes.push({ id: `think-${i}`, kind: 'think', label: '思路', text: thoughtBits[i], status: 'completed', active: false })
  }
  const seenTools = new Set()
  for (const tool of tools.filter((item) => !isTodoTool(item.name)).slice(-4)) {
    const info = describeTool(tool.name, tool.args)
    const key = `${info.label}|${info.target}`
    if (seenTools.has(key)) continue
    seenTools.add(key)
    mapNodes.push({
      id: `tool-${tool.id}`,
      kind: 'tool',
      label: info.label,
      text: info.target || info.label,
      status: tool.status,
      active: Boolean(focusTool && focusTool.id === tool.id),
    })
    if (seenTools.size >= 2) break
  }
  if (focusTool && focusTool.live) {
    const info = describeTool(focusTool.name, focusTool.args)
    mapNodes.push({ id: 'now', kind: 'now', label: info.label, text: info.target || info.label, status: 'running', active: true })
  }
  if (answer) {
    mapNodes.push({ id: 'answer', kind: 'answer', label: '输出', text: collapse(answer, 54), status: running ? 'running' : 'completed', active: false })
  }
  if (!mapNodes.length) {
    mapNodes.push({ id: 'idle', kind: 'now', label: '待命', text: '等待 AI 开始工作', status: 'idle', active: false })
  }

  const phaseInfo = PHASES[phase] || PHASES.idle
  return {
    ready: true,
    phase,
    phaseLabel: phaseInfo.label,
    tone: phaseInfo.tone,
    running,
    detail,
    prompt,
    promptShort: collapse(prompt, 90),
    turn: turn || 1,
    step: currentStep || 1,
    thought,
    thoughtBits,
    thoughtHistory,
    thoughtLive: Boolean(liveReasoning),
    answer: collapse(answer, 700),
    tools,
    focusTool,
    focus: focus ? { label: focus.label, target: focus.target, detail: focus.detail, name: focus.name } : null,
    tasks,
    activeTask,
    taskSource,
    todoStale,
    progress,
    completed,
    total: tasks.length,
    todos: todos || [],
    mapNodes,
    elapsed,
    tokens: totalOutput,
    contextTokens: windowUsage?.total || 0,
    contextInput: windowUsage?.input || 0,
    contextOutput: windowUsage?.output || 0,
    contextCache: (windowUsage?.cacheRead || 0) + (windowUsage?.cacheWrite || 0),
    lastEventTime,
    error: lastIsFailure ? lastTool?.error || lastTool?.result || '工具执行失败' : '',
  }
}

function emptyMind(overrides = {}) {
  return {
    ready: false,
    phase: 'idle',
    phaseLabel: PHASES.idle.label,
    tone: 'muted',
    running: false,
    detail: '等待 AI 开始工作',
    prompt: '',
    promptShort: '',
    turn: 1,
    step: 1,
    thought: '',
    thoughtBits: [],
    thoughtHistory: [],
    thoughtLive: false,
    answer: '',
    tools: [],
    focusTool: null,
    focus: null,
    tasks: [],
    activeTask: null,
    taskSource: 'trace',
    todoStale: false,
    progress: 0,
    completed: 0,
    total: 0,
    todos: [],
    mapNodes: [{ id: 'idle', kind: 'now', label: '待命', text: '等待 AI 开始工作', status: 'idle', active: false }],
    elapsed: 0,
    tokens: 0,
    contextTokens: 0,
    contextInput: 0,
    contextOutput: 0,
    contextCache: 0,
    lastEventTime: 0,
    error: '',
    ...overrides,
  }
}



const AI_MIND_CSS = ".aim-root {\n  --bg: #080b14;\n  --panel: rgba(255, 255, 255, 0.035);\n  --line: rgba(255, 255, 255, 0.08);\n  --text: #eaf0ff;\n  --muted: #8b96b3;\n  --dim: #5c6684;\n  --acc: #8b7dff;\n  --acc2: #5ee0ff;\n  --good: #4ade9c;\n  --warn: #ffb86b;\n  --bad: #ff6b8a;\n  position: relative;\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  height: 100%;\n  min-height: 100%;\n  box-sizing: border-box;\n  padding: 16px 14px 18px;\n  overflow-x: hidden;\n  overflow-y: auto;\n  color: var(--text);\n  font-family: Inter, \"Outfit\", ui-sans-serif, system-ui, -apple-system, \"PingFang SC\", \"Microsoft YaHei\", sans-serif;\n  font-size: 13px;\n  line-height: 1.5;\n  background:\n    radial-gradient(120% 55% at 100% -10%, rgba(139, 125, 255, 0.2), transparent 60%),\n    radial-gradient(90% 45% at -10% 105%, rgba(94, 224, 255, 0.1), transparent 60%),\n    linear-gradient(180deg, #0a0e1a 0%, #080b14 60%, #070a12 100%);\n  isolation: isolate;\n  scrollbar-color: rgba(255, 255, 255, 0.16) transparent;\n  scrollbar-width: thin;\n}\n\n.aim-root *,\n.aim-root *::before,\n.aim-root *::after {\n  box-sizing: border-box;\n}\n\n/* Keep sections at their natural height; the root, not the flex items, scrolls. */\n.aim-root > * {\n  flex: 0 0 auto;\n}\n\n.aim-root::before {\n  content: \"\";\n  position: absolute;\n  inset: 0;\n  z-index: -1;\n  pointer-events: none;\n  background-image:\n    linear-gradient(rgba(255, 255, 255, 0.028) 1px, transparent 1px),\n    linear-gradient(90deg, rgba(255, 255, 255, 0.028) 1px, transparent 1px);\n  background-size: 26px 26px;\n  mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.75), transparent 70%);\n}\n\n.aim-root::-webkit-scrollbar {\n  width: 6px;\n}\n\n.aim-root::-webkit-scrollbar-thumb {\n  background: rgba(255, 255, 255, 0.14);\n  border-radius: 99px;\n}\n\n.aim-root[data-tone=\"violet\"] {\n  --acc: #9a8bff;\n  --acc2: #71d7ff;\n}\n\n.aim-root[data-tone=\"cyan\"] {\n  --acc: #5ee0ff;\n  --acc2: #7c8dff;\n}\n\n.aim-root[data-tone=\"amber\"] {\n  --acc: #ffb86b;\n  --acc2: #ff8e6b;\n}\n\n.aim-root[data-tone=\"green\"] {\n  --acc: #4ade9c;\n  --acc2: #6ee7ff;\n}\n\n.aim-root[data-tone=\"red\"] {\n  --acc: #ff6b8a;\n  --acc2: #ffa26b;\n}\n\n.aim-root[data-tone=\"muted\"] {\n  --acc: #8b93ad;\n  --acc2: #6ea8c9;\n}\n\n.aim-icon {\n  display: block;\n  flex: 0 0 auto;\n}\n\n.aim-head {\n  display: flex;\n  flex: 0 0 auto;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n}\n\n.aim-brand {\n  display: flex;\n  align-items: center;\n  gap: 9px;\n  min-width: 0;\n}\n\n.aim-mark {\n  display: grid;\n  place-items: center;\n  width: 28px;\n  height: 28px;\n  border-radius: 9px;\n  color: #0a0d18;\n  background: linear-gradient(135deg, var(--acc), var(--acc2));\n  box-shadow: 0 4px 18px color-mix(in srgb, var(--acc) 35%, transparent);\n}\n\n.aim-brand-text {\n  display: flex;\n  flex-direction: column;\n  min-width: 0;\n  line-height: 1.05;\n}\n\n.aim-brand-text b {\n  font-size: 14px;\n  font-weight: 650;\n  letter-spacing: 0.2px;\n}\n\n.aim-brand-text span {\n  margin-top: 3px;\n  font-size: 8.5px;\n  font-weight: 600;\n  letter-spacing: 0.22em;\n  color: var(--dim);\n}\n\n.aim-pill {\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  padding: 4px 8px;\n  border: 1px solid var(--line);\n  border-radius: 99px;\n  background: rgba(255, 255, 255, 0.03);\n  color: var(--muted);\n  font-size: 9px;\n  font-weight: 700;\n  letter-spacing: 0.14em;\n  font-variant-numeric: tabular-nums;\n}\n\n.aim-pill i {\n  width: 5px;\n  height: 5px;\n  border-radius: 50%;\n  background: var(--dim);\n}\n\n.aim-pill.is-on {\n  color: var(--good);\n  border-color: color-mix(in srgb, var(--good) 30%, transparent);\n  background: color-mix(in srgb, var(--good) 8%, transparent);\n}\n\n.aim-pill.is-on i {\n  background: var(--good);\n  box-shadow: 0 0 0 3px color-mix(in srgb, var(--good) 16%, transparent);\n  animation: aim-pulse 1.8s infinite;\n}\n\n.aim-error {\n  display: flex;\n  align-items: flex-start;\n  gap: 8px;\n  padding: 9px 10px;\n  border: 1px solid rgba(255, 107, 138, 0.22);\n  border-radius: 12px;\n  background: rgba(255, 107, 138, 0.08);\n  color: #ffb3c2;\n  font-size: 11.5px;\n}\n\n.aim-hero {\n  position: relative;\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  padding: 15px 14px 13px;\n  overflow: hidden;\n  border: 1px solid var(--line);\n  border-radius: 18px;\n  background: linear-gradient(160deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.018));\n  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.05);\n}\n\n.aim-hero::after {\n  content: \"\";\n  position: absolute;\n  inset: -40% -20% auto;\n  height: 70%;\n  pointer-events: none;\n  background: radial-gradient(closest-side, color-mix(in srgb, var(--acc) 22%, transparent), transparent);\n  filter: blur(6px);\n}\n\n.aim-hero-main {\n  position: relative;\n  z-index: 1;\n  display: flex;\n  align-items: center;\n  gap: 12px;\n}\n\n.aim-hero-copy {\n  flex: 1;\n  min-width: 0;\n}\n\n.aim-phase {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 7px;\n  font-size: 15px;\n  font-weight: 650;\n  letter-spacing: 0.1px;\n}\n\n.aim-phase-dot {\n  width: 6px;\n  height: 6px;\n  border-radius: 50%;\n  background: var(--acc);\n  box-shadow: 0 0 10px var(--acc);\n}\n\n.aim-root.is-live .aim-phase-dot {\n  animation: aim-pulse 1.6s infinite;\n}\n\n.aim-phase-tool {\n  max-width: 120px;\n  padding: 2px 7px;\n  overflow: hidden;\n  border: 1px solid color-mix(in srgb, var(--acc) 22%, transparent);\n  border-radius: 99px;\n  background: color-mix(in srgb, var(--acc) 10%, transparent);\n  color: var(--acc);\n  font-size: 10px;\n  font-weight: 600;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.aim-detail {\n  display: -webkit-box;\n  margin-top: 4px;\n  overflow: hidden;\n  color: var(--muted);\n  font-size: 11.5px;\n  line-height: 1.4;\n  -webkit-box-orient: vertical;\n  -webkit-line-clamp: 2;\n}\n\n.aim-orb {\n  position: relative;\n  display: grid;\n  flex: 0 0 auto;\n  place-items: center;\n  border-radius: 50%;\n}\n\n.aim-orb-lg {\n  width: 46px;\n  height: 46px;\n}\n\n.aim-orb-md {\n  width: 34px;\n  height: 34px;\n}\n\n.aim-orb-halo {\n  position: absolute;\n  inset: -7px;\n  border-radius: 50%;\n  background: radial-gradient(circle, color-mix(in srgb, var(--acc) 42%, transparent), transparent 68%);\n  filter: blur(2px);\n  animation: aim-breathe 3.4s ease-in-out infinite;\n}\n\n.aim-orb-core {\n  position: absolute;\n  inset: 5px;\n  border-radius: 50%;\n  background: conic-gradient(from 0deg, var(--acc), var(--acc2), var(--acc));\n  box-shadow: 0 0 18px color-mix(in srgb, var(--acc) 45%, transparent);\n  animation: aim-spin 8s linear infinite;\n}\n\n.aim-orb-core::after {\n  content: \"\";\n  position: absolute;\n  inset: 7px;\n  border-radius: 50%;\n  background: #0a0e18;\n}\n\n.aim-orb-md .aim-orb-core {\n  inset: 4px;\n}\n\n.aim-orb-md .aim-orb-core::after {\n  inset: 5px;\n}\n\n.aim-orb-glyph {\n  position: relative;\n  z-index: 1;\n  color: #eaf0ff;\n  filter: drop-shadow(0 0 6px var(--acc));\n}\n\n.aim-metrics {\n  position: relative;\n  z-index: 1;\n  display: grid;\n  grid-template-columns: repeat(5, minmax(0, 1fr));\n  gap: 6px;\n}\n\n.aim-metric {\n  display: flex;\n  flex-direction: column;\n  gap: 1px;\n  min-width: 0;\n  padding: 7px 8px;\n  border: 1px solid rgba(255, 255, 255, 0.05);\n  border-radius: 10px;\n  background: rgba(255, 255, 255, 0.028);\n}\n\n.aim-metric span {\n  color: var(--dim);\n  font-size: 9px;\n  font-weight: 600;\n  letter-spacing: 0.08em;\n}\n\n.aim-metric-total b {\n  color: var(--acc2);\n}\n\n.aim-metric b {\n  overflow: hidden;\n  font-size: 12px;\n  font-weight: 650;\n  font-variant-numeric: tabular-nums;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.aim-progress {\n  position: relative;\n  z-index: 1;\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n}\n\n.aim-progress-head {\n  display: flex;\n  align-items: baseline;\n  justify-content: space-between;\n  color: var(--muted);\n  font-size: 10px;\n}\n\n.aim-progress-head b {\n  color: var(--text);\n  font-size: 10px;\n  font-weight: 600;\n  font-variant-numeric: tabular-nums;\n}\n\n.aim-bar {\n  position: relative;\n  height: 5px;\n  overflow: hidden;\n  border-radius: 99px;\n  background: rgba(255, 255, 255, 0.06);\n}\n\n.aim-bar > i {\n  display: block;\n  height: 100%;\n  border-radius: inherit;\n  background: linear-gradient(90deg, var(--acc), var(--acc2));\n  box-shadow: 0 0 12px color-mix(in srgb, var(--acc) 60%, transparent);\n  transition: width 0.55s cubic-bezier(0.22, 0.8, 0.24, 1);\n}\n\n.aim-progress.is-active .aim-bar::after {\n  content: \"\";\n  position: absolute;\n  inset: 0;\n  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.32), transparent);\n  animation: aim-sweep 1.7s linear infinite;\n}\n\n.aim-card {\n  display: flex;\n  flex-direction: column;\n  gap: 9px;\n  padding: 13px 13px 14px;\n  border: 1px solid var(--line);\n  border-radius: 16px;\n  background: linear-gradient(165deg, rgba(255, 255, 255, 0.042), rgba(255, 255, 255, 0.014));\n  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);\n}\n\n.aim-sec-head {\n  display: flex;\n  align-items: center;\n  gap: 7px;\n  min-width: 0;\n}\n\n.aim-sec-icon {\n  display: grid;\n  flex: 0 0 auto;\n  place-items: center;\n  width: 22px;\n  height: 22px;\n  border: 1px solid color-mix(in srgb, var(--acc) 18%, transparent);\n  border-radius: 7px;\n  background: color-mix(in srgb, var(--acc) 9%, transparent);\n  color: var(--acc);\n}\n\n.aim-sec-title {\n  font-size: 12px;\n  font-weight: 650;\n  letter-spacing: 0.02em;\n  white-space: nowrap;\n}\n\n.aim-sec-hint {\n  flex: 1;\n  margin-left: 2px;\n  overflow: hidden;\n  color: var(--dim);\n  font-size: 9.5px;\n  text-align: right;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.aim-sec-live {\n  display: inline-flex;\n  flex: 0 0 auto;\n  align-items: center;\n  gap: 4px;\n  margin-left: auto;\n  color: var(--acc);\n  font-size: 8px;\n  font-weight: 700;\n  letter-spacing: 0.14em;\n}\n\n.aim-sec-live i {\n  width: 4px;\n  height: 4px;\n  border-radius: 50%;\n  background: var(--acc);\n  animation: aim-pulse 1.4s infinite;\n}\n\n.aim-sec-live + .aim-sec-hint {\n  flex: 0 0 auto;\n  margin-left: 0;\n}\n\n.aim-prompt {\n  position: relative;\n  margin: 0;\n  padding-left: 10px;\n  border-left: 2px solid color-mix(in srgb, var(--acc) 55%, transparent);\n  color: #dbe4ff;\n  font-size: 12.5px;\n  line-height: 1.55;\n  overflow-wrap: anywhere;\n  white-space: pre-wrap;\n}\n\n.aim-prompt.is-empty {\n  border-left-color: var(--line);\n  color: var(--dim);\n}\n\n.aim-thought {\n  position: relative;\n  max-height: 180px;\n  padding: 10px 11px;\n  overflow: auto;\n  border: 1px solid rgba(255, 255, 255, 0.055);\n  border-radius: 11px;\n  background: rgba(0, 0, 0, 0.22);\n  scrollbar-color: rgba(255, 255, 255, 0.15) transparent;\n  scrollbar-width: thin;\n}\n\n.aim-thought::-webkit-scrollbar {\n  width: 4px;\n}\n\n.aim-thought p {\n  margin: 0;\n  color: #c9d4f2;\n  font-size: 12px;\n  line-height: 1.65;\n  overflow-wrap: anywhere;\n  white-space: pre-wrap;\n}\n\n.aim-thought.is-empty p {\n  color: var(--dim);\n  font-size: 11.5px;\n}\n\n.aim-caret {\n  display: inline-block;\n  width: 6px;\n  height: 12px;\n  margin-left: 2px;\n  border-radius: 1px;\n  background: var(--acc);\n  vertical-align: -1px;\n  animation: aim-blink 1s steps(1) infinite;\n}\n\n.aim-chips {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 5px;\n}\n\n.aim-chip {\n  max-width: 100%;\n  overflow: hidden;\n  padding: 2px 7px;\n  border: 1px solid var(--line);\n  border-radius: 99px;\n  background: rgba(255, 255, 255, 0.025);\n  color: var(--muted);\n  font-size: 9.5px;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.aim-process-toggle {\n  display: inline-flex;\n  flex: 0 0 auto;\n  align-items: center;\n  gap: 4px;\n  margin-left: auto;\n  padding: 3px 8px;\n  border: 1px solid color-mix(in srgb, var(--acc) 22%, transparent);\n  border-radius: 999px;\n  background: color-mix(in srgb, var(--acc) 8%, transparent);\n  color: var(--muted);\n  font: inherit;\n  font-size: 9px;\n  font-weight: 600;\n  letter-spacing: 0.02em;\n  cursor: pointer;\n  transition: color 160ms ease, border-color 160ms ease, background 160ms ease;\n}\n\n.aim-sec-live + .aim-process-toggle {\n  margin-left: 0;\n}\n\n.aim-process-toggle:hover,\n.aim-process-toggle.is-on {\n  border-color: color-mix(in srgb, var(--acc) 45%, transparent);\n  background: color-mix(in srgb, var(--acc) 14%, transparent);\n  color: var(--acc);\n}\n\n.aim-process-toggle:focus-visible {\n  outline: 2px solid color-mix(in srgb, var(--acc) 55%, transparent);\n  outline-offset: 1px;\n}\n\n.aim-process {\n  display: flex;\n  flex: 1 1 auto;\n  flex-direction: column;\n  gap: 10px;\n  min-height: 0;\n  padding: 8px 8px 8px 14px;\n  overflow: auto;\n  border: 1px solid rgba(255, 255, 255, 0.055);\n  border-radius: 11px;\n  background: rgba(0, 0, 0, 0.18);\n  scrollbar-color: rgba(255, 255, 255, 0.15) transparent;\n  scrollbar-width: thin;\n}\n\n.aim-process::-webkit-scrollbar {\n  width: 4px;\n}\n\n.aim-process-item {\n  position: relative;\n  flex: 0 0 auto;\n  padding-left: 10px;\n  border-left: 1px solid rgba(255, 255, 255, 0.1);\n}\n\n.aim-process-item::before {\n  content: \"\";\n  position: absolute;\n  top: 6px;\n  left: -3.5px;\n  width: 6px;\n  height: 6px;\n  border-radius: 50%;\n  background: color-mix(in srgb, var(--acc) 70%, #ffffff);\n  box-shadow: 0 0 0 2px color-mix(in srgb, var(--acc) 10%, transparent);\n}\n\n.aim-process-item.is-live::before {\n  animation: aim-pulse 1.4s infinite;\n  box-shadow: 0 0 8px var(--acc);\n}\n\n.aim-process-meta {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  color: var(--dim);\n  font-size: 9px;\n  letter-spacing: 0.03em;\n}\n\n.aim-process-step {\n  color: var(--muted);\n  font-weight: 650;\n}\n\n.aim-process-meta em {\n  color: var(--acc);\n  font-size: 8px;\n  font-style: normal;\n  font-weight: 700;\n  letter-spacing: 0.1em;\n}\n\n.aim-process-meta time {\n  margin-left: auto;\n  font-variant-numeric: tabular-nums;\n}\n\n.aim-process-item p {\n  margin: 3px 0 0;\n  color: #c9d4f2;\n  font-size: 11.5px;\n  line-height: 1.72;\n  overflow-wrap: anywhere;\n  white-space: pre-wrap;\n}\n\n.aim-map-card {\n  padding-bottom: 10px;\n}\n\n.aim-map {\n  position: relative;\n  width: 100%;\n  min-height: 186px;\n  margin-top: 1px;\n  aspect-ratio: 340 / 220;\n}\n\n.aim-map-svg {\n  position: absolute;\n  inset: 0;\n  width: 100%;\n  height: 100%;\n  overflow: visible;\n  color: var(--acc);\n}\n\n.aim-map-aura {\n  opacity: 0.7;\n  transform-origin: center;\n  animation: aim-breathe 4s ease-in-out infinite;\n}\n\n.aim-map-link {\n  stroke: rgba(255, 255, 255, 0.14);\n  stroke-width: 1;\n  stroke-dasharray: 3 4;\n  transition: stroke 0.3s;\n}\n\n.aim-map-link.is-active {\n  stroke: color-mix(in srgb, var(--acc) 65%, transparent);\n  stroke-width: 1.4;\n  stroke-dasharray: none;\n  filter: drop-shadow(0 0 4px var(--acc));\n}\n\n.aim-map-core {\n  position: absolute;\n  z-index: 2;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  width: 58px;\n  height: 58px;\n  border: 1px solid color-mix(in srgb, var(--acc) 45%, transparent);\n  border-radius: 50%;\n  background: radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.15), rgba(10, 14, 24, 0.9) 65%);\n  box-shadow: 0 0 24px color-mix(in srgb, var(--acc) 28%, transparent), inset 0 0 12px color-mix(in srgb, var(--acc) 14%, transparent);\n  transform: translate(-50%, -50%);\n}\n\n.aim-core-pulse {\n  position: absolute;\n  inset: -6px;\n  border: 1px solid color-mix(in srgb, var(--acc) 32%, transparent);\n  border-radius: 50%;\n  animation: aim-ring 3s ease-out infinite;\n}\n\n.aim-core-word {\n  color: #f2f5ff;\n  font-size: 12px;\n  font-weight: 750;\n  letter-spacing: 0.06em;\n  line-height: 1;\n}\n\n.aim-core-state {\n  margin-top: 3px;\n  color: var(--muted);\n  font-size: 7.5px;\n  letter-spacing: 0.03em;\n  white-space: nowrap;\n}\n\n.aim-map-node {\n  position: absolute;\n  z-index: 3;\n  display: flex;\n  flex-direction: column;\n  width: 92px;\n  min-height: 32px;\n  padding: 4px 6px;\n  border: 1px solid rgba(255, 255, 255, 0.09);\n  border-radius: 9px;\n  background: rgba(12, 17, 30, 0.9);\n  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);\n  backdrop-filter: blur(4px);\n  transform: translate(-50%, -50%);\n  transition: border-color 0.25s, box-shadow 0.25s, transform 0.25s;\n}\n\n.aim-map-node:hover {\n  z-index: 5;\n  border-color: color-mix(in srgb, var(--acc) 45%, transparent);\n  transform: translate(-50%, -50%) scale(1.04);\n}\n\n.aim-map-node-dot {\n  position: absolute;\n  top: -3px;\n  left: -3px;\n  width: 6px;\n  height: 6px;\n  border-radius: 50%;\n  background: var(--dim);\n  box-shadow: 0 0 0 2px rgba(12, 17, 30, 0.95);\n}\n\n.aim-kind-goal .aim-map-node-dot {\n  background: #9a8bff;\n  box-shadow: 0 0 8px #9a8bff;\n}\n\n.aim-kind-think .aim-map-node-dot {\n  background: #5ee0ff;\n  box-shadow: 0 0 8px #5ee0ff;\n}\n\n.aim-kind-tool .aim-map-node-dot,\n.aim-kind-now .aim-map-node-dot {\n  background: #ffb86b;\n  box-shadow: 0 0 8px #ffb86b;\n}\n\n.aim-kind-answer .aim-map-node-dot {\n  background: #4ade9c;\n  box-shadow: 0 0 8px #4ade9c;\n}\n\n.aim-map-node-label {\n  color: var(--dim);\n  font-size: 8px;\n  font-weight: 700;\n  letter-spacing: 0.08em;\n  line-height: 1.15;\n  text-transform: uppercase;\n}\n\n.aim-map-node-text {\n  display: -webkit-box;\n  overflow: hidden;\n  color: #cfd8f5;\n  font-size: 9.5px;\n  line-height: 1.25;\n  overflow-wrap: anywhere;\n  -webkit-box-orient: vertical;\n  -webkit-line-clamp: 2;\n}\n\n.aim-map-node.is-active {\n  border-color: color-mix(in srgb, var(--acc) 60%, transparent);\n  box-shadow: 0 0 0 1px color-mix(in srgb, var(--acc) 25%, transparent), 0 0 16px color-mix(in srgb, var(--acc) 20%, transparent);\n}\n\n.aim-map-node.is-error {\n  border-color: rgba(255, 107, 138, 0.5);\n}\n\n.aim-map-foot {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 10px;\n  padding-top: 2px;\n}\n\n.aim-legend {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  color: var(--dim);\n  font-size: 8.5px;\n  letter-spacing: 0.04em;\n}\n\n.aim-legend-dot {\n  width: 5px;\n  height: 5px;\n  border-radius: 50%;\n  background: var(--dim);\n}\n\n.aim-legend-dot.is-goal {\n  background: #9a8bff;\n}\n\n.aim-legend-dot.is-think {\n  background: #5ee0ff;\n}\n\n.aim-legend-dot.is-tool {\n  background: #ffb86b;\n}\n\n.aim-legend-dot.is-answer {\n  background: #4ade9c;\n}\n\n.aim-tasks {\n  display: flex;\n  flex-direction: column;\n  gap: 0;\n}\n\n.aim-task {\n  position: relative;\n  display: flex;\n  gap: 9px;\n  padding: 8px 0;\n}\n\n.aim-task + .aim-task {\n  padding-top: 2px;\n}\n\n.aim-task-rail {\n  position: relative;\n  display: flex;\n  flex: 0 0 14px;\n  justify-content: center;\n  width: 14px;\n}\n\n.aim-task-rail::before {\n  content: \"\";\n  position: absolute;\n  top: 0;\n  bottom: -10px;\n  left: 50%;\n  width: 1px;\n  background: linear-gradient(180deg, rgba(255, 255, 255, 0.13), rgba(255, 255, 255, 0.04));\n}\n\n.aim-task:last-child .aim-task-rail::before {\n  display: none;\n}\n\n.aim-rail-dot {\n  position: relative;\n  z-index: 1;\n  width: 7px;\n  height: 7px;\n  margin-top: 6px;\n  border: 1.5px solid rgba(255, 255, 255, 0.25);\n  border-radius: 50%;\n  background: #151b2c;\n}\n\n.aim-task.is-completed .aim-rail-dot {\n  border-color: var(--good);\n  background: var(--good);\n  box-shadow: 0 0 8px color-mix(in srgb, var(--good) 55%, transparent);\n}\n\n.aim-task.is-in_progress .aim-rail-dot {\n  border-color: var(--acc);\n  background: var(--acc);\n  box-shadow: 0 0 0 3px color-mix(in srgb, var(--acc) 18%, transparent), 0 0 10px var(--acc);\n  animation: aim-pulse 1.8s infinite;\n}\n\n.aim-task.is-error .aim-rail-dot {\n  border-color: var(--bad);\n  background: var(--bad);\n}\n\n.aim-task-body {\n  display: flex;\n  flex: 1;\n  flex-direction: column;\n  gap: 2px;\n  min-width: 0;\n  padding-top: 1px;\n}\n\n.aim-task-top {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  min-height: 14px;\n}\n\n.aim-task-kicker {\n  color: var(--dim);\n  font-size: 8.5px;\n  font-weight: 700;\n  letter-spacing: 0.14em;\n  text-transform: uppercase;\n}\n\n.aim-task-index {\n  color: var(--dim);\n  font-size: 8.5px;\n  font-weight: 700;\n  letter-spacing: 0.06em;\n  font-variant-numeric: tabular-nums;\n}\n\n.aim-task-state {\n  margin-left: auto;\n  padding: 1px 5px;\n  border: 1px solid var(--line);\n  border-radius: 99px;\n  background: rgba(255, 255, 255, 0.02);\n  color: var(--muted);\n  font-size: 8.5px;\n  white-space: nowrap;\n}\n\n.aim-task-state.is-completed {\n  border-color: color-mix(in srgb, var(--good) 24%, transparent);\n  background: color-mix(in srgb, var(--good) 7%, transparent);\n  color: var(--good);\n}\n\n.aim-task-state.is-in_progress {\n  border-color: color-mix(in srgb, var(--acc) 30%, transparent);\n  background: color-mix(in srgb, var(--acc) 9%, transparent);\n  color: var(--acc);\n}\n\n.aim-task-state.is-error {\n  border-color: color-mix(in srgb, var(--bad) 30%, transparent);\n  color: var(--bad);\n}\n\n.aim-task-title {\n  display: -webkit-box;\n  overflow: hidden;\n  color: #dbe4ff;\n  font-size: 11.5px;\n  line-height: 1.4;\n  overflow-wrap: anywhere;\n  -webkit-box-orient: vertical;\n  -webkit-line-clamp: 2;\n}\n\n.aim-task.is-completed .aim-task-title {\n  color: var(--muted);\n  text-decoration: line-through;\n  text-decoration-color: rgba(255, 255, 255, 0.16);\n}\n\n.aim-task-root .aim-task-title {\n  color: #f0f4ff;\n  font-size: 12px;\n  font-weight: 600;\n}\n\n.aim-task-ghost .aim-task-title {\n  color: var(--dim);\n  font-size: 11px;\n  font-style: italic;\n}\n\n.aim-task.is-active .aim-task-title {\n  color: #ffffff;\n}\n\n.aim-task-live .aim-task-index {\n  color: var(--acc);\n  letter-spacing: 0.1em;\n}\n\n.aim-task-more {\n  padding-left: 23px;\n  color: var(--dim);\n  font-size: 9px;\n}\n\n.aim-foot {\n  display: grid;\n  flex: 0 0 auto;\n  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);\n  align-items: center;\n  gap: 8px;\n  margin-top: auto;\n  padding-top: 6px;\n  border-top: 1px solid rgba(255, 255, 255, 0.045);\n  color: var(--dim);\n  font-size: 9px;\n  letter-spacing: 0.03em;\n}\n\n.aim-foot-status {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.aim-credit {\n  justify-self: center;\n  color: color-mix(in srgb, var(--dim) 82%, var(--text));\n  font-size: 8.5px;\n  letter-spacing: 0.04em;\n  white-space: nowrap;\n  cursor: help;\n}\n\n.aim-foot-time {\n  justify-self: end;\n  font-variant-numeric: tabular-nums;\n}\n\n.aim-skeleton {\n  gap: 10px;\n}\n\n.aim-skel {\n  border: 1px solid rgba(255, 255, 255, 0.05);\n  border-radius: 12px;\n  background: linear-gradient(100deg, rgba(255, 255, 255, 0.04) 20%, rgba(255, 255, 255, 0.085) 40%, rgba(255, 255, 255, 0.04) 60%);\n  background-size: 220% 100%;\n  animation: aim-shimmer 1.5s linear infinite;\n}\n\n.aim-skel-head {\n  width: 55%;\n  height: 32px;\n  border-radius: 9px;\n}\n\n.aim-skel-hero {\n  height: 150px;\n  border-radius: 18px;\n}\n\n.aim-skel-line {\n  height: 12px;\n}\n\n.aim-skel-line.short {\n  width: 62%;\n}\n\n.aim-skel-map {\n  height: 196px;\n  border-radius: 16px;\n}\n\n.aim-sec {\n  animation: aim-rise 0.5s cubic-bezier(0.2, 0.75, 0.25, 1) both;\n}\n\n@keyframes aim-pulse {\n  0%,\n  100% {\n    opacity: 1;\n  }\n  50% {\n    opacity: 0.35;\n  }\n}\n\n@keyframes aim-breathe {\n  0%,\n  100% {\n    opacity: 0.65;\n    transform: scale(1);\n  }\n  50% {\n    opacity: 1;\n    transform: scale(1.08);\n  }\n}\n\n@keyframes aim-spin {\n  to {\n    transform: rotate(360deg);\n  }\n}\n\n@keyframes aim-sweep {\n  from {\n    transform: translateX(-100%);\n  }\n  to {\n    transform: translateX(100%);\n  }\n}\n\n@keyframes aim-ring {\n  0% {\n    opacity: 0.8;\n    transform: scale(0.92);\n  }\n  70% {\n    opacity: 0;\n    transform: scale(1.22);\n  }\n  100% {\n    opacity: 0;\n  }\n}\n\n@keyframes aim-blink {\n  0%,\n  49% {\n    opacity: 1;\n  }\n  50%,\n  100% {\n    opacity: 0;\n  }\n}\n\n@keyframes aim-rise {\n  from {\n    opacity: 0;\n    transform: translateY(8px);\n  }\n  to {\n    opacity: 1;\n    transform: none;\n  }\n}\n\n@keyframes aim-shimmer {\n  from {\n    background-position: 180% 0;\n  }\n  to {\n    background-position: -40% 0;\n  }\n}\n\n@media (max-width: 420px) {\n  .aim-root {\n    padding: 13px 11px 16px;\n  }\n\n  .aim-metrics {\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n  }\n\n  .aim-map {\n    min-height: 170px;\n  }\n\n  .aim-map-node {\n    width: 84px;\n  }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .aim-root *,\n  .aim-root *::before,\n  .aim-root *::after {\n    animation: none !important;\n    transition: none !important;\n  }\n}\n\n\n/* ── One-screen product layout ───────────────────────────────────────────\n   The right column is a fixed dashboard: header + status hero + 2×2 bento\n   board + footer. Cards own their overflow, so the panel itself never scrolls. */\n.aim-root {\n  container-type: inline-size;\n  container-name: aim;\n  gap: 10px;\n  padding: 12px 12px 10px;\n  overflow: hidden;\n}\n\n.aim-hero {\n  flex: 0 0 auto;\n  gap: 8px;\n  padding: 11px 12px 10px;\n}\n\n.aim-hero-main {\n  gap: 10px;\n}\n\n.aim-orb-lg {\n  width: 42px;\n  height: 42px;\n}\n\n.aim-metrics {\n  gap: 5px;\n}\n\n.aim-metric {\n  padding: 5px 7px;\n}\n\n.aim-progress {\n  gap: 4px;\n}\n\n.aim-board {\n  display: grid;\n  flex: 1 1 auto;\n  grid-template-columns: minmax(0, 1.04fr) minmax(0, 0.96fr);\n  gap: 10px;\n  min-height: 0;\n}\n\n.aim-col {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n  min-height: 0;\n}\n\n.aim-goal-card {\n  flex: 0 0 auto;\n  gap: 6px;\n  padding: 10px 12px;\n}\n\n.aim-goal-card .aim-prompt {\n  display: -webkit-box;\n  overflow: hidden;\n  font-size: 11.5px;\n  line-height: 1.5;\n  -webkit-box-orient: vertical;\n  -webkit-line-clamp: 2;\n}\n\n.aim-thought-card {\n  flex: 1 1 auto;\n  min-height: 0;\n  gap: 7px;\n  padding: 11px 12px 10px;\n}\n\n.aim-thought-card .aim-thought {\n  flex: 1 1 auto;\n  max-height: none;\n  min-height: 0;\n}\n\n.aim-thought-card .aim-chips {\n  flex: 0 0 auto;\n}\n\n.aim-col-viz .aim-map-card {\n  flex: 0 0 auto;\n  gap: 7px;\n  padding: 10px 12px 9px;\n}\n\n.aim-map {\n  height: 214px;\n  min-height: 0;\n  aspect-ratio: auto;\n}\n\n.aim-tasks-card {\n  flex: 1 1 auto;\n  min-height: 0;\n  gap: 7px;\n  padding: 10px 12px 9px;\n}\n\n.aim-tasks-card .aim-tasks {\n  flex: 1 1 auto;\n  min-height: 0;\n  overflow: auto;\n  overscroll-behavior: contain;\n  padding-right: 2px;\n  scrollbar-color: rgba(255, 255, 255, 0.15) transparent;\n  scrollbar-width: thin;\n}\n\n.aim-foot {\n  flex: 0 0 auto;\n  padding: 0 2px;\n  font-size: 9px;\n}\n\n@container aim (max-width: 640px) {\n  .aim-hero {\n    gap: 7px;\n    padding: 10px;\n  }\n\n  .aim-orb-lg {\n    width: 38px;\n    height: 38px;\n  }\n\n  .aim-metrics {\n    grid-template-columns: repeat(5, minmax(0, 1fr));\n  }\n\n  .aim-metric {\n    padding: 4px 5px;\n  }\n\n  .aim-board {\n    grid-template-columns: minmax(0, 1fr);\n    grid-template-rows: auto minmax(0, 1.2fr) auto minmax(0, 1fr);\n    gap: 8px;\n  }\n\n  .aim-col {\n    display: contents;\n  }\n\n  .aim-goal-card {\n    order: 1;\n  }\n\n  .aim-thought-card {\n    order: 2;\n  }\n\n  .aim-map-card {\n    order: 3;\n  }\n\n  .aim-tasks-card {\n    order: 4;\n  }\n\n  .aim-map {\n    height: 130px;\n  }\n\n  .aim-map-node {\n    width: 82px;\n  }\n\n  .aim-map-node-text {\n    display: none;\n  }\n\n  .aim-thought-card .aim-chips {\n    display: none;\n  }\n\n  .aim-foot-status {\n    visibility: hidden;\n  }\n}\n\n@media (max-height: 760px) {\n  .aim-chips {\n    display: none;\n  }\n\n  .aim-foot-status,\n  .aim-foot-time {\n    visibility: hidden;\n  }\n\n  .aim-map {\n    height: 176px;\n  }\n\n  .aim-hero {\n    padding: 9px 11px;\n  }\n\n  .aim-detail {\n    -webkit-line-clamp: 1;\n  }\n}\n\n\n.aim-head-actions {\n  display: flex;\n  flex: 0 0 auto;\n  align-items: center;\n  gap: 6px;\n}\n\n.aim-balance {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  height: 26px;\n  padding: 0 7px;\n  border: 1px solid var(--line);\n  border-radius: 8px;\n  background: var(--panel);\n  color: var(--muted);\n  text-decoration: none;\n  white-space: nowrap;\n  font-size: 9px;\n  font-weight: 600;\n  transition: color 0.16s ease, border-color 0.16s ease, background 0.16s ease;\n}\n\n.aim-balance .aim-icon {\n  color: var(--acc);\n}\n\n.aim-balance b {\n  color: var(--text);\n  font-size: 10.5px;\n  font-weight: 650;\n  font-variant-numeric: tabular-nums;\n}\n\n.aim-balance:hover {\n  border-color: color-mix(in srgb, var(--acc) 38%, transparent);\n  background: color-mix(in srgb, var(--acc) 9%, transparent);\n  color: var(--text);\n}\n\n.aim-balance:focus-visible {\n  outline: 2px solid color-mix(in srgb, var(--acc) 55%, transparent);\n  outline-offset: 1px;\n}\n\n.aim-balance.is-loading b {\n  color: var(--dim);\n}\n\n.aim-balance.is-low b {\n  color: var(--warn);\n}\n\n.aim-theme {\n  display: grid;\n  place-items: center;\n  width: 26px;\n  height: 26px;\n  padding: 0;\n  border: 1px solid var(--line);\n  border-radius: 8px;\n  background: var(--panel);\n  color: var(--muted);\n  cursor: pointer;\n  transition: color 0.16s ease, border-color 0.16s ease, background 0.16s ease;\n}\n\n.aim-theme:hover {\n  border-color: color-mix(in srgb, var(--acc) 38%, transparent);\n  background: color-mix(in srgb, var(--acc) 9%, transparent);\n  color: var(--text);\n}\n\n.aim-theme:focus-visible {\n  outline: 2px solid color-mix(in srgb, var(--acc) 55%, transparent);\n  outline-offset: 1px;\n}\n\n/* ---- light theme ---- */\n.aim-root[data-aim-theme=\"light\"] {\n  color-scheme: light;\n  --bg: #f4f7fc;\n  --panel: rgba(15, 23, 42, 0.035);\n  --line: rgba(15, 23, 42, 0.09);\n  --text: #1b2436;\n  --muted: #5b6680;\n  --dim: #8792a8;\n  --acc: #6d5ce7;\n  --acc2: #0891b2;\n  --good: #0f9f6e;\n  --warn: #b45309;\n  --bad: #e11d48;\n  background:\n    radial-gradient(115% 52% at 100% -8%, rgba(109, 92, 231, 0.1), transparent 62%),\n    radial-gradient(85% 42% at -8% 104%, rgba(8, 145, 178, 0.08), transparent 60%),\n    linear-gradient(180deg, #f9fbfe 0%, #f3f6fb 58%, #edf2fa 100%);\n  scrollbar-color: rgba(15, 23, 42, 0.18) transparent;\n}\n\n.aim-root[data-aim-theme=\"light\"][data-tone=\"violet\"] {\n  --acc: #6d5ce7;\n  --acc2: #0891b2;\n}\n\n.aim-root[data-aim-theme=\"light\"][data-tone=\"cyan\"] {\n  --acc: #0e7490;\n  --acc2: #6d5ce7;\n}\n\n.aim-root[data-aim-theme=\"light\"][data-tone=\"amber\"] {\n  --acc: #b45309;\n  --acc2: #ea580c;\n}\n\n.aim-root[data-aim-theme=\"light\"][data-tone=\"green\"] {\n  --acc: #0f9f6e;\n  --acc2: #0e7490;\n}\n\n.aim-root[data-aim-theme=\"light\"][data-tone=\"red\"] {\n  --acc: #e11d48;\n  --acc2: #ea580c;\n}\n\n.aim-root[data-aim-theme=\"light\"][data-tone=\"muted\"] {\n  --acc: #64748b;\n  --acc2: #0e7490;\n}\n\n.aim-root[data-aim-theme=\"light\"]::before {\n  background:\n    linear-gradient(rgba(15, 23, 42, 0.035) 1px, transparent 1px),\n    linear-gradient(90deg, rgba(15, 23, 42, 0.035) 1px, transparent 1px);\n}\n\n.aim-root[data-aim-theme=\"light\"]::-webkit-scrollbar-thumb {\n  background: rgba(15, 23, 42, 0.18);\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-mark {\n  color: #ffffff;\n  box-shadow: 0 4px 14px color-mix(in srgb, var(--acc) 24%, transparent);\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-brand-text span {\n  color: var(--dim);\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-pill {\n  background: rgba(15, 23, 42, 0.035);\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-error {\n  border-color: rgba(225, 29, 72, 0.18);\n  background: rgba(225, 29, 72, 0.06);\n  color: #b42340;\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-hero {\n  background: linear-gradient(160deg, rgba(255, 255, 255, 0.94), rgba(255, 255, 255, 0.66));\n  box-shadow: 0 10px 26px rgba(23, 37, 66, 0.08), inset 0 1px 0 #ffffff;\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-orb-core::after {\n  background: #f5f8ff;\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-orb-glyph {\n  color: #ffffff;\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-metric {\n  border-color: rgba(15, 23, 42, 0.07);\n  background: rgba(255, 255, 255, 0.62);\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-bar {\n  background: rgba(15, 23, 42, 0.08);\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-progress.is-active .aim-bar::after {\n  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.55), transparent);\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-card {\n  background: linear-gradient(165deg, rgba(255, 255, 255, 0.94), rgba(255, 255, 255, 0.72));\n  box-shadow: 0 6px 18px rgba(23, 37, 66, 0.055), inset 0 1px 0 #ffffff;\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-prompt {\n  color: #33405a;\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-thought {\n  border-color: rgba(15, 23, 42, 0.08);\n  background: rgba(15, 23, 42, 0.035);\n  scrollbar-color: rgba(15, 23, 42, 0.16) transparent;\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-thought::-webkit-scrollbar-thumb {\n  background: rgba(15, 23, 42, 0.16);\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-thought p {\n  color: #35425c;\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-process-toggle {\n  background: color-mix(in srgb, var(--acc) 6%, #ffffff);\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-process {\n  background: rgba(255, 255, 255, 0.68);\n  border-color: rgba(15, 23, 42, 0.08);\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-process-item {\n  border-left-color: rgba(15, 23, 42, 0.12);\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-process-item p {\n  color: #35425c;\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-chip {\n  background: rgba(15, 23, 42, 0.03);\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-map-link {\n  stroke: rgba(15, 23, 42, 0.16);\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-map-core {\n  background: radial-gradient(circle at 35% 30%, #ffffff, #eef2fb 68%);\n  box-shadow: 0 0 20px color-mix(in srgb, var(--acc) 20%, transparent), inset 0 0 12px color-mix(in srgb, var(--acc) 8%, transparent);\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-core-word {\n  color: #172033;\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-map-node {\n  border-color: rgba(15, 23, 42, 0.12);\n  background: rgba(255, 255, 255, 0.95);\n  box-shadow: 0 4px 12px rgba(23, 37, 66, 0.09);\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-map-node-dot {\n  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.95);\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-map-node-text {\n  color: #33405a;\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-map-node.is-active {\n  border-color: color-mix(in srgb, var(--acc) 55%, transparent);\n  box-shadow: 0 0 0 1px color-mix(in srgb, var(--acc) 22%, transparent), 0 4px 16px color-mix(in srgb, var(--acc) 16%, transparent);\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-task-rail::before {\n  background: linear-gradient(180deg, rgba(15, 23, 42, 0.16), rgba(15, 23, 42, 0.04));\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-rail-dot {\n  border-color: rgba(15, 23, 42, 0.28);\n  background: #ffffff;\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-task-state {\n  background: rgba(15, 23, 42, 0.03);\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-task-title {\n  color: #2b3750;\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-task.is-active .aim-task-title,\n.aim-root[data-aim-theme=\"light\"] .aim-task-root .aim-task-title {\n  color: #0b1220;\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-task.is-completed .aim-task-title {\n  color: var(--muted);\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-foot {\n  border-top-color: rgba(15, 23, 42, 0.07);\n}\n\n.aim-root[data-aim-theme=\"light\"] .aim-skel {\n  border-color: rgba(15, 23, 42, 0.07);\n  background: linear-gradient(100deg, rgba(15, 23, 42, 0.035) 20%, rgba(15, 23, 42, 0.075) 40%, rgba(15, 23, 42, 0.035) 60%);\n}\n.aim-root[data-aim-theme=\"light\"] .aim-balance {\n  background: rgba(255, 255, 255, 0.86);\n  box-shadow: 0 2px 7px rgba(23, 37, 66, 0.05);\n}\n\n/* codex-ui duplicates DSH's native turn navigator; prefer the native rail. */\nhtml[data-dcu-official-turn-navigator-supported=\"true\"] .dcu-turn-navigator {\n  display: none !important;\n}\n\n/* If the codex-ui rail is the active one, keep its native <ol>/<button>\n   fallback from leaking list markers and browser button chrome. */\n.dcu-turn-navigator .dcu-turn-list {\n  list-style: none !important;\n  margin: 0 !important;\n  padding: 4px 0 !important;\n  width: 16px !important;\n}\n\n.dcu-turn-navigator .dcu-turn-link {\n  width: 16px !important;\n  height: 8px !important;\n  padding: 0 !important;\n  border: 0 !important;\n  background: transparent !important;\n}\n";

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
          'a',
          {
            className: cx('aim-balance', balance.status === 'loading' && 'is-loading', wallet?.low && 'is-low'),
            href: TOP_UP_URL,
            target: '_blank',
            rel: 'noreferrer',
            title: balanceTitle,
            'aria-label': balanceTitle.replace(/\n/g, '，'),
          },
          h(Icon, { name: 'wallet', size: 11 }),
          h('span', { className: 'aim-balance-label' }, '余额'),
          h('b', null, balance.status === 'loading' ? '…' : wallet?.text || '—'),
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


module.exports = { name: "dsh-ai-mind", inject: ["betterSidebar", "sidebarRight", "sessions"], apply };
return module.exports;
}});
