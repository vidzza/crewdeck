import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { pb, isAdmin, type Company, type Loc, type Position, type Section, type User } from './lib/pb'

// Lookup data used by almost every screen, the location being viewed, and the unread count.
interface Data {
  me: User
  company: Company | null
  users: User[]
  positions: Position[]
  sections: Section[]
  locations: Loc[]
  /** Locations this person works at (owners and admins: all of them). */
  myLocations: Loc[]
  /** The location shown on Schedule, Hours and Today when there's more than one. */
  currentLocation: Loc | undefined
  setCurrentLocation: (id: string) => void
  loaded: boolean
  unread: number
  /** Requests waiting for this person: asked of them, or theirs to approve. */
  todo: number
  reload: () => Promise<void>
  refreshUnread: () => void
  userName: (id: string) => string
  position: (id: string) => Position | undefined
  section: (id: string) => Section | undefined
  locationName: (id: string) => string
}

const Ctx = createContext<Data | null>(null)
const LOC_KEY = 'crewdeck-location'

function savedLocation() {
  try {
    return localStorage.getItem(LOC_KEY) || ''
  } catch {
    return ''
  }
}

export function DataProvider({ me, children }: { me: User; children: ReactNode }) {
  const [company, setCompany] = useState<Company | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [locations, setLocations] = useState<Loc[]>([])
  const [locId, setLocId] = useState(savedLocation)
  const [loaded, setLoaded] = useState(false)
  const [unread, setUnread] = useState(0)
  const [todo, setTodo] = useState(0)

  const reload = useCallback(async () => {
    const [c, u, p, s, l] = await Promise.all([
      pb.collection('company').getList<Company>(1, 1).catch(() => null),
      pb.collection('users').getFullList<User>({ sort: 'name' }),
      pb.collection('positions').getFullList<Position>({ sort: 'sort,name' }),
      pb.collection('sections').getFullList<Section>({ sort: 'sort,name' }),
      pb.collection('locations').getFullList<Loc>({ sort: 'created' }),
    ])
    setCompany(c?.items[0] || null)
    setUsers(u)
    setPositions(p)
    setSections(s)
    setLocations(l)
    setLoaded(true)
  }, [])

  const myId = me.id
  const access = me.access
  const refreshUnread = useCallback(() => {
    pb.collection('notifications')
      .getList(1, 1, { filter: 'read = false' })
      .then((r) => setUnread(r.totalItems))
      .catch(() => {})
    // Things waiting for this person (the badge on the Requests tab).
    const count = (coll: string, filter: string) =>
      pb
        .collection(coll)
        .getList(1, 1, { filter })
        .then((r) => r.totalItems)
        .catch(() => 0)
    const asked = pb.filter('status = "pending_peer" && target_user = {:me}', { me: myId })
    Promise.all([
      count('shift_requests', asked),
      access === 'owner' ? count('shift_requests', 'status = "pending_admin"') : Promise.resolve(0),
      access === 'owner' || access === 'admin'
        ? count('time_off', access === 'owner' ? 'status = "pending"' : pb.filter('status = "pending" && user != {:me}', { me: myId }))
        : Promise.resolve(0),
    ]).then(([a, b, c]) => setTodo(a + b + c))
  }, [myId, access])

  useEffect(() => {
    reload().catch(() => setLoaded(true))
    refreshUnread()
    pb.collection('notifications').subscribe('*', refreshUnread).catch(() => {})
    const t = setInterval(refreshUnread, 60000)
    return () => {
      clearInterval(t)
      pb.collection('notifications').unsubscribe('*').catch(() => {})
    }
  }, [reload, refreshUnread])

  const setCurrentLocation = useCallback((id: string) => {
    setLocId(id)
    try {
      localStorage.setItem(LOC_KEY, id)
    } catch {
      /* ignore */
    }
  }, [])

  const value = useMemo<Data>(() => {
    const um = new Map(users.map((u) => [u.id, u]))
    const pm = new Map(positions.map((p) => [p.id, p]))
    const sm = new Map(sections.map((s) => [s.id, s]))
    const lm = new Map(locations.map((l) => [l.id, l]))
    const active = locations.filter((l) => l.active !== false)
    const mine = isAdmin(me) || !me.locations?.length ? active : active.filter((l) => me.locations.includes(l.id))
    const current = mine.find((l) => l.id === locId) || mine[0]
    return {
      me,
      company,
      users,
      positions,
      sections,
      locations,
      myLocations: mine,
      currentLocation: current,
      setCurrentLocation,
      loaded,
      unread,
      todo,
      reload,
      refreshUnread,
      userName: (id) => (id ? um.get(id)?.name || um.get(id)?.email || 'Someone' : 'Open Shift'),
      position: (id) => pm.get(id),
      section: (id) => sm.get(id),
      locationName: (id) => lm.get(id)?.name || '',
    }
  }, [me, company, users, positions, sections, locations, locId, setCurrentLocation, loaded, unread, todo, reload, refreshUnread])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useData() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useData outside DataProvider')
  return v
}
