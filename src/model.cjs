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
  if (!isObject(usage)) return { output: 0, input: 0 }
  return {
    output: Number(usage.outputTokens) || 0,
    input: Number(usage.inputTokens) || 0,
  }
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
  let todos = null
  let lastTodoStep = -1
  const tools = []
  const byCall = new Map()

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
      const parts = assistantParts(data.message)
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
  let liveAt = 0
  for (const event of live) {
    const data = event.data || {}
    const chunk = data.chunk
    if (!chunk) continue
    liveAt = Math.max(liveAt, Number(event.time) || 0)
    if (data.step) liveStep = data.step
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
    thoughtLive: Boolean(liveReasoning),
    answer: collapse(answer, 700),
    tools,
    focusTool,
    focus: focus ? { label: focus.label, target: focus.target, detail: focus.detail, name: focus.name } : null,
    tasks,
    taskSource,
    todoStale,
    progress,
    completed,
    total: tasks.length,
    todos: todos || [],
    mapNodes,
    elapsed,
    tokens: totalOutput,
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
    thoughtLive: false,
    answer: '',
    tools: [],
    focusTool: null,
    focus: null,
    tasks: [],
    taskSource: 'trace',
    todoStale: false,
    progress: 0,
    completed: 0,
    total: 0,
    todos: [],
    mapNodes: [{ id: 'idle', kind: 'now', label: '待命', text: '等待 AI 开始工作', status: 'idle', active: false }],
    elapsed: 0,
    tokens: 0,
    lastEventTime: 0,
    error: '',
    ...overrides,
  }
}

module.exports = {
  deriveMind,
  emptyMind,
  describeTool,
  splitThoughts,
  parseArgs,
  isTodoTool,
  contentText,
  TOOL_META,
  PHASES,
}
