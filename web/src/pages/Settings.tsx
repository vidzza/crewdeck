import { useState } from 'react'
import { pb, errMsg, API_URL, ACCESS_LABEL, type Loc, type Position, type Section as Sec } from '../lib/pb'
import { getPosition } from '../lib/geo'
import { useData } from '../store'
import { InstallSheet, TopActions } from '../chrome'
import { Avatar, Button, ColorRow, Dot, Group, HeaderButton, InputRow, Page, Pill, Row, SelectRow, Sheet, Switch, toast, type Option } from '../ui'

const TIME_ZONES: Option[] = [
  { value: 'America/New_York', label: 'Eastern' },
  { value: 'America/Chicago', label: 'Central' },
  { value: 'America/Denver', label: 'Mountain' },
  { value: 'America/Phoenix', label: 'Arizona' },
  { value: 'America/Los_Angeles', label: 'Pacific' },
  { value: 'America/Anchorage', label: 'Alaska' },
  { value: 'Pacific/Honolulu', label: 'Hawaii' },
  { value: 'America/Mexico_City', label: 'Mexico City' },
]
// The common US zones, plus whatever the location already uses (set from the owner's phone at setup).
function timeZoneOptions(current: string): Option[] {
  if (!current || TIME_ZONES.some((z) => z.value === current)) return TIME_ZONES
  return [{ value: current, label: current.split('/').pop()!.replace(/_/g, ' ') }, ...TIME_ZONES]
}

const mapsLink = (lat: number, lng: number) => `https://maps.apple.com/?ll=${lat},${lng}&q=Time%20clock`
const hasSpot = (l: { lat: number; lng: number }) => !!(l.lat || l.lng)

async function readGps(): Promise<{ lat: number; lng: number; acc: number } | null> {
  toast('Finding your location… hold still', 'info')
  const g = await getPosition(20000)
  if (!g.pos) {
    if (g.error) toast(g.error, 'error')
    return null
  }
  if (g.pos.acc > 60) toast(`Location is rough (±${g.pos.acc} m). Try again near a door or window.`, 'info')
  return g.pos
}

// ---------- Settings (root) ----------
export default function Settings() {
  const { me, company, users, locations, positions } = useData()
  const [install, setInstall] = useState(false)
  const [editCompany, setEditCompany] = useState(false)
  const missingSpot = locations.filter((l) => l.active !== false && !hasSpot(l)).length
  return (
    <Page title="Settings" actions={<TopActions />}>
      <Group>
        <Row
          href="#/account"
          chevron
          leading={<Avatar name={me.name || me.email} size={56} />}
          title={<span className="text-[20px] font-semibold">{me.name || me.email}</span>}
          subtitle={`${ACCESS_LABEL[me.access]} · ${me.email || me.phone}`}
        />
      </Group>
      <Group header="Company">
        <Row icon="building" iconBg="#5856d6" title="Company Name" value={company?.name || 'Not set'} chevron onClick={() => setEditCompany(true)} />
        <Row
          href="#/settings/locations"
          icon="pin"
          iconBg="#ff3b30"
          title="Locations"
          value={missingSpot ? <Pill tone="orange">{missingSpot} need a time clock spot</Pill> : locations.length}
          chevron
        />
        <Row href="#/settings/team" icon="people" iconBg="#007aff" title="Team" value={users.filter((u) => u.active).length} chevron />
        <Row href="#/settings/access" icon="key" iconBg="#ff9500" title="Access Levels" value="Who can do what" chevron />
        <Row href="#/settings/positions" icon="tag" iconBg="#af52de" title="Positions" value={positions.filter((p) => p.active).length} chevron />
      </Group>
      <Group header="Reports">
        <Row href="#/insights" icon="chart" iconBg="#34c759" title="Insights" subtitle="Hours, labor cost, overtime, attendance" chevron />
        <Row href="#/settings/api" icon="key" iconBg="#8e8e93" title="API Access" subtitle="Read-only keys for other tools" chevron />
      </Group>
      <Group footer={`Server: ${API_URL}`}>
        <Row icon="share" iconBg="#34c759" title="Add to Home Screen" chevron onClick={() => setInstall(true)} />
      </Group>
      {install && <InstallSheet onClose={() => setInstall(false)} />}
      {editCompany && <CompanySheet onClose={() => setEditCompany(false)} />}
    </Page>
  )
}

