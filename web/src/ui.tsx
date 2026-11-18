// Apple-style (iOS) building blocks: large-title pages, inset grouped lists,
// bottom sheets, segmented controls, switches and banners.
import { useEffect, useState, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactNode } from 'react'
import { Icon, type IconName } from './icons'

// ---------- page ----------
export function Page({
  title,
  eyebrow,
  back,
  actions,
  children,
}: {
  title: string
  eyebrow?: string
  back?: { label: string; href?: string }
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="pb-32">
      {back ? (
        <header
          className="sticky top-0 z-30 border-b border-ios-sep bg-ios-gray6/85 backdrop-blur-xl"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <div className="relative mx-auto flex h-11 max-w-2xl items-center justify-between px-2">
            <a
              href={back.href || '#'}
              onClick={(e) => {
                if (!back.href) {
                  e.preventDefault()
                  history.back()
                }
              }}
              className="z-10 flex items-center text-[17px] text-ios-blue active:opacity-40"
            >
              <Icon name="chevron-left" size={26} stroke={2.4} />
              {back.label}
            </a>
            <h1 className="absolute inset-x-24 truncate text-center text-[17px] font-semibold">{title}</h1>
            <div className="z-10 flex items-center gap-1 pr-1">{actions}</div>
          </div>
        </header>
      ) : (
        <header className="mx-auto max-w-2xl px-4" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 6px)' }}>
          <div className="flex h-11 items-center justify-end gap-1">{actions}</div>
          {eyebrow && <div className="text-[13px] font-semibold uppercase tracking-wide text-ios-label2">{eyebrow}</div>}
          <h1 className="text-[34px] font-bold leading-[41px] tracking-tight">{title}</h1>
        </header>
      )}
      <main className="mx-auto max-w-2xl space-y-7 px-4 pt-4">{children}</main>
    </div>
  )
}

export function HeaderButton({
  icon,
  label,
  onClick,
  href,
  badge,
  text,
}: {
  icon?: IconName
  label: string
  onClick?: () => void
  href?: string
  badge?: number
  text?: string
}) {
  const inner = (
    <>
      {icon && <Icon name={icon} size={24} />}
      {text && <span className="text-[17px]">{text}</span>}
      {!!badge && (
        <span className="absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-ios-red px-1 text-[12px] font-semibold text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </>
  )
  const cls = 'relative flex h-11 min-w-11 items-center justify-center rounded-full px-1.5 text-ios-blue active:opacity-40'
  return href ? (
    <a href={href} aria-label={label} className={cls}>
      {inner}
    </a>
  ) : (
    <button type="button" aria-label={label} onClick={onClick} className={cls}>
      {inner}
    </button>
  )
}

// ---------- grouped lists ----------
export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-end justify-between gap-2 px-4">
      <h2 className="text-[13px] uppercase tracking-wide text-ios-label2">{children}</h2>
      {right && <div className="text-[13px] text-ios-label2">{right}</div>}
    </div>
  )
}

