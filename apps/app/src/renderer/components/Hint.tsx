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
          className="font-mono text-[9.5px] px-1 py-px rounded border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg text-warm-muted dark:text-dark-muted"
        >
          {k}
        </kbd>
      ))}
      <span>{label}</span>
    </span>
  )
}
