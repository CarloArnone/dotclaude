import { describe, expect, test } from 'claude-code/testing'

import {
  parseBattery,
  parseContainers,
  parseCpu,
  parseDisk,
  parseMemory,
  parseProcesses,
  parseThermal,
} from '../hooks/features/mac/parse'
import { blockSparkline, svgSparkline } from '../hooks/features/mac/sparkline'
import { DF, DOCKER_PS, MEMORY_PRESSURE, PMSET_BATT, PMSET_BATT_DESKTOP, PMSET_THERM, PS, TOP } from './mac-fixtures'

describe('parsers', () => {
  test('cpu reads the second top sample, not the since-boot one', () => {
    expect(Math.round((parseCpu(TOP) ?? 0) * 100) / 100).toBe(30)
    expect(parseCpu('garbage')).toBeUndefined()
  })

  test('memory is 100 minus the free percentage', () => {
    expect(parseMemory(MEMORY_PRESSURE)).toBe(20)
    expect(parseMemory('')).toBeUndefined()
  })

  test('disk is the capacity column of /', () => {
    expect(parseDisk(DF)).toBe(40)
    expect(parseDisk('Filesystem\n')).toBeUndefined()
  })

  test('battery reads percent and charging; a desktop has none', () => {
    expect(parseBattery(PMSET_BATT)).toEqual({ percent: 100, isCharging: true })
    const discharging = PMSET_BATT.replace('100%; finishing charge', '54%; discharging')
    expect(parseBattery(discharging)).toEqual({ percent: 54, isCharging: false })
    expect(parseBattery(PMSET_BATT_DESKTOP)).toBeUndefined()
  })

  test('thermal is nominal until macOS records a warning', () => {
    expect(parseThermal(PMSET_THERM)).toBe('nominal')
    expect(parseThermal('Thermal warning level set to 5.')).toBe('warning level 5')
    expect(parseThermal('')).toBeUndefined()
  })

  test('processes keep names with spaces, top 3 by cpu', () => {
    expect(parseProcesses(PS, 3)).toEqual([
      { pid: 1001, cpu: 20, name: 'Code Helper' },
      { pid: 1002, cpu: 15, name: 'WindowServer' },
      { pid: 1003, cpu: 8, name: 'node' },
    ])
    expect(parseProcesses('  PID  %CPU COMM\n', 3)).toBeUndefined()
  })

  test('containers split name and status on the tab', () => {
    expect(parseContainers(DOCKER_PS)).toEqual([
      { name: 'web-dev', status: 'Up 3 hours' },
      { name: 'postgres', status: 'Up 26 hours (healthy)' },
    ])
    expect(parseContainers('')).toEqual([])
  })
})

describe('sparklines', () => {
  test('blocks span the fixed 0-100 scale and keep the newest values', () => {
    expect(blockSparkline([0, 50, 100], 10)).toBe('▁▅█')
    expect(blockSparkline([0, 50, 100], 2)).toBe('▅█')
    expect(blockSparkline([10], 0)).toBe('')
  })

  test('svg is one path in the meter colour', () => {
    const svg = svgSparkline([10, 90, 40], '#3ddc97', { width: 240, height: 24 })
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 240 24"/)
    expect(svg).toContain('stroke="#3ddc97"')
    expect(svg).toMatch(/<path d="M0 [\d.]+ Q/)
  })
})
