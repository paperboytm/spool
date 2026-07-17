export function commonLabel(labels: string[]): string {
  if (labels.length === 0) return ''
  if (labels.length === 1) return labels[0]!
  // Find longest common prefix of words
  const words = labels.map(l => l.split(/\s+/))
  let common: string[] = []
  for (let i = 0; i < words[0]!.length; i++) {
    const w = words[0]![i]!
    if (words.every(arr => arr[i] === w)) common.push(w)
    else break
  }
  return common.length > 0 ? common.join(' ').trim() : labels[0]!
}