export function Group({ header, headerRight, footer, children }: { header?: ReactNode; headerRight?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return (
    <section>
      {header && <SectionTitle right={headerRight}>{header}</SectionTitle>}
      <div className="overflow-hidden rounded-xl bg-white">{children}</div>
      {footer && <div className="mt-1.5 px-4 text-[13px] leading-snug text-ios-label2">{footer}</div>}
    </section>
  )
}

export function Row({
  icon,
  iconBg,
  leading,
  title,
  subtitle,
  value,
  chevron,
  check,
  onClick,
  href,
  tone,
  accessory,
  center,
  children,
}: {
  icon?: IconName
  iconBg?: string
  leading?: ReactNode
  title?: ReactNode
  subtitle?: ReactNode
  value?: ReactNode
  chevron?: boolean
  check?: boolean
  onClick?: () => void
  href?: string
  tone?: 'link' | 'destructive' | 'success'
  accessory?: ReactNode
  center?: boolean
  children?: ReactNode
}) {
  const color = tone === 'link' ? 'text-ios-blue' : tone === 'destructive' ? 'text-ios-red' : tone === 'success' ? 'text-ios-green' : ''
  const inner = (
    <>
      {icon && (
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[7px] text-white" style={{ background: iconBg || '#8e8e93' }}>
          <Icon name={icon} size={18} />
        </span>
      )}
      {leading}
      {children ?? (
        <span className={`min-w-0 flex-1 ${center ? 'text-center' : ''}`}>
          <span className={`block text-[17px] leading-snug ${color}`}>{title}</span>
          {subtitle && <span className="mt-0.5 block text-[15px] leading-snug text-ios-label2">{subtitle}</span>}
        </span>
      )}
      {value !== undefined && <span className="shrink-0 text-right text-[17px] text-ios-label2">{value}</span>}
      {accessory}
      {check && <Icon name="check" size={20} stroke={2.6} className="text-ios-blue" />}
      {chevron && <Icon name="chevron-right" size={18} stroke={2.6} className="text-ios-gray3" />}
    </>
  )
  const cls = `ios-row relative flex min-h-[44px] w-full items-center gap-3 px-4 py-[11px] text-left ${onClick || href ? 'active:bg-ios-gray5' : ''}`
  const style = (icon || leading ? { '--inset': icon ? '58px' : '52px' } : undefined) as CSSProperties | undefined
  if (href)
    return (
      <a href={href} className={cls} style={style}>
        {inner}
      </a>
    )
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cls} style={style}>
        {inner}
      </button>
    )
  return (
    <div className={cls} style={style}>
      {inner}
    </div>
  )
}

// On phones a field never focuses by itself: the keyboard would pop up while a sheet is still sliding in,
// and iPhone then scrolls the top of the form off the screen. People tap the field they want instead.
const canAutoFocus = () => typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches

export function InputRow({ label, suffix, ...p }: { label?: string; suffix?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const picker = p.type === 'date' || p.type === 'time' || p.type === 'datetime-local'
  return (
    <label className="ios-row relative flex min-h-[44px] items-center gap-3 px-4">
      {label && <span className="shrink-0 text-[17px]">{label}</span>}
      <input
        {...p}
        autoFocus={!!p.autoFocus && canAutoFocus()}
        className={`bg-transparent py-[11px] text-[17px] outline-none placeholder:text-ios-label3 ${picker ? 'ml-auto w-auto min-w-0 flex-none' : 'min-w-0 flex-1'} ${
          label ? 'text-right text-ios-label2 focus:text-black' : ''
        }`}
      />
      {suffix && <span className="shrink-0 text-[17px] text-ios-label2">{suffix}</span>}
    </label>
  )
}

export function TextRow({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <label className="ios-row relative block px-4 py-[11px]">
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="block w-full resize-none bg-transparent text-[17px] outline-none placeholder:text-ios-label3"
      />
    </label>
  )
}

export interface Option {
  value: string
  label: string
}

// Native <select> laid over the row: on iPhone it opens the system picker.
export function SelectRow({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Option[] }) {
  const current = options.find((o) => o.value === value)
  return (
    <label className="ios-row relative flex min-h-[44px] items-center gap-3 px-4 py-[11px]">
      <span className="shrink-0 text-[17px]">{label}</span>
      <span className="min-w-0 flex-1 truncate text-right text-[17px] text-ios-label2">{current?.label ?? '—'}</span>
      <Icon name="chevron-updown" size={15} stroke={2.4} className="text-ios-label3" />
      <select value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label={label}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 ${checked ? 'bg-ios-green' : 'bg-ios-gray5'}`}
    >
      <span
        className={`absolute left-0 top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.16)] transition-transform duration-200 ${
          checked ? 'translate-x-[22px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  )
}

export function SwitchRow({ label, subtitle, checked, onChange }: { label: string; subtitle?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <Row title={label} subtitle={subtitle} accessory={<Switch checked={checked} onChange={onChange} label={label} />} />
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-[9px] bg-ios-fill p-[2px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-[7px] px-3 py-[6px] text-[13px] font-semibold transition ${
            value === o.value ? 'bg-white shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)]' : 'text-black/80'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ---------- buttons ----------
type Variant = 'primary' | 'green' | 'red' | 'tinted' | 'tinted-green' | 'tinted-red' | 'gray' | 'plain'
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ios-blue text-white',
  green: 'bg-ios-green text-white',
  red: 'bg-ios-red text-white',
  tinted: 'bg-ios-blue/15 text-ios-blue',
  'tinted-green': 'bg-ios-green/15 text-[#248a3d]',
  'tinted-red': 'bg-ios-red/12 text-ios-red',
  gray: 'bg-ios-fill text-ios-blue',
  plain: 'text-ios-blue',
}
const SIZES = {
  sm: 'h-[34px] rounded-full px-4 text-[15px]',
  md: 'h-11 rounded-xl px-5 text-[17px]',
  lg: 'h-[52px] rounded-[14px] px-6 text-[17px]',
  xl: 'h-16 rounded-[18px] px-6 text-[20px]',
}
export function Button({
  variant = 'primary',
  size = 'md',
  full,
  busy,
  icon,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZES; full?: boolean; busy?: boolean; icon?: IconName }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex items-center justify-center gap-2 font-semibold transition active:opacity-60 disabled:opacity-40 ${SIZES[size]} ${VARIANTS[variant]} ${
        full ? 'w-full' : ''
      } ${className}`}
    >
      {busy ? <Spinner small /> : icon && <Icon name={icon} size={size === 'sm' ? 17 : 21} stroke={2.2} />}
      {children}
    </button>
  )
}

// ---------- small pieces ----------
export type Tone = 'blue' | 'green' | 'red' | 'orange' | 'gray' | 'purple' | 'teal'
const PILL: Record<Tone, string> = {
  blue: 'bg-ios-blue/12 text-ios-blue',
  green: 'bg-ios-green/15 text-[#248a3d]',
  red: 'bg-ios-red/12 text-ios-red',
  orange: 'bg-ios-orange/15 text-[#c93400]',
  gray: 'bg-ios-fill text-ios-label2',
  purple: 'bg-ios-purple/12 text-ios-purple',
  teal: 'bg-ios-teal/15 text-[#0e7d96]',
}
export function Pill({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-[2px] text-[12px] font-semibold ${PILL[tone]}`}>{children}</span>
}

export function Dot({ color, size = 10 }: { color?: string; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ background: color || '#8e8e93', width: size, height: size }} />
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white p-4 ${className}`}>{children}</div>
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials =
    (name || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '?'
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#a5a5aa] to-[#858589] font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials}
    </span>
  )
}

export function Banner({ tone = 'orange', icon = 'alert', children, onClick, href }: { tone?: Tone; icon?: IconName; children: ReactNode; onClick?: () => void; href?: string }) {
  const colors: Record<string, string> = {
    orange: 'bg-ios-orange/12 text-[#9a4b00]',
    blue: 'bg-ios-blue/10 text-[#0040a8]',
    red: 'bg-ios-red/10 text-[#b3261e]',
    green: 'bg-ios-green/12 text-[#1d6b31]',
  }
  const cls = `flex w-full items-start gap-3 rounded-2xl px-4 py-3 text-left text-[15px] leading-snug ${colors[tone] || colors.orange} ${onClick || href ? 'active:opacity-60' : ''}`
  const inner = (
    <>
      <Icon name={icon} size={20} className="mt-[1px]" />
      <span className="flex-1">{children}</span>
      {(onClick || href) && <Icon name="chevron-right" size={18} stroke={2.4} className="mt-[1px] opacity-50" />}
    </>
  )
  if (href)
    return (
      <a href={href} className={cls}>
        {inner}
      </a>
    )
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cls}>
        {inner}
      </button>
    )
  return <div className={cls}>{inner}</div>
}

export function Empty({ icon = 'info', title, text }: { icon?: IconName; title: string; text?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <Icon name={icon} size={44} stroke={1.5} className="text-ios-gray3" />
      <p className="mt-3 text-[17px] font-semibold text-ios-label2">{title}</p>
      {text && <p className="mt-1 text-[15px] text-ios-label2">{text}</p>}
    </div>
  )
}

export function Spinner({ small }: { small?: boolean }) {
  const s = small ? 18 : 28
  return (
    <span className={small ? 'inline-flex' : 'flex justify-center py-12'}>
      <svg width={s} height={s} viewBox="0 0 24 24" className="animate-spin text-ios-gray" aria-label="Loading">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </span>
  )
}

// ---------- sheet (iOS modal) ----------
export function Sheet({
  title,
  onClose,
  onDone,
  doneLabel = 'Done',
  doneDisabled,
  busy,
  children,
}: {
  title: string
  onClose: () => void
  onDone?: () => void
  doneLabel?: string
  doneDisabled?: boolean
  busy?: boolean
  children: ReactNode
}) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', f)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      removeEventListener('keydown', f)
      document.body.style.overflow = prev
    }
  }, [onClose])
  return (
    <div className="animate-fade fixed inset-0 z-50 flex items-end justify-center bg-black/35 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="animate-sheet flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-[14px] bg-ios-gray6 shadow-2xl sm:max-w-lg sm:rounded-[14px]"
        // The screen you can actually see (not counting Safari's bars), and below the status bar / notch.
        style={{ maxHeight: 'calc(100dvh - env(safe-area-inset-top) - 12px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-[6px] sm:hidden">
          <span className="h-[5px] w-9 rounded-full bg-ios-gray3" />
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-4 pb-2 pt-2.5">
          <button type="button" onClick={onClose} className="justify-self-start text-[17px] text-ios-blue active:opacity-40">
            Cancel
          </button>
          <h2 className="truncate px-2 text-[17px] font-semibold">{title}</h2>
          <div className="justify-self-end">
            {onDone &&
              (busy ? (
                <Spinner small />
              ) : (
                <button type="button" onClick={onDone} disabled={doneDisabled} className="text-[17px] font-semibold text-ios-blue active:opacity-40 disabled:text-ios-label3">
                  {doneLabel}
                </button>
              ))}
          </div>
        </div>
        <div className="space-y-7 overflow-y-auto overscroll-contain px-4 pb-10 pt-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 32px)' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

// ---------- color picker (system colors) ----------
export const SYSTEM_COLORS = ['#007aff', '#34c759', '#ff9500', '#ff3b30', '#af52de', '#5856d6', '#ff2d55', '#30b0c7', '#a2845e', '#8e8e93']
export function ColorRow({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="ios-row relative flex flex-wrap gap-3 px-4 py-3">
      {SYSTEM_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Color ${c}`}
          onClick={() => onChange(c)}
          className="flex h-9 w-9 items-center justify-center rounded-full"
          style={{ background: c, boxShadow: value?.toLowerCase() === c ? `0 0 0 3px #fff, 0 0 0 5px ${c}` : undefined }}
        >
          {value?.toLowerCase() === c && <Icon name="check" size={18} stroke={3} className="text-white" />}
        </button>
      ))}
    </div>
  )
}

