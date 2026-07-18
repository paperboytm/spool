type Props = {
  keys: string[]
  label: string
}

/** Single keyboard-hint chip used in the footer of command-palette-style surfaces. */
export default function Hint({ keys, label }: Props) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((k, i) => (
        <kbd
          key={i}
          className="border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg text-warm-muted dark:text-dark-muted rounded border px-1 py-px font-mono text-[9.5px]"
        >
          {k}
        </kbd>
      ))}
      <span>{label}</span>
    </span>
  )
}
