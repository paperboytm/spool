export type ClassValue =
  | string
  | number
  | false
  | null
  | undefined
  | ClassValue[]
  | { readonly [className: string]: unknown }

function appendClassNames(value: ClassValue, classNames: string[]): void {
  if (!value) return

  if (typeof value === 'string' || typeof value === 'number') {
    classNames.push(String(value))
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) appendClassNames(item, classNames)
    return
  }

  for (const [className, enabled] of Object.entries(value)) {
    if (enabled) classNames.push(className)
  }
}

/** Compose compact conditional class lists without a runtime dependency. */
export function cx(...values: ClassValue[]): string {
  const classNames: string[] = []
  for (const value of values) appendClassNames(value, classNames)
  return classNames.join(' ')
}
