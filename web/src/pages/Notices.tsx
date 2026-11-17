import { useCallback, useEffect, useState } from 'react'
import { pb, api, errMsg, type Notice } from '../lib/pb'
import { fmtDay, fmtTime, sameDay, d } from '../lib/dates'
import { useData } from '../store'
import { Empty, Group, HeaderButton, Page, Row, Spinner, toast } from '../ui'

export default function Notices() {
  const { refreshUnread } = useData()
  const [list, setList] = useState<Notice[] | null>(null)
  const load = useCallback(async () => {
    const r = await pb.collection('notifications').getList<Notice>(1, 60, { sort: '-created' })
    setList(r.items)
  }, [])
  useEffect(() => {
    load().catch((e) => toast(errMsg(e), 'error'))
  }, [load])

  const open = async (n: Notice) => {
    if (!n.read) await pb.collection('notifications').update(n.id, { read: true }).catch(() => {})
    refreshUnread()
    if (n.link) location.hash = n.link
    else load()
  }
  const readAll = async () => {
    await api('/api/ch/notifications/read-all').catch((e) => toast(errMsg(e), 'error'))
    refreshUnread()
    load()
  }

  const when = (s: string) => (sameDay(d(s)!, new Date()) ? fmtTime(s) : fmtDay(s))
  const unread = (list || []).some((n) => !n.read)

  return (
    <Page title="Notifications" back={{ label: 'Back' }} actions={unread ? <HeaderButton text="Read All" label="Mark all as read" onClick={readAll} /> : undefined}>
      {!list ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Empty icon="bell" title="No Notifications" text="Schedule updates and requests will show up here." />
      ) : (
        <Group>
          {list.map((n) => (
            <Row
              key={n.id}
              onClick={() => open(n)}
              leading={<span className={`h-2.5 w-2.5 shrink-0 self-start rounded-full mt-2 ${n.read ? 'bg-transparent' : 'bg-ios-blue'}`} />}
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className={`text-[17px] leading-snug ${n.read ? '' : 'font-semibold'}`}>{n.title}</span>
                  <span className="shrink-0 text-[15px] text-ios-label2">{when(n.created)}</span>
                </span>
                {n.body && <span className="mt-0.5 block text-[15px] leading-snug text-ios-label2">{n.body}</span>}
              </span>
            </Row>
          ))}
        </Group>
      )}
    </Page>
  )
}
