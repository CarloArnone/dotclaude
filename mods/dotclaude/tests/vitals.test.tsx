import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { burnPercent, parseCavemanMode } from '../hooks/features/vitals/readings'
import { channelSvg, VITALS_TRACE_MODE } from '../hooks/features/vitals/svg'
import { activityAt, autoGain, FIXED_GAIN, headFrames, normalize, revealFrames, sweep, sweepAhead, WINDOW_MS } from '../hooks/features/vitals/trace'
import { answerUi, paneProps, SURFACES, WORKSPACE } from './host'

// Every host call is answered from memory: no real git, files or commands are touched.
const HOME = '/tmp/hud-fixture'
const ROOT = '/Users/user/Projects/my-project'
const NOW = new Date(2026, 9, 7, 21, 14).getTime()
const START = { cwd: ROOT, surface: 'terminal', isInteractive: true } as const

function mockHost(on: On) {
  const ui = answerUi(on)
  mock.env(on, { HOME })
  const clock = mock.clock(on, { now: NOW })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.usage', () => ({
    value: { startedAt: NOW - 42 * 60_000, context: { window: 200_000, tokens: 124_000, percent: 62 }, rateLimits: [] },
  }))
  on('session.root', () => ({ value: ROOT }))
  on('session.model', () => ({ value: 'Opus 5.5' }))
  on('session.cwd', () => ({ value: ROOT }))
  on('fs.stat', (_$, e) => ({ deny: `ENOENT: ${e.path}` }))
  on('process.run', () => ({
    value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('tool.call', () => ({ result: 'ok' }))
  return { ui, clock }
}

// The channel traces among the desktop's Svgs (the banner and the dock's tiles are Svgs too).
const CHANNEL_ALT = /^(Activity|Context|Rate limit, 5h|Cost) /

function measureContext(percent: number) {
  return {
    context: { window: 200_000, tokens: percent * 2000, percent },
    rateLimits: [],
    changed: ['context' as const],
  }
}

describe('vitals rail', () => {
  test('draws every channel on the terminal and the desktop', async ($, on) => {
    mockHost(on)
    await $.session.start(START)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...WORKSPACE, surface })
      expect(await ui.find({ type: 'Text', text: 'my-project' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Activity' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '124k of 200k' })).toBeDefined()
      const traces = (await ui.findAll({ type: surface === 'terminal' ? 'Raster' : 'Svg' })).filter(
        trace => surface === 'terminal' || CHANNEL_ALT.test(String(trace.props.alt)),
      )
      // activity and context; rate and cost stay hidden while the host has no figure
      expect(traces).toHaveLength(2)
      await ui.unmount()
    }
  })

  test('raises the context alarm at 80% and Silence quiets it', async ($, on) => {
    mockHost(on)
    await $.session.start(START)
    await $.session.measure(measureContext(85))
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...WORKSPACE, surface })
      expect(await ui.find({ type: 'Text', text: 'Context critical' })).toBeDefined()
      expect((await ui.find({ type: 'Button', key: 'compact' }))?.props.variant).toBe('primary')
      if (surface === 'desktop') {
        const svgs = await ui.findAll({ type: 'Svg' })
        expect(svgs.some(svg => String(svg.props.source).includes('#ff5a5f'))).toBe(true)
      }
      await ui.unmount()
    }
    const ui = await $.ui.mount({ ...WORKSPACE, surface: 'terminal' })
    await ui.press({ key: 'silence' })
    expect(await ui.find({ type: 'Button', key: 'compact' })).toBeUndefined()
  })

  test('shows the 5h limit with its countdown and the real cost once reported', async ($, on) => {
    mockHost(on)
    await $.session.start(START)
    await $.session.measure({
      context: { window: 200_000, tokens: 124_000, percent: 62 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 46, resetsAt: new Date(NOW + 72 * 60_000).toISOString() },
        { kind: 'seven_day', percentUsed: 23 },
      ],
      cost: { usd: 7.4 },
      changed: ['rateLimits', 'cost'],
    })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...WORKSPACE, surface })
      expect(await ui.find({ type: 'Text', text: 'Rate limit, 5h' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'resets in 1:12:00' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '7 days 23%' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Cost' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('stays quiet below 80%', async ($, on) => {
    mockHost(on)
    await $.session.start(START)
    await $.session.measure(measureContext(79))
    const ui = await $.ui.mount({ ...WORKSPACE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: 'Context critical' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'compact' })).toBeUndefined()
  })

  test('the gate chip follows the gate: locked, then open once approved', async ($, on) => {
    mockHost(on)
    await $.session.start(START)
    const ui = await $.ui.mount({ ...WORKSPACE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: 'Edits locked' })).toBeDefined()
    await $.command.run({ command: 'gate', args: 'approve' })
    expect(await ui.find({ type: 'Text', text: 'Edits open' })).toBeDefined()
  })
})

