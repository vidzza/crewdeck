import { useEffect, useState, type ComponentType } from 'react'
import { pb, currentUser, isAdmin, type User } from './lib/pb'
import { DataProvider, useData } from './store'
import { Spinner, Toaster } from './ui'
import { Icon, type IconName } from './icons'
import Login from './pages/Login'
import Today from './pages/Today'
import Schedule from './pages/Schedule'
import Requests from './pages/Requests'
import Hours from './pages/Hours'
import Settings, { LocationPage, LocationsPage, PositionsPage } from './pages/Settings'
import Join, { WELCOME_KEY } from './pages/Join'
import { LocationHelp, WelcomeSheet } from './chrome'
import { syncBadge, syncPush } from './lib/push'
import Team from './pages/Team'
import Account from './pages/Account'
import Notices from './pages/Notices'
import Insights, { ApiAccessPage } from './pages/Insights'

// Hash routes. Settings pages are owner/admin only.
const PAGES: Record<string, { page: ComponentType; admin?: boolean }> = {
  '/today': { page: Today },
  '/schedule': { page: Schedule },
  '/requests': { page: Requests },
  '/timeoff': { page: Requests },
  '/hours': { page: Hours },
  '/account': { page: Account },
  '/notifications': { page: Notices },
  '/settings': { page: Settings, admin: true },
  '/settings/team': { page: Team, admin: true },
  '/settings/locations': { page: LocationsPage, admin: true },
  '/settings/positions': { page: PositionsPage, admin: true },
  '/settings/api': { page: ApiAccessPage, admin: true },
  '/insights': { page: Insights, admin: true },
}

interface Tab {
  path: string
  label: string
  icon: IconName
  match: string[]
  admin?: boolean
}
const TABS: Tab[] = [
  { path: '/today', label: 'Today', icon: 'clock', match: ['/today'] },
  { path: '/schedule', label: 'Schedule', icon: 'calendar', match: ['/schedule'] },
  { path: '/requests', label: 'Requests', icon: 'swap', match: ['/requests', '/timeoff'] },
  { path: '/hours', label: 'Hours', icon: 'doc', match: ['/hours'] },
  { path: '/settings', label: 'Settings', icon: 'gear', match: ['/settings'], admin: true },
]

function useHashPath() {
  const get = () => location.hash.replace(/^#/, '').split('?')[0] || '/today'
  const [path, setPath] = useState(get)
  useEffect(() => {
    const f = () => {
      setPath(get())
      window.scrollTo(0, 0)
    }
    addEventListener('hashchange', f)
    return () => removeEventListener('hashchange', f)
  }, [])
  return path
}

export default function App() {
  const path = useHashPath()
  const [user, setUser] = useState<User | null>(currentUser())
  const [checking, setChecking] = useState(!!user)

  useEffect(() => {
    const unsub = pb.authStore.onChange(() => setUser(currentUser()))
    if (pb.authStore.isValid) {
      pb.collection('users')
        .authRefresh()
        .catch((e) => {
          // Only sign out if the server rejected the token (not when offline).
          if (e?.status === 401 || e?.status === 403 || e?.status === 404) pb.authStore.clear()
        })
        .finally(() => setChecking(false))
    }
    return () => unsub()
  }, [])

  // Invite links work whether or not someone is signed in.
  if (path.startsWith('/join/'))
    return (
      <>
        <Join token={path.slice('/join/'.length)} />
        <LocationHelp />
        <Toaster />
      </>
    )

  return (
    <>
      {checking ? (
        <Spinner />
      ) : user ? (
        <DataProvider me={user} key={user.id}>
          <Shell />
        </DataProvider>
      ) : (
        <Login />
      )}
      <LocationHelp />
      <Toaster />
    </>
  )
}

function wantsWelcome() {
  try {
    return localStorage.getItem(WELCOME_KEY) === '1'
  } catch {
    return false
  }
}

function Shell() {
  const { me, loaded, unread } = useData()
  const path = useHashPath()
  const [welcome, setWelcome] = useState(wantsWelcome)
  const locId = path.startsWith('/settings/locations/') ? path.slice('/settings/locations/'.length) : ''
  const entry = PAGES[path] && (!PAGES[path].admin || isAdmin(me)) ? PAGES[path] : PAGES['/today']
  const Page = entry.page
  const tabs = TABS.filter((t) => !t.admin || isAdmin(me))
  useEffect(() => {
    syncPush()
  }, [me.id])
  useEffect(() => syncBadge(unread), [unread])
  const closeWelcome = () => {
    setWelcome(false)
    try {
      localStorage.removeItem(WELCOME_KEY)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="min-h-screen">
      {!loaded ? <Spinner /> : locId && isAdmin(me) ? <LocationPage key={locId} id={locId} /> : <Page key={path} />}
      {loaded && welcome && <WelcomeSheet onClose={closeWelcome} />}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-ios-sep bg-white/85 backdrop-blur-xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto flex max-w-2xl">
          {tabs.map((t) => {
            const active = t.match.some((m) => path === m || path.startsWith(m + '/'))
            return (
              <a
                key={t.path}
                href={`#${t.path}`}
                className={`flex h-[52px] flex-1 flex-col items-center justify-center gap-[3px] text-[10.5px] font-medium ${active ? 'text-ios-blue' : 'text-ios-gray'}`}
              >
                <Icon name={t.icon} size={25} stroke={active ? 2.2 : 1.8} />
                {t.label}
              </a>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
