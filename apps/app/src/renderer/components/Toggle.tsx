type Props = {
  checked: boolean
  onChange: (next: boolean) => void
  ariaLabel: string
  testId?: string
}

export default function Toggle({ checked, onChange, ariaLabel, testId }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className={`relative h-[18px] w-8 flex-none rounded-full transition-colors focus:outline-none ${
        checked ? 'bg-accent dark:bg-accent-dark' : 'bg-warm-border dark:bg-dark-border'
      }`}
    >
      <span
        aria-hidden
        className={`absolute top-[2px] block h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-all ${
          checked ? 'left-[16px]' : 'left-[2px]'
        }`}
      />
    </button>
  )
}
