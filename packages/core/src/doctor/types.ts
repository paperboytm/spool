export type Severity = 'ok' | 'warn' | 'error'

export type Category = 'env' | 'versions' | 'db' | 'config' | 'native' | 'daemon'

export interface FixDescriptor {
  description: string
  destructive: boolean
  apply: () => Promise<FixResult> | FixResult
}

export interface FixResult {
  ok: boolean
  message: string
}

export interface CheckResult {
  id: string
  category: Category
  title: string
  severity: Severity
  message: string
  details?: Record<string, unknown>
  fix?: FixDescriptor
}

export interface Check {
  id: string
  category: Category
  title: string
  run: () => Promise<CheckResult> | CheckResult
}
