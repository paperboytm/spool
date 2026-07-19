import { getAbi } from 'node-abi'

export function electronModulesAbi({ result, electronVersion }) {
  const modules = result.stdout?.trim()
  if (result.status === 0 && modules && /^\d+$/.test(modules)) {
    return modules
  }

  return getAbi(electronVersion, 'electron')
}