describe('traces take the rows they can', () => {
  test('a taller pane gives each trace more rows on the terminal and more pixels on the desktop', async ($, on) => {
    mockHost(on)
    await $.session.start(START)
    const sizes = async (bodyRows: number) => {
      const terminal = await $.ui.mount({ ...WORKSPACE, props: paneProps(60, bodyRows), surface: 'terminal' })
      const rows = (await terminal.findAll({ type: 'Raster' })).map(raster => Number(raster.props.rows))
      await terminal.unmount()
      const desktop = await $.ui.mount({ ...WORKSPACE, props: paneProps(60, bodyRows), surface: 'desktop' })
      const heights = (await desktop.findAll({ type: 'Svg' }))
        .filter(svg => CHANNEL_ALT.test(String(svg.props.alt)))
        .map(svg => Number(svg.props.height))
      await desktop.unmount()
      return { rows, heights }
    }
    const short = await sizes(30)
    const tall = await sizes(70)
    expect(short.rows).toHaveLength(2)
    expect(tall.rows[0]!).toBeGreaterThan(short.rows[0]!)
    expect(tall.heights[0]!).toBeGreaterThan(short.heights[0]!)
  })
})

describe('desktop trace', () => {
  test('the switch defaults to the SMIL sweep', () => {
    expect(VITALS_TRACE_MODE).toBe('smil')
  })

  test('animates its own sweep: the head glides and each segment is revealed by an animated clip', () => {
    const svg = channelSvg(
      {
        id: 'activity',
        color: '#3ddc97',
        value: '3',
        unit: '',
        isAlarm: false,
        at: WINDOW_MS * 10 + 20_000,
        sampleMs: 1000 / 30,
        valueAt: t => activityAt(t, [WINDOW_MS * 10 + 19_500]),
        isFixedGain: true,
      },
      { width: 300, height: 60 },
    )
    expect(svg).toContain('<animateTransform attributeName="transform" type="translate"')
    expect(svg).toContain('<clipPath id="activity-clip0">')
    expect(svg).toContain('<animate attributeName="width"')
    expect(svg).toContain('dur="8s" fill="freeze"')
    expect(svg).toContain('height="60"')
    expect(svg.length).toBeLessThan(131_072)
  })

  test('the desktop drawing ignores the 1 s tick and redraws on the slow tick, from the clock', async ($, on) => {
    const { clock } = mockHost(on)
    await $.session.start(START)
    const ui = await $.ui.mount({ ...WORKSPACE, surface: 'desktop' })
    const source = async () =>
      String((await ui.findAll({ type: 'Svg' })).find(svg => CHANNEL_ALT.test(String(svg.props.alt)))?.props.source)
    const first = await source()
    await clock.advance(1000)
    expect(await source()).toBe(first)
    await clock.advance(4000)
    const redrawn = await source()
    expect(redrawn).not.toBe(first)
    // The sweep starts where the clock says the head is, so a redraw never jumps back.
    expect(redrawn).toContain(`<g transform="translate(${headX(NOW + 5000, 624 - 96)},0)">`)
    await $.tool.call({ tool: 'Bash', tool_use_id: 't1', command: 'ls' })
    expect(await source()).not.toBe(redrawn)
  })

  test('a flat channel still draws its line, through a filter in user space', () => {
    const svg = channelSvg(
      { id: 'context', color: '#4cc9f0', value: '62', unit: '%', isAlarm: false, at: NOW, sampleMs: 1000, valueAt: () => 0.62, isFixedGain: false },
      { width: 300, height: 80 },
    )
    expect(svg).toContain('<filter id="context-glow" filterUnits="userSpaceOnUse" x="-10" y="-10" width="320" height="100">')
    expect(svg).toMatch(/<path d="M[\d.]+ 40\.0 L[\d.]+ 40\.0" fill="none" stroke="url\(#context-ink\d\)"[^>]*filter="url\(#context-glow\)"\/>/)
    expect(svg).toContain('stop-opacity="0.060"')
  })

  test('the head starts at the clock\'s place in the sweep', () => {
    const at = WINDOW_MS * 7 + 15_000
    const svg = channelSvg(
      { id: 'activity', color: '#3ddc97', value: '0', unit: '', isAlarm: false, at, sampleMs: 1000 / 30, valueAt: () => 0.3, isFixedGain: true },
      { width: 300, height: 60 },
    )
    expect(svg).toContain(`<g transform="translate(${headX(at, 300 - 96)},0)">`)
  })
})

