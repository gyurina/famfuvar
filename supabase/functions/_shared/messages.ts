/** Push copy — a nevezéktan mondatsablonjai. Egyetlen forrás a edge functionöknek. */

const WEEKDAY_ON = ['vasárnap', 'hétfőn', 'kedden', 'szerdán', 'csütörtökön', 'pénteken', 'szombaton']
const WEEKDAY = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat']

function parseDate(iso: string): Date {
  return new Date(iso.includes('T') ? iso : iso + 'T12:00:00')
}

export function weekdayOn(isoDate: string): string {
  return WEEKDAY_ON[parseDate(isoDate).getDay()]
}

export function weekdayBare(isoDate: string): string {
  return WEEKDAY[parseDate(isoDate).getDay()]
}

export function timeHm(t: string | null | undefined): string {
  return t?.slice(0, 5) ?? ''
}

export function assignedToDriver(opts: {
  childAcc: string
  inbound: boolean
  title: string
  onDate: string
  time: string
}): { title: string; body: string } {
  const place = opts.title.toLowerCase()
  const when = `${weekdayOn(opts.onDate)} ${opts.time}`
  const body = opts.inbound
    ? `Rád osztottuk: ${opts.childAcc} begyűjtöd a ${place}ból, ${when}.`
    : `Rád osztottuk: ${opts.childAcc} viszed a ${place}ba, ${when}.`
  return { title: opts.title, body }
}

export function claimedByDriver(opts: {
  driver: string
  childAcc: string
  inbound: boolean
  title: string
  onDate: string
  time: string
}): { title: string; body: string } {
  const place = opts.title.toLowerCase()
  const when = `${weekdayOn(opts.onDate)} ${opts.time}`
  const body = opts.inbound
    ? `${opts.driver} vállalta: ${opts.childAcc} begyűjti a ${place}ból, ${when}.`
    : `${opts.driver} vállalta: ${opts.childAcc} viszi a ${place}ba, ${when}.`
  return { title: opts.title, body }
}

export function releasedByDriver(opts: {
  driver: string
  child: string
  onDate: string
  time: string
}): { title: string; body: string } {
  return {
    title: opts.child,
    body: `${opts.driver} nem tudja vállalni: ${opts.child}, ${weekdayBare(opts.onDate)} ${opts.time}. Kell valaki más.`,
  }
}

export function mergedRides(opts: {
  names: string
  inbound: boolean
  onDate: string
  time: string
}): { title: string; body: string } {
  const who = opts.names
  const when = `${weekdayOn(opts.onDate)} ${opts.time}-tól`
  const body = opts.inbound
    ? `Módosult: ${who} is te gyűjtöd be, ${when}.`
    : `Módosult: ${who} is te viszed, ${when}.`
  return { title: 'Fuvar', body }
}

export function cancelledRide(opts: {
  child: string
  title: string
  onDate: string
  time: string
}): { title: string; body: string } {
  return {
    title: opts.title,
    body: `Elmarad: ${opts.child} ${opts.title.toLowerCase()}, ${weekdayBare(opts.onDate)}. A ${opts.time}-as fuvarod törlődött.`,
  }
}

export function timeChanged(opts: {
  child: string
  title: string
  onDate: string
  oldTime: string
  newTime: string
}): { title: string; body: string } {
  return {
    title: opts.title,
    body: `Módosult: ${opts.child} ${opts.title.toLowerCase()}, ${weekdayBare(opts.onDate)} ${opts.oldTime} → ${opts.newTime}.`,
  }
}

export function breakCancelled(opts: {
  child: string
  until: string
  n: number
}): { title: string; body: string } {
  const n = opts.n === 1 ? '1 fuvarod törlődött' : `${opts.n} fuvarod törlődött`
  return {
    title: opts.child,
    body: `${opts.child} ${opts.until}-ig beteg. ${n}.`,
  }
}

export function reminder(opts: {
  childAcc: string
  inbound: boolean
  title: string
  time: string
}): { title: string; body: string } {
  const place = opts.title.toLowerCase()
  const body = opts.inbound
    ? `30 perc: ${opts.childAcc} begyűjtöd a ${place}ból. Indulás ${opts.time}.`
    : `30 perc: ${opts.childAcc} viszed a ${place}ba. Indulás ${opts.time}.`
  return { title: opts.title, body }
}

export function urgentOpen(n: number): { title: string; body: string } {
  return {
    title: 'Fuvar',
    body: n === 1 ? 'Holnap egy fuvarra nincs sofőr.' : `Holnap ${n} fuvarra nincs sofőr.`,
  }
}