function CompanySheet({ onClose }: { onClose: () => void }) {
  const { company, reload } = useData()
  const [name, setName] = useState(company?.name || '')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!company || !name.trim()) return
    setBusy(true)
    try {
      await pb.collection('company').update(company.id, { name: name.trim() })
      await reload()
      toast('Saved')
      onClose()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet title="Company" onClose={onClose} onDone={save} doneLabel="Save" doneDisabled={!name.trim()} busy={busy}>
      <Group footer="Your team sees this name when they sign in and when they're invited.">
        <InputRow placeholder="Company name" value={name} onChange={(e) => setName(e.target.value)} />
      </Group>
    </Sheet>
  )
}

// ---------- Locations ----------
export function LocationsPage() {
  const { locations, users, sections } = useData()
  const [adding, setAdding] = useState(false)
  return (
    <Page title="Locations" back={{ label: 'Settings', href: '#/settings' }} actions={<HeaderButton icon="plus" label="Add location" onClick={() => setAdding(true)} />}>
      <Group footer="Each location has its own time clock spot, sections and schedule. People only see the locations they work at.">
        {locations.map((l) => {
          const people = users.filter((u) => u.active && (u.locations?.includes(l.id) || u.access === 'owner' || u.access === 'admin')).length
          const secs = sections.filter((s) => s.location === l.id).length
          return (
            <Row
              key={l.id}
              href={`#/settings/locations/${l.id}`}
              chevron
              icon="pin"
              iconBg={hasSpot(l) ? '#34c759' : '#ff9500'}
              title={l.name}
              subtitle={[hasSpot(l) ? 'Time clock set' : 'Time clock spot not set', `${people} ${people === 1 ? 'person' : 'people'}`, secs ? `${secs} sections` : '']
                .filter(Boolean)
                .join(' · ')}
            />
          )
        })}
      </Group>
      <Group>
        <Row icon="plus" iconBg="#007aff" title="Add Location" tone="link" onClick={() => setAdding(true)} />
      </Group>
      {adding && <AddLocationSheet onClose={() => setAdding(false)} />}
    </Page>
  )
}