/** Where the head is drawn at `at` across a trace `traceWidth` wide, as the SVG writes it. */
function headX(at: number, traceWidth: number): string {
  return (((at % WINDOW_MS) / WINDOW_MS) * traceWidth).toFixed(1)
}

describe('readings', () => {
  test('burn is the mean rise per measurement, as statusline.sh has it', () => {
    expect(burnPercent([40, 44, 48, 52])).toBe(4)
    expect(burnPercent([50, 40])).toBe(0)
    expect(burnPercent([50])).toBe(0)
  })

  test('caveman modes follow statusline.sh', () => {
    expect(parseCavemanMode('ULTRA\n')).toBe('ultra')
    expect(parseCavemanMode('nonsense')).toBeNull()
  })

  test('a tool call draws one beat whose R wave peaks above .8', () => {
    const call = 1000
    // a tenth of a sample apart, so the narrow R wave is not stepped over
    const peak = Math.max(...Array.from({ length: 300 }, (_, i) => activityAt(call + i * (100 / 30), [call])))
    expect(peak).toBeGreaterThan(0.8)
    expect(activityAt(call - 10, [call])).toBe(0.3)
  })

  test('the sweep leaves an erase gap ahead of the head', () => {
    const now = WINDOW_MS * 10 + 30_000
    const drawn = sweep(now, 1000, () => 0.5)
    expect(drawn.headX).toBe(0.5)
    const xs = drawn.runs.flat().map(point => point.x)
    expect(xs.some(x => x > 0.5 && x < 0.55)).toBe(false)
  })

  test('auto-gain never spans less than .04, and centres a flat line', () => {
    const drawn = sweep(WINDOW_MS, 1000, () => 0.62)
    const gain = autoGain(drawn.runs)
    expect(gain.hi - gain.lo).toBeGreaterThan(0.0459)
    expect(gain.hi - gain.lo).toBeLessThan(0.0461)
    expect(Math.abs((gain.lo + gain.hi) / 2 - 0.62)).toBeLessThan(1e-9)
  })

  test('auto-gain spreads a changing signal over most of the height', () => {
    const gain = autoGain([[{ value: 0.2 }, { value: 0.6 }]])
    expect(0.4 / (gain.hi - gain.lo)).toBeGreaterThan(0.85)
  })

  test('an idle heartbeat sits in the middle and a beat reaches the top', () => {
    expect(normalize(activityAt(0, []), FIXED_GAIN)).toBe(0.5)
    const peak = Math.max(...Array.from({ length: 300 }, (_, i) => activityAt(1000 + i * (100 / 30), [1000])))
    expect(normalize(peak, FIXED_GAIN)).toBeGreaterThan(0.9)
  })
})

describe('animated sweep', () => {
  const now = WINDOW_MS * 10 + 57_000
  const ahead = 8000

  test('splits where the head wraps and reaches past now by the animation', () => {
    const segments = sweepAhead(now, 1000, () => 0.5, ahead)
    expect(segments).toHaveLength(2)
    expect(segments[0]!.to).toBe(WINDOW_MS * 11)
    expect(segments[1]!.to).toBe(now + ahead)
  })

  test('the head uncovers the newest segment and the erase gap takes the oldest', () => {
    const [older, newer] = sweepAhead(now, 1000, () => 0.5, ahead)
    const shown = revealFrames(newer!, now, ahead)
    expect(shown[0]!.width).toBe(0)
    // At the end the head has written the 5 s from the wrap to now + 8 s.
    expect(Math.abs(shown.at(-1)!.width - 5000 / WINDOW_MS)).toBeLessThan(1e-9)
    const fading = revealFrames(older!, now, ahead)
    expect(fading.at(-1)!.x).toBeGreaterThan(fading[0]!.x)
  })

  test('the head jumps from the right edge to the left at the wrap, never sliding back', () => {
    const frames = headFrames(now, ahead, 1000, () => 0.5)
    const wrap = frames.findIndex(frame => frame.x === 1)
    expect(wrap).toBeGreaterThan(0)
    expect(frames[wrap + 1]).toEqual({ at: 3000, x: 0, value: 0.5 })
  })
})