// ---------- toasts (iOS-style banner) ----------
type ToastMsg = { id: number; text: string; tone: 'ok' | 'error' | 'info' }
let listeners: ((t: ToastMsg[]) => void)[] = []
let toasts: ToastMsg[] = []
let nextId = 1
export function toast(text: string, tone: ToastMsg['tone'] = 'ok') {
  const t = { id: nextId++, text, tone }
  toasts = [...toasts.slice(-2), t]
  listeners.forEach((l) => l(toasts))
  setTimeout(
    () => {
      toasts = toasts.filter((x) => x.id !== t.id)
      listeners.forEach((l) => l(toasts))
    },
    tone === 'error' ? 6000 : 3200,
  )
}
export function Toaster() {
  const [list, setList] = useState<ToastMsg[]>([])
  useEffect(() => {
    listeners.push(setList)
    return () => {
      listeners = listeners.filter((l) => l !== setList)
    }
  }, [])
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
      {list.map((t) => (
        <div
          key={t.id}
          role="status"
          className="animate-toast pointer-events-auto flex max-w-md items-center gap-2.5 rounded-full bg-white/95 py-2.5 pl-3 pr-5 text-[15px] font-medium shadow-[0_8px_30px_rgba(0,0,0,0.14)] backdrop-blur-xl"
        >
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white ${
              t.tone === 'error' ? 'bg-ios-red' : t.tone === 'info' ? 'bg-ios-blue' : 'bg-ios-green'
            }`}
          >
            <Icon name={t.tone === 'error' ? 'xmark' : t.tone === 'info' ? 'info' : 'check'} size={14} stroke={3} />
          </span>
          {t.text}
        </div>
      ))}
    </div>
  )
}