function AddLocationSheet({ onClose }: { onClose: () => void }) {
  const { locations, reload, setCurrentLocation } = useData()
  const [f, setF] = useState({ name: '', address: '', lat: 0, lng: 0 })
  const [busy, setBusy] = useState(false)
  const useHere = async () => {
    const p = await readGps()
    if (p) setF((x) => ({ ...x, lat: p.lat, lng: p.lng }))
  }
  const save = async () => {
    if (!f.name.trim()) return toast('Give the location a name.', 'error')
    setBusy(true)
    try {
      const base = locations[0]
      const l = await pb.collection('locations').create<Loc>({
        name: f.name.trim(),
        address: f.address.trim(),
        lat: f.lat,
        lng: f.lng,
        radius_m: 100,
        ot_weekly_hours: base?.ot_weekly_hours || 40,
        timezone: base?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        active: true,
      })
      await reload()
      setCurrentLocation(l.id)
      toast(`${l.name} added. Now add the people who work there in Team.`)
      onClose()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet title="New Location" onClose={onClose} onDone={save} doneLabel="Add" doneDisabled={!f.name.trim()} busy={busy}>
      <Group>
        <InputRow placeholder="Name (e.g. Uptown)" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <InputRow placeholder="Address (optional)" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
      </Group>
      <Group header="Time clock spot" footer={hasSpot(f) ? 'Saved. People can only clock in near this spot.' : "If you're there right now, save the spot. Otherwise you can set it later."}>
        <Row
          icon={hasSpot(f) ? 'check' : 'location'}
          iconBg={hasSpot(f) ? '#34c759' : '#007aff'}
          title={hasSpot(f) ? 'Spot Saved' : "I'm Here — Use My Location"}
          tone={hasSpot(f) ? 'success' : 'link'}
          onClick={useHere}
        />
      </Group>
    </Sheet>
  )
}

export function LocationPage({ id }: { id: string }) {
  const { locations, sections, reload } = useData()
  const loc = locations.find((l) => l.id === id)
  const [f, setF] = useState(() => ({
    name: loc?.name || '',
    address: loc?.address || '',
    lat: loc?.lat ? String(loc.lat) : '',
    lng: loc?.lng ? String(loc.lng) : '',
    radius_m: loc?.radius_m || 100,
    timezone: loc?.timezone || '',
    ot_weekly_hours: String(loc?.ot_weekly_hours || 40),
  }))
  const [busy, setBusy] = useState(false)
  const [editSec, setEditSec] = useState<Sec | 'new' | null>(null)

  if (!loc)
    return (
      <Page title="Location" back={{ label: 'Locations', href: '#/settings/locations' }}>
        <p className="px-4 text-ios-label2">This location doesn't exist anymore.</p>
      </Page>
    )

  const spot = !!(Number(f.lat) || Number(f.lng))
  const mySections = sections.filter((s) => s.location === loc.id)

  const useHere = async () => {
    const p = await readGps()
    if (p) {
      setF((x) => ({ ...x, lat: p.lat.toFixed(6), lng: p.lng.toFixed(6) }))
      toast(`Got it (±${p.acc} m). Tap Save.`)
    }
  }
  const save = async () => {
    if (!f.name.trim()) return toast('Give the location a name.', 'error')
    setBusy(true)
    try {
      await pb.collection('locations').update(loc.id, {
        name: f.name.trim(),
        address: f.address.trim(),
        lat: Number(f.lat) || 0,
        lng: Number(f.lng) || 0,
        radius_m: Number(f.radius_m) || 100,
        timezone: f.timezone,
        ot_weekly_hours: Number(f.ot_weekly_hours) || 40,
      })
      await reload()
      toast('Saved')
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page title={loc.name} back={{ label: 'Locations', href: '#/settings/locations' }} actions={<HeaderButton text={busy ? 'Saving…' : 'Save'} label="Save" onClick={save} />}>
      <Group>
        <InputRow label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <InputRow label="Address" placeholder="Optional" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
      </Group>

      <Group header="Time Clock Spot" footer="Stand where people work and tap Use My Current Location, then Save. People can only clock in inside the circle — or they explain why and you review it.">
        <Row icon="pin" iconBg={spot ? '#34c759' : '#ff3b30'} title="Status" value={spot ? <Pill tone="green">Set Up</Pill> : <Pill tone="red">Not Set Up</Pill>} />
        <Row icon="location" iconBg="#007aff" title="Use My Current Location" tone="link" onClick={useHere} />
        {spot && <Row title="View on Map" tone="link" href={mapsLink(Number(f.lat), Number(f.lng))} chevron />}
      </Group>

      <Group header="Allowed Distance" footer="100–150 m works for most places. Too small and people inside get blocked by weak GPS.">
        <div className="ios-row relative px-4 py-3">
          <div className="flex items-center justify-between text-[17px]">
            <span>Radius</span>
            <span className="tabular text-ios-label2">{f.radius_m} m</span>
          </div>
          <input type="range" min={25} max={500} step={5} value={f.radius_m} onChange={(e) => setF({ ...f, radius_m: Number(e.target.value) })} className="mt-2 w-full" aria-label="Radius in meters" />
        </div>
      </Group>

      <Group header="Sections" footer="Optional areas inside this location to assign shifts to (e.g. Bar, Patio, Door).">
        {mySections.map((s) => (
          <Row
            key={s.id}
            onClick={() => setEditSec(s)}
            chevron
            leading={<Dot color={s.color} size={14} />}
            title={s.name}
            subtitle={s.lat || s.lng ? `Own time clock spot · ${s.radius_m || 100} m` : undefined}
          />
        ))}
        <Row icon="plus" iconBg="#8e8e93" title="Add Section" tone="link" onClick={() => setEditSec('new')} />
      </Group>

      <Group header="Pay Rules" footer="Hours above this count as overtime in Schedule and Hours.">
        <InputRow label="Overtime After" type="number" inputMode="numeric" suffix="h/week" value={f.ot_weekly_hours} onChange={(e) => setF({ ...f, ot_weekly_hours: e.target.value })} />
        <SelectRow label="Time Zone" value={f.timezone} onChange={(v) => setF({ ...f, timezone: v })} options={timeZoneOptions(f.timezone)} />
      </Group>

      <Button size="lg" full busy={busy} onClick={save}>
        Save
      </Button>

      {editSec && (
        <SectionSheet
          section={editSec === 'new' ? null : editSec}
          locationId={loc.id}
          count={mySections.length}
          onClose={() => setEditSec(null)}
          onSaved={async () => {
            setEditSec(null)
            await reload()
          }}
        />
      )}
    </Page>
  )
}

function SectionSheet({ section, locationId, count, onClose, onSaved }: { section: Sec | null; locationId: string; count: number; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: section?.name || '',
    color: section?.color || '#007aff',
    lat: section?.lat ? String(section.lat) : '',
    lng: section?.lng ? String(section.lng) : '',
    radius_m: section?.radius_m ? String(section.radius_m) : '',
  })
  const [busy, setBusy] = useState(false)
  const own = !!(Number(f.lat) || Number(f.lng))

  const save = async () => {
    if (!f.name.trim()) return toast('Give the section a name.', 'error')
    setBusy(true)
    try {
      const body = { name: f.name.trim(), color: f.color, lat: Number(f.lat) || 0, lng: Number(f.lng) || 0, radius_m: Number(f.radius_m) || 0 }
      if (section) await pb.collection('sections').update(section.id, body)
      else await pb.collection('sections').create({ ...body, location: locationId, sort: count })
      toast('Saved')
      onSaved()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!section || !confirm(`Delete “${section.name}”? Shifts in this section keep their time but lose the section.`)) return
    try {
      await pb.collection('sections').delete(section.id)
      toast('Deleted')
      onSaved()
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }
  const useHere = async () => {
    const p = await readGps()
    if (p) setF((x) => ({ ...x, lat: p.lat.toFixed(6), lng: p.lng.toFixed(6), radius_m: x.radius_m || '50' }))
  }

  return (
    <Sheet title={section ? 'Edit Section' : 'New Section'} onClose={onClose} onDone={save} doneLabel={section ? 'Save' : 'Add'} busy={busy}>
      <Group>
        <InputRow placeholder="Name (e.g. Patio)" autoFocus={!section} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </Group>
      <Group header="Color">
        <ColorRow value={f.color} onChange={(c) => setF({ ...f, color: c })} />
      </Group>
      <Group header="Own Time Clock Spot" footer="Optional. Only if this section is somewhere else (another floor, building or lot).">
        <Row icon="location" iconBg="#007aff" title="Use My Current Location" tone="link" onClick={useHere} />
        {own && (
          <>
            <InputRow label="Radius" type="number" inputMode="numeric" suffix="m" value={f.radius_m} onChange={(e) => setF({ ...f, radius_m: e.target.value })} />
            <Row title="Remove Own Spot" tone="destructive" onClick={() => setF({ ...f, lat: '', lng: '', radius_m: '' })} />
          </>
        )}
      </Group>
      {section && (
        <Group>
          <Row title="Delete Section" tone="destructive" center onClick={remove} />
        </Group>
      )}
    </Sheet>
  )
}

// ---------- Positions ----------
export function PositionsPage() {
  const { positions, reload } = useData()
  const [edit, setEdit] = useState<Position | 'new' | null>(null)

  const toggle = async (p: Position, active: boolean) => {
    try {
      await pb.collection('positions').update(p.id, { active })
      await reload()
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  return (
    <Page title="Positions" back={{ label: 'Settings', href: '#/settings' }} actions={<HeaderButton icon="plus" label="Add position" onClick={() => setEdit('new')} />}>
      <Group footer="Turn a position off to hide it from new shifts. Past shifts keep it.">
        {positions.map((p) => (
          <Row
            key={p.id}
            leading={<Dot color={p.color} size={14} />}
            accessory={<Switch checked={p.active} onChange={(v) => toggle(p, v)} label={`${p.name} active`} />}
          >
            <button type="button" onClick={() => setEdit(p)} className={`min-w-0 flex-1 text-left text-[17px] ${p.active ? '' : 'text-ios-label2'}`}>
              {p.name}
            </button>
          </Row>
        ))}
      </Group>
      <Group>
        <Row icon="plus" iconBg="#007aff" title="Add Position" tone="link" onClick={() => setEdit('new')} />
      </Group>
      {edit && (
        <PositionSheet
          position={edit === 'new' ? null : edit}
          count={positions.length}
          onClose={() => setEdit(null)}
          onSaved={async () => {
            setEdit(null)
            await reload()
          }}
        />
      )}
    </Page>
  )
}

function PositionSheet({ position, count, onClose, onSaved }: { position: Position | null; count: number; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(position?.name || '')
  const [color, setColor] = useState(position?.color || '#007aff')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!name.trim()) return toast('Give the position a name.', 'error')
    setBusy(true)
    try {
      if (position) await pb.collection('positions').update(position.id, { name: name.trim(), color })
      else await pb.collection('positions').create({ name: name.trim(), color, sort: count, active: true })
      toast('Saved')
      onSaved()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet title={position ? 'Edit Position' : 'New Position'} onClose={onClose} onDone={save} doneLabel={position ? 'Save' : 'Add'} busy={busy}>
      <Group>
        <InputRow placeholder="Name (e.g. Server)" autoFocus={!position} value={name} onChange={(e) => setName(e.target.value)} />
      </Group>
      <Group header="Color" footer="Shifts for this position show this color on the schedule.">
        <ColorRow value={color} onChange={setColor} />
      </Group>
    </Sheet>
  )
}
