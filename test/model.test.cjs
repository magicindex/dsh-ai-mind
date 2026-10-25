'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { deriveMind, emptyMind } = require('../src/model.cjs')

let seq = 0
const ev = (type, data = {}, time = 1000) => ({ type, seq: (seq += 1), time, data })
const user = (text, time = 1000) => ev('user/message', {
  content: [{ type: 'text', text }],
  source: { kind: 'user' },
}, time)

test('empty entries stay idle, never invent a phase', () => {
  const mind = deriveMind([], { now: 5000, running: false })
  assert.equal(mind.phase, 'idle')
  assert.equal(mind.prompt, '')
  assert.equal(mind.progress, 0)
  assert.equal(mind.mapNodes.length, 1)
  assert.equal(mind.mapNodes[0].kind, 'now')
})

test('live reasoning drives thinking and the live thought stream', () => {
  const entries = [
    user('帮我整理右侧栏插件'),
    { type: 'transient', event: ev('assistant/live-chunk', {
      attemptId: 'a1', turn: 1, step: 2,
      chunk: { type: 'block-start', index: 0, blockType: 'reasoning' },
    }, 2000) },
    { type: 'transient', event: ev('assistant/live-chunk', {
      attemptId: 'a1', turn: 1, step: 2,
      chunk: { type: 'reasoning-delta', index: 0, text: '先确认数据来源，再决定图表布局。' },
    }, 2200) },
  ]
  const mind = deriveMind(entries, { now: 6000, running: true })
  assert.equal(mind.phase, 'thinking')
  assert.equal(mind.thoughtLive, true)
  assert.match(mind.thought, /数据来源/)
  assert.equal(mind.step, 2)
})

test('a running tool call becomes the focused action and a trace task', () => {
  const entries = [
    user('看看目录'),
    ev('tool/call', {
      turn: 1, step: 3, callId: 'c1', name: 'bash',
      arguments: JSON.stringify({ command: 'ls -la', description: '列出目录' }),
    }, 3000),
  ]
  const mind = deriveMind(entries, { now: 9000, running: true })
  assert.equal(mind.phase, 'acting')
  assert.equal(mind.focusTool.name, 'bash')
  assert.match(mind.focus.detail, /列出目录/)
  assert.equal(mind.tasks.length, 1)
  assert.equal(mind.tasks[0].status, 'in_progress')
  assert.equal(mind.mapNodes.some(node => node.active), true)
})

test('a failed tool call reports error after the turn settles', () => {
  const entries = [
    user('读配置'),
    ev('tool/call', { turn: 1, step: 2, callId: 'c2', name: 'read', arguments: '{"file_path":"/nope"}' }, 3000),
    ev('tool/result', {
      turn: 1, step: 2,
      message: {
        role: 'tool', toolCallId: 'c2', isError: true,
        content: [{ type: 'text', text: 'ENOENT: no such file' }],
      },
    }, 3500),
  ]
  const mind = deriveMind(entries, { now: 9000, running: false })
  assert.equal(mind.phase, 'error')
  assert.match(mind.error, /ENOENT/)
  assert.equal(mind.tools[0].status, 'error')
})

test('todo_write supplies task progress and is not counted as a work item', () => {
  const entries = [
    user('做三件事'),
    ev('tool/call', {
      turn: 1, step: 2, callId: 't1', name: 'todo_write',
      arguments: JSON.stringify({ todos: [
        { content: '确认数据来源', status: 'completed' },
        { content: '实现右侧栏', status: 'in_progress' },
        { content: '安装验证', status: 'pending' },
      ] }),
    }, 3000),
    ev('step/start', { turn: 1, step: 4 }, 4000),
  ]
  const mind = deriveMind(entries, { now: 9000, running: true })
  assert.equal(mind.taskSource, 'todo')
  assert.equal(mind.completed, 1)
  assert.equal(mind.total, 3)
  assert.equal(mind.progress, 33)
  assert.equal(mind.tools.length, 0)
  assert.equal(mind.tasks[1].status, 'in_progress')
})

test('a plan untouched for a long stretch falls back to the tool trace', () => {
  const entries = [
    user('长任务'),
    ev('tool/call', {
      turn: 1, step: 1, callId: 't1', name: 'todo_write',
      arguments: JSON.stringify({ todos: [{ content: '旧计划', status: 'in_progress' }] }),
    }, 2000),
    ev('step/start', { turn: 1, step: 60 }, 3000),
    ev('tool/call', {
      turn: 1, step: 60, callId: 'c9', name: 'grep',
      arguments: '{"pattern":"deriveMind"}',
    }, 4000),
  ]
  const mind = deriveMind(entries, { now: 9000, running: true })
  assert.equal(mind.todoStale, true)
  assert.equal(mind.taskSource, 'trace')
  assert.equal(mind.tasks.length, 1)
  assert.equal(mind.tasks[0].title, '搜索内容 · deriveMind')
})

test('assistant tool-call plus tool/call is de-duplicated by call id', () => {
  const entries = [
    user('跑一下'),
    ev('assistant/message', {
      turn: 1, step: 2,
      message: {
        role: 'assistant',
        content: [{ type: 'tool-call', id: 'c3', name: 'bash', arguments: '{"command":"pwd"}' }],
      },
      usage: { outputTokens: 12 },
    }, 2500),
    ev('tool/call', { turn: 1, step: 2, callId: 'c3', name: 'bash', arguments: '{"command":"pwd"}' }, 2600),
    ev('tool/result', {
      turn: 1, step: 2,
      message: { role: 'tool', toolCallId: 'c3', isError: false, content: [{ type: 'text', text: '/workspace' }] },
    }, 3000),
  ]
  const mind = deriveMind(entries, { now: 6000, running: false })
  assert.equal(mind.tools.length, 1)
  assert.equal(mind.tools[0].status, 'done')
  assert.match(mind.tools[0].result, /workspace/)
  assert.equal(mind.tokens, 12)
})

test('turn, step and token totals come from the durable events', () => {
  const entries = [
    ev('turn/start', { turn: 3 }, 1000),
    user('继续', 1100),
    ev('step/start', { turn: 3, step: 4 }, 1200),
    ev('assistant/message', {
      turn: 3, step: 4,
      message: { role: 'assistant', content: [{ type: 'text', text: '完成了。' }] },
      usage: { outputTokens: 42 },
    }, 2000),
  ]
  const mind = deriveMind(entries, { now: 4000, running: false })
  assert.equal(mind.turn, 3)
  assert.equal(mind.step, 4)
  assert.equal(mind.tokens, 42)
  assert.equal(mind.phase, 'done')
  assert.equal(mind.answer, '完成了。')
})

test('emptyMind stays a valid idle snapshot', () => {
  const mind = emptyMind({ detail: '自定义' })
  assert.equal(mind.phase, 'idle')
  assert.equal(mind.detail, '自定义')
  assert.deepEqual(mind.tasks, [])
})
