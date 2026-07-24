import { LoaderCircle, Menu, Search, X } from 'lucide-react'
import {
  createElement,
  useEffect,
  useId,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ChangeEventHandler,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react'

import { cx } from './cx.js'

export type ButtonVariant = 'ghost' | 'outline' | 'accent' | 'danger'
export type ControlSize = 'sm' | 'md'
export type ButtonSize = ControlSize | 'lg'

type ButtonVisualProps = {
  variant?: ButtonVariant
  size?: ButtonSize
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  ButtonVisualProps & {
    loading?: boolean
    loadingLabel?: ReactNode
  }

export function Button({
  'aria-busy': ariaBusy,
  children,
  className,
  disabled,
  loading = false,
  loadingLabel = 'Loading…',
  variant = 'ghost',
  size = 'md',
  type,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type ?? 'button'}
      className={cx('sp-button', `sp-button--${variant}`, `sp-button--${size}`, className)}
      aria-busy={loading ? true : ariaBusy}
      disabled={disabled || loading}
      data-variant={variant}
      data-size={size}
      data-state={loading ? 'loading' : undefined}
    >
      {loading ? (
        <>
          <LoaderCircle className="sp-button__spinner" aria-hidden="true" />
          <span>{loadingLabel}</span>
        </>
      ) : (
        children
      )}
    </button>
  )
}

export type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & ButtonVisualProps

export function ButtonLink({
  className,
  variant = 'ghost',
  size = 'md',
  ...props
}: ButtonLinkProps) {
  return (
    <a
      {...props}
      className={cx('sp-button', `sp-button--${variant}`, `sp-button--${size}`, className)}
      data-variant={variant}
      data-size={size}
    />
  )
}

type AccessibleLabel = {
  'aria-label': string
}

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> &
  AccessibleLabel & {
    size?: ControlSize
  }

export function IconButton({ className, size = 'sm', type, ...props }: IconButtonProps) {
  return (
    <button
      {...props}
      type={type ?? 'button'}
      className={cx('sp-icon-button', `sp-icon-button--${size}`, className)}
      data-size={size}
    />
  )
}

export type IconLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'aria-label'> &
  AccessibleLabel & {
    size?: ControlSize
  }

export function IconLink({ className, size = 'sm', ...props }: IconLinkProps) {
  return (
    <a
      {...props}
      className={cx('sp-icon-button', `sp-icon-button--${size}`, className)}
      data-size={size}
    />
  )
}

export type MobileMenuProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  children: ReactNode
  triggerLabel?: string
  closeLabel?: string
}

export function MobileMenu({
  children,
  className,
  triggerLabel = 'Open menu',
  closeLabel = 'Close menu',
  ...props
}: MobileMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const id = useId().replace(/:/g, '')
  const triggerId = `sp-mobile-menu-trigger-${id}`
  const panelId = `sp-mobile-menu-panel-${id}`

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      const root = rootRef.current
      if (root && event.target && !root.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div
      {...props}
      ref={rootRef}
      className={cx('sp-mobile-menu', className)}
      data-state={open ? 'open' : 'closed'}
    >
      <button
        ref={triggerRef}
        id={triggerId}
        className="sp-mobile-menu__trigger"
        type="button"
        aria-label={open ? closeLabel : triggerLabel}
        aria-controls={panelId}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
      </button>
      <div
        id={panelId}
        className="sp-mobile-menu__panel"
        data-state={open ? 'open' : 'closed'}
        aria-labelledby={triggerId}
        hidden={!open}
        onClickCapture={(event) => {
          const target = event.target
          if (target instanceof Element && target.closest('a,button')) {
            setOpen(false)
          }
        }}
      >
        {children}
      </div>
    </div>
  )
}

export type SearchFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'className' | 'onChange' | 'size' | 'value'
> & {
  className?: string
  value: string
  onChange: ChangeEventHandler<HTMLInputElement>
  onClear?: () => void
  clearLabel?: string
}

