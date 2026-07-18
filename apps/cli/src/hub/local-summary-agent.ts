import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'

import { cachedResolveAsync } from '@spool-lab/core'

export type LocalSummaryAgentId = 'claude' | 'codex'

export interface LocalSummaryAgent {
  id: LocalSummaryAgentId
  name: string
  path: string
}

const AGENTS: ReadonlyArray<{ id: LocalSummaryAgentId; name: string; bin: string }> = [
  { id: 'claude', name: 'Claude Code', bin: 'claude' },
  { id: 'codex', name: 'Codex CLI', bin: 'codex' },
]

export async function detectLocalSummaryAgents(
  resolveBinary: (name: string) => Promise<string | null> = cachedResolveAsync,
): Promise<LocalSummaryAgent[]> {
  const paths = await Promise.all(AGENTS.map((agent) => resolveBinary(agent.bin)))
  return AGENTS.flatMap((agent, index) => {
    const path = paths[index]
    return path ? [{ id: agent.id, name: agent.name, path }] : []
  })
}

export interface RunLocalSummaryAgentOptions {
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  signal?: AbortSignal
  spawnProcess?: typeof spawn
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
const MAX_SUMMARY_BYTES = 64 * 1024
const MAX_CAPTURE_BYTES = 1024 * 1024

/** Invoke the user's installed Agent CLI non-interactively. Both adapters read
 * the bounded prompt from stdin, run ephemerally in an empty directory, and
 * retain the Agent's own model/provider/auth configuration. */
export async function runLocalSummaryAgent(
  agent: LocalSummaryAgent,
  prompt: string,
  options: RunLocalSummaryAgentOptions = {},
): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), 'spool-summary-agent-'))
  const outputPath = join(directory, 'summary.md')
  const args = invocationArgs(agent.id, outputPath)

  try {
    const result = await runProcess(agent.path, args, prompt, {
      cwd: directory,
      env: options.env ?? process.env,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      spawnProcess: options.spawnProcess ?? spawn,
    })
    const summary =
      agent.id === 'codex' ? readFileSync(outputPath, 'utf8').trim() : result.stdout.trim()
    if (!summary) throw new Error(`${agent.name} returned an empty Summary.`)
    if (Buffer.byteLength(summary, 'utf8') > MAX_SUMMARY_BYTES) {
      throw new Error(`${agent.name} returned a Summary larger than 64 KiB.`)
    }
    return summary
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

export function invocationArgs(agentId: LocalSummaryAgentId, outputPath: string): string[] {
  if (agentId === 'claude') {
    return [
      '--print',
      '--output-format',
      'text',
      '--permission-mode',
      'dontAsk',
      '--tools',
      '',
      '--no-session-persistence',
      '--safe-mode',
    ]
  }
  return [
    'exec',
    '--ephemeral',
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--color',
    'never',
    '--output-last-message',
    outputPath,
    '-',
  ]
}

interface ProcessOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  signal?: AbortSignal
  spawnProcess: typeof spawn
}

function runProcess(
  command: string,
  args: string[],
  input: string,
  options: ProcessOptions,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer: NodeJS.Timeout | undefined
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    const child = options.spawnProcess(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams

    const finish = (result: { stdout: string; stderr: string } | Error) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      if (result instanceof Error) reject(result)
      else resolve(result)
    }
    const abort = () => {
      child.kill('SIGTERM')
      finish(new Error('Summary generation cancelled.'))
    }
    const append = (
      current: Buffer<ArrayBufferLike>,
      chunk: Buffer<ArrayBufferLike>,
    ): Buffer<ArrayBufferLike> => {
      const next = Buffer.concat([current, chunk])
      if (next.byteLength > MAX_CAPTURE_BYTES) {
        child.kill('SIGTERM')
        finish(new Error('Agent output exceeded the 1 MiB capture limit.'))
      }
      return next
    }

    child.stdout.on('data', (chunk: Buffer<ArrayBufferLike>) => {
      stdout = append(stdout, chunk)
    })
    child.stderr.on('data', (chunk: Buffer<ArrayBufferLike>) => {
      stderr = append(stderr, chunk)
    })
    child.on('error', (cause) => finish(cause))
    child.on('close', (code, signal) => {
      const stdoutText = stdout.toString('utf8')
      const stderrText = stderr.toString('utf8')
      if (code === 0) {
        finish({ stdout: stdoutText, stderr: stderrText })
        return
      }
      const detail = stripVTControlCharacters(stderrText).trim().slice(-2_000)
      finish(
        new Error(
          `Agent exited ${signal ? `after ${signal}` : `with status ${code ?? 'unknown'}`}${detail ? `: ${detail}` : '.'}`,
        ),
      )
    })

    timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish(new Error(`Agent timed out after ${Math.ceil(options.timeoutMs / 60_000)} minutes.`))
    }, options.timeoutMs)
    timer.unref()

    if (options.signal?.aborted) {
      abort()
      return
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    child.stdin.end(input, 'utf8')
  })
}
