import PocketBase, { ClientResponseError } from 'pocketbase'

// Backend URL (the Pi behind Cloudflare Tunnel). Set at build time with VITE_API_URL.
// For testing it can be overridden with ?api=https://... (saved on the phone).
function resolveApiUrl(): string {
  try {
    const q = new URLSearchParams(location.search).get('api')
    if (q) localStorage.setItem('apiUrl', q)
    const saved = localStorage.getItem('apiUrl')
    if (saved) return saved
  } catch {
    /* no storage */
  }
  const env = import.meta.env.VITE_API_URL as string | undefined
  // "/" = the app is served by PocketBase itself (same origin), e.g. for a quick demo.
  if (env === '/') return location.origin
  return env || 'http://127.0.0.1:8090'
}

export const API_URL = resolveApiUrl()
export const pb = new PocketBase(API_URL)
pb.autoCancellation(false)

export type Access = 'owner' | 'admin' | 'manager' | 'employee'

export interface Base {
  id: string
  created: string
  updated: string
  collectionId: string
  collectionName: string
}
export interface User extends Base {
  name: string
  email: string
  access: Access
  positions: string[]
  locations: string[]
  phone: string
  phone_login: string
  joined_at: string
  active: boolean
}
export interface Company extends Base {
  name: string
}
export interface Position extends Base {
  name: string
  color: string
  sort: number
  active: boolean
}
export interface Loc extends Base {
  name: string
  address: string
  lat: number
  lng: number
  radius_m: number
  timezone: string
  ot_weekly_hours: number
  active: boolean
}
export interface Section extends Base {
  location: string
  name: string
  color: string
  lat: number
  lng: number
  radius_m: number
  sort: number
}
export interface Shift extends Base {
  location: string
  section: string
  position: string
  user: string
  starts_at: string
  ends_at: string
  notes: string
  published: boolean
}
export type ReqType = 'cover' | 'swap' | 'drop' | 'pickup'
export type ReqStatus = 'pending_peer' | 'pending_admin' | 'approved' | 'rejected' | 'declined' | 'cancelled'
export interface ShiftRequest extends Base {
  type: ReqType
  status: ReqStatus
  shift: string
  requester: string
  target_user: string
  target_shift: string
  note: string
  decided_by: string
  decided_at: string
  decision_note: string
  expand?: { shift?: Shift; target_shift?: Shift }
}
export type TimeOffKind = 'vacation' | 'sick' | 'personal' | 'unpaid'
export interface TimeOff extends Base {
  user: string
  starts_at: string
  ends_at: string
  kind: TimeOffKind
  note: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  decided_by: string
  decision_note: string
}
export type Geo = 'inside' | 'uncertain' | 'outside' | 'low_accuracy' | 'no_gps' | 'not_configured' | 'manual' | ''
export interface Timecard extends Base {
  user: string
  location: string
  section: string
  shift: string
  clock_in: string
  clock_out: string
  break_started_at: string
  break_min: number
  in_geo: Geo
  in_dist: number
  in_acc: number
  out_geo: Geo
  out_dist: number
  reason: string
  flagged: boolean
  flag_reason: string
  approved: boolean
  notes: string
  edited: boolean
}
export interface Notice extends Base {
  user: string
  title: string
  body: string
  link: string
  read: boolean
}
export interface PayRate extends Base {
  user: string
  hourly: number
}

export const isOwner = (u?: User | null) => !!u && u.access === 'owner'
export const isAdmin = (u?: User | null) => !!u && (u.access === 'owner' || u.access === 'admin')
/** Owner > Admin > Manager > Employee: admins manage managers and employees; the owner manages everyone. */
export const canManage = (actor?: User | null, target?: Pick<User, 'access'> | null) =>
  isOwner(actor) || (isAdmin(actor) && !!target && target.access !== 'owner' && target.access !== 'admin')
export const isMgr = (u?: User | null) => !!u && (u.access === 'owner' || u.access === 'admin' || u.access === 'manager')

export const ACCESS_LABEL: Record<Access, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  employee: 'Employee',
}

export function currentUser(): User | null {
  return (pb.authStore.isValid ? (pb.authStore.record as unknown as User) : null) || null
}

// POST to our own /api/ch/* routes
export function api<T = any>(path: string, body?: unknown): Promise<T> {
  return pb.send<T>(path, { method: 'POST', body: body ?? {} })
}

// What someone types to sign in: an email, or a phone number in any format.
export function signInIdentity(input: string) {
  const v = input.trim()
  if (v.includes('@')) return v.toLowerCase()
  const d = v.replace(/\D/g, '')
  return d.length > 10 ? d.slice(-10) : d
}

// Link someone opens to join (or get back in).
export function inviteUrl(token: string) {
  return `${location.origin}${location.pathname}#/join/${token}`
}

export function errMsg(e: unknown): string {
  if (e instanceof ClientResponseError) {
    if (e.status === 0) return "Can't reach the server. Check your internet connection."
    const data = e.response as { message?: string; data?: Record<string, { message?: string }> }
    const nice: Record<string, string> = {
      phone_login: 'That phone number is already used by someone else.',
      email: 'That email is already used by someone else.',
    }
    const fields = data?.data ? Object.entries(data.data).map(([k, v]) => nice[k] || `${k}: ${v?.message}`) : []
    if (fields.length && (data?.message || '').startsWith('Failed to')) return fields.join(' · ')
    return [data?.message || e.message, ...fields].filter(Boolean).join(' · ')
  }
  return e instanceof Error ? e.message : String(e)
}

export function isNotFound(e: unknown) {
  return e instanceof ClientResponseError && e.status === 404
}