export function SearchField({
  className,
  value,
  onChange,
  onClear,
  clearLabel = 'Clear search',
  type,
  ...props
}: SearchFieldProps) {
  return (
    <div
      className={cx('sp-search-field', className)}
      data-has-value={value.length > 0 || undefined}
    >
      <Search className="sp-search-field__icon" aria-hidden="true" />
      <input {...props} type={type ?? 'search'} value={value} onChange={onChange} />
      {onClear && value.length > 0 ? (
        <button
          className="sp-search-field__clear"
          type="button"
          aria-label={clearLabel}
          onClick={onClear}
        >
          <X aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}

export type TabItem = {
  value: string
  label: ReactNode
  id?: string
  disabled?: boolean
  ariaControls?: string
}

export type TabsProps = Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> & {
  'aria-label': string
  items: readonly TabItem[]
  value: string
  onValueChange: (value: string) => void
}

export function Tabs({ className, items, value, onValueChange, onKeyDown, ...props }: TabsProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return

    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'),
    )
    const currentIndex = tabs.indexOf(event.target as HTMLButtonElement)
    if (currentIndex < 0 || tabs.length === 0) return

    event.preventDefault()
    let nextIndex: number
    if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = tabs.length - 1
    else if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length
    else nextIndex = (currentIndex - 1 + tabs.length) % tabs.length

    const nextTab = tabs[nextIndex]
    nextTab?.focus()
    if (nextTab?.dataset.value) onValueChange(nextTab.dataset.value)
  }

  return (
    <div {...props} className={cx('sp-tabs', className)} role="tablist" onKeyDown={handleKeyDown}>
      {items.map((item) => {
        const selected = item.value === value
        return (
          <button
            className="sp-tabs__tab"
            type="button"
            role="tab"
            key={item.value}
            id={item.id}
            data-value={item.value}
            aria-controls={item.ariaControls}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onValueChange(item.value)}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

type NavItemVisualProps = {
  active?: boolean
  leading?: ReactNode
  trailing?: ReactNode
}

type NavItemLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> &
  NavItemVisualProps & {
    href: string
  }

type NavItemButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  NavItemVisualProps & {
    href?: never
  }

export type NavItemProps = NavItemLinkProps | NavItemButtonProps

export function NavItem(props: NavItemProps) {
  const content = (leading: ReactNode, children: ReactNode, trailing: ReactNode) => (
    <>
      {leading ? <span className="sp-nav-item__leading">{leading}</span> : null}
      <span className="sp-nav-item__label">{children}</span>
      {trailing ? <span className="sp-nav-item__trailing">{trailing}</span> : null}
    </>
  )

  if ('href' in props && props.href !== undefined) {
    const { active = false, children, className, leading, trailing, ...linkProps } = props
    return (
      <a
        {...linkProps}
        className={cx('sp-nav-item', className)}
        aria-current={active ? 'page' : undefined}
        data-active={active || undefined}
      >
        {content(leading, children, trailing)}
      </a>
    )
  }

  const { active = false, children, className, leading, trailing, type, ...buttonProps } = props
  return (
    <button
      {...buttonProps}
      type={type ?? 'button'}
      className={cx('sp-nav-item', className)}
      aria-current={active ? 'page' : undefined}
      data-active={active || undefined}
    >
      {content(leading, children, trailing)}
    </button>
  )
}

export type BadgeVariant =
  | 'neutral'
  | 'accent'
  | 'source-claude'
  | 'source-codex'
  | 'source-gemini'
  | 'source-opencode'
  | 'source-pi'
  | 'success'
  | 'warning'
  | 'error'

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant
}

export function Badge({ className, variant = 'neutral', ...props }: BadgeProps) {
  return (
    <span
      {...props}
      className={cx('sp-badge', `sp-badge--${variant}`, className)}
      data-variant={variant}
    />
  )
}

export type AvatarSize = 'sm' | 'md' | 'lg'

export type AvatarProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  src?: string | null
  name?: string | null
  alt?: string
  size?: AvatarSize
}

function initialsOf(name: string | null | undefined): string {
  if (!name?.trim()) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]?.slice(0, 1).toUpperCase() ?? '?'
  return `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}`.toUpperCase() || '?'
}

export function Avatar({ src, name, alt = '', size = 'md', className, ...props }: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const showImage = Boolean(src && failedSrc !== src)

  return (
    <span {...props} className={cx('sp-avatar', `sp-avatar--${size}`, className)} data-size={size}>
      {showImage && src ? (
        <img src={src} alt={alt} referrerPolicy="no-referrer" onError={() => setFailedSrc(src)} />
      ) : (
        <span
          className="sp-avatar__fallback"
          role={alt ? 'img' : undefined}
          aria-label={alt || undefined}
          aria-hidden={alt ? undefined : true}
        >
          {initialsOf(name)}
        </span>
      )}
    </span>
  )
}

export type SectionLabelProps = HTMLAttributes<HTMLDivElement> & {
  count?: ReactNode
  action?: ReactNode
}

export function SectionLabel({ children, className, count, action, ...props }: SectionLabelProps) {
  return (
    <div {...props} className={cx('sp-section-label', className)}>
      <span className="sp-section-label__text">{children}</span>
      {count !== undefined ? <span className="sp-section-label__count">{count}</span> : null}
      {action ? <span className="sp-section-label__action">{action}</span> : null}
    </div>
  )
}

export type ListRowProps = Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  as?: 'article' | 'div' | 'li'
  leading?: ReactNode
  attribution?: ReactNode
  title: ReactNode
  summary?: ReactNode
  metadata?: ReactNode
  lineage?: ReactNode
  trailing?: ReactNode
}

export function ListRow({
  as = 'article',
  className,
  leading,
  attribution,
  title,
  summary,
  metadata,
  lineage,
  trailing,
  ...props
}: ListRowProps) {
  return createElement(
    as,
    {
      ...props,
      className: cx('sp-list-row', className),
      'data-leading': leading ? true : undefined,
      'data-trailing': trailing ? true : undefined,
    },
    leading ? createElement('div', { className: 'sp-list-row__leading' }, leading) : null,
    createElement(
      'div',
      { className: 'sp-list-row__content' },
      attribution
        ? createElement('div', { className: 'sp-list-row__attribution' }, attribution)
        : null,
      createElement('div', { className: 'sp-list-row__title' }, title),
      summary ? createElement('div', { className: 'sp-list-row__summary' }, summary) : null,
      metadata ? createElement('div', { className: 'sp-list-row__metadata' }, metadata) : null,
      lineage ? createElement('div', { className: 'sp-list-row__lineage' }, lineage) : null,
    ),
    trailing ? createElement('div', { className: 'sp-list-row__trailing' }, trailing) : null,
  )
}

export type WordmarkProps = HTMLAttributes<HTMLSpanElement>

export function Wordmark({ className, ...props }: WordmarkProps) {
  return (
    <span {...props} className={cx('sp-wordmark', className)}>
      Spool<span className="sp-wordmark__dot">.</span>
    </span>
  )
}
