import type { Readable, Writable } from 'node:stream'

import * as clack from '@clack/prompts'
import type { Option as ClackOption } from '@clack/prompts'

export interface CliSelectOption<Value extends string> {
  value: Value
  label: string
  hint?: string
}

export interface CliChoicePage<Value extends string> {
  choices: CliSelectOption<Value>[]
  hasMore: boolean
}

export interface CliSpinner {
  start(message?: string): void
  message(message?: string): void
  stop(message?: string): void
  error(message?: string): void
  cancel(message?: string): void
}

/** Small command-facing surface over Clack. Keeping the adapter here makes
 * prompts, mutations, and progress consistent while command handlers remain
 * injectable in tests. Read-only tables and `--json` output intentionally stay
 * plain so they remain pipe-friendly. */
export interface CliUi {
  readonly interactive: boolean
  intro(message: string): void
  note(message: string, title?: string): void
  info(message: string): void
  step(message: string): void
  success(message: string): void
  warn(message: string): void
  error(message: string): void
  outro(message: string): void
  cancel(message: string): void
  confirm(message: string, initialValue?: boolean): Promise<boolean | null>
  select<Value extends string>(options: {
    message: string
    choices: CliSelectOption<Value>[]
    initialValue?: Value
  }): Promise<Value | null>
  autocomplete<Value extends string>(options: {
    message: string
    choices: CliSelectOption<Value>[]
    loadMore?: () => CliChoicePage<Value>
    placeholder?: string
    maxItems?: number
  }): Promise<Value | null>
  spinner(): CliSpinner
}

export interface ClackUiOptions {
  input?: Readable
  output?: Writable
  errorOutput?: Writable
  interactive?: boolean
}

interface ClackAutocompleteState<Option> {
  readonly cursor: number
  readonly userInput: string
  filteredOptions: Option[]
}

export function createClackUi(options: ClackUiOptions = {}): CliUi {
  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout
  const errorOutput = options.errorOutput ?? process.stderr
  const common = { input, output }
  const interactive =
    options.interactive ??
    (Boolean((input as NodeJS.ReadStream).isTTY) &&
      Boolean((output as NodeJS.WriteStream).isTTY) &&
      !clack.isCI())

  if (!interactive) return createStreamTextUi(output, errorOutput)

  return {
    interactive,
    intro: (message) => clack.intro(message, common),
    note: (message, title) => clack.note(message, title, common),
    info: (message) => clack.log.info(message, common),
    step: (message) => clack.log.step(message, common),
    success: (message) => clack.log.success(message, common),
    warn: (message) => clack.log.warn(message, common),
    error: (message) => clack.log.error(message, common),
    outro: (message) => clack.outro(message, common),
    cancel: (message) => clack.cancel(message, common),
    confirm: async (message, initialValue = true) => {
      if (!interactive) return null
      const result = await clack.confirm({ message, initialValue, ...common })
      return clack.isCancel(result) ? null : result
    },
    select: async ({ message, choices, initialValue }) => {
      if (!interactive) return null
      // Clack's conditional Option<T> cannot prove a generic string union is
      // primitive, although this adapter constrains every value to string.
      const clackOptions = toClackOptions(choices)
      const result = await clack.select({
        message,
        options: clackOptions,
        ...(initialValue === undefined ? {} : { initialValue }),
        ...common,
      })
      return clack.isCancel(result) ? null : result
    },
    autocomplete: async ({ message, choices, loadMore, placeholder, maxItems }) => {
      if (!interactive) return null
      type Value = (typeof choices)[number]['value']
      type Option = ClackOption<Value>
      let clackOptions = toClackOptions(choices)
      let hasMore = loadMore !== undefined
      let lastSearch = ''

      const appendPage = (): void => {
        if (!loadMore || !hasMore) return
        const page = loadMore()
        clackOptions = [...clackOptions, ...toClackOptions(page.choices)]
        hasMore = page.hasMore
      }
      const optionSource = loadMore
        ? function (this: ClackAutocompleteState<Option>): Option[] {
            const search = this.userInput
            const matchingOptions = (): Option[] =>
              clackOptions.filter((option) => autocompleteMatches(search, option))
            let filtered = matchingOptions()
            const searchChanged = search !== lastSearch
            lastSearch = search

            if (searchChanged && search !== '') {
              while (hasMore && filtered.length < (maxItems ?? 10)) {
                appendPage()
                filtered = matchingOptions()
              }
            } else if (
              hasMore &&
              filtered.length > 0 &&
              this.cursor >= Math.max(filtered.length - 2, 0)
            ) {
              appendPage()
              filtered = matchingOptions()
            }

            // Clack's documented dynamic-options getter is bound to the
            // prompt. It does not refilter options appended during render, so
            // keep its public filtered view aligned with the returned list.
            this.filteredOptions = filtered
            return clackOptions
          }
        : clackOptions

      const result = await clack.autocomplete<Value>({
        message,
        options: optionSource,
        ...(placeholder === undefined ? {} : { placeholder }),
        ...(maxItems === undefined ? {} : { maxItems }),
        ...common,
      })
      return clack.isCancel(result) ? null : result
    },
    spinner: () => clack.spinner(common),
  }
}

function toClackOptions<Value extends string>(
  choices: CliSelectOption<Value>[],
): ClackOption<Value>[] {
  return choices.map(({ value, label, hint }) => ({
    value,
    label,
    ...(hint === undefined ? {} : { hint }),
  })) as ClackOption<Value>[]
}

function autocompleteMatches<Value extends string>(
  search: string,
  option: ClackOption<Value>,
): boolean {
  if (search === '') return true
  const needle = search.toLowerCase()
  return [option.label, option.hint, option.value].some((part) =>
    String(part ?? '')
      .toLowerCase()
      .includes(needle),
  )
}

/** Non-interactive adapter for exported command handlers and unit tests.
 * Real Commander actions explicitly inject `createClackUi()`. */
export function createTextUi(
  log: (message: string) => void = console.log,
  error: (message: string) => void = console.error,
): CliUi {
  return {
    interactive: false,
    intro: () => {},
    note: (message, title) => log(title ? `${title}: ${message}` : message),
    info: log,
    step: log,
    success: log,
    warn: log,
    error,
    outro: log,
    cancel: error,
    confirm: async () => null,
    select: async () => null,
    autocomplete: async () => null,
    spinner: () => textSpinner(log, error),
  }
}

function createStreamTextUi(output: Writable, errorOutput: Writable): CliUi {
  const write = (stream: Writable) => (message: string) => {
    stream.write(`${message}\n`)
  }
  const ui = createTextUi(write(output), write(errorOutput))
  return {
    ...ui,
    intro: write(output),
  }
}

function textSpinner(log: (message: string) => void, error: (message: string) => void): CliSpinner {
  return {
    start: (message) => {
      if (message) log(message)
    },
    message: () => {},
    stop: (message) => {
      if (message) log(message)
    },
    error: (message) => {
      if (message) error(message)
    },
    cancel: (message) => {
      if (message) error(message)
    },
  }
}
