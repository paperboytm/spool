export function fallbackDisplayName(input: string): string {
  if (input === '/') return '(root)'
  let end = input.length
  while (end > 0 && input[end - 1] === '/') end -= 1
  const trimmed = input.slice(0, end)
  const parts = trimmed.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? trimmed
}
