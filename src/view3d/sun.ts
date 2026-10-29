import { Vector3 } from 'three'
import type { Compass } from '../model/home'

const RAD = Math.PI / 180

/** Sonnenstand in Radiant: Azimut im Uhrzeigersinn ab Norden, Höhe über dem Horizont. */
export interface SunPosition {
  azimuth: number
  elevation: number
}

/**
 * Sonnenstand nach dem Verfahren der NOAA (Genauigkeit etwa ein Zehntelgrad, ohne Refraktion).
 * {@code time} in ms UTC, Breite und Länge in Radiant (Osten positiv).
 */
export function sunPosition(time: number, latitude: number, longitude: number): SunPosition {
  // Julianisches Jahrhundert seit J2000
  const t = (time / 86400000 + 2440587.5 - 2451545) / 36525
  const meanLongitude = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360
  const meanAnomaly = (357.52911 + t * (35999.05029 - 0.0001537 * t)) * RAD
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
  const center =
    Math.sin(meanAnomaly) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * meanAnomaly) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * meanAnomaly) * 0.000289
  const omega = (125.04 - 1934.136 * t) * RAD
  const apparentLongitude = (meanLongitude + center - 0.00569 - 0.00478 * Math.sin(omega)) * RAD
  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
  const obliquity = (meanObliquity + 0.00256 * Math.cos(omega)) * RAD
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(apparentLongitude))

  // Zeitgleichung in Minuten
  const y = Math.tan(obliquity / 2) ** 2
  const l0 = meanLongitude * RAD
  const equationOfTime =
    (4 / RAD) *
    (y * Math.sin(2 * l0) -
      2 * eccentricity * Math.sin(meanAnomaly) +
      4 * eccentricity * y * Math.sin(meanAnomaly) * Math.cos(2 * l0) -
      0.5 * y * y * Math.sin(4 * l0) -
      1.25 * eccentricity * eccentricity * Math.sin(2 * meanAnomaly))

  const utcMinutes = ((time % 86400000) + 86400000) % 86400000 / 60000
  const solarMinutes = utcMinutes + equationOfTime + (4 * longitude) / RAD
  const hourAngle = (solarMinutes / 4 - 180) * RAD

  const elevation = Math.asin(
    Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle),
  )
  const azimuth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(latitude) - Math.tan(declination) * Math.cos(latitude),
  ) + Math.PI
  return { azimuth, elevation }
}

/**
 * Richtung zur Sonne in der Szene. Plan-x ist three.js-x, Plan-y ist three.js-z; Norden zeigt
 * bei northDirection 0 nach Plan-oben (−y), Osten dann nach rechts.
 */
export function sunDirection(compass: Compass, sun: SunPosition): Vector3 {
  const angle = compass.northDirection + sun.azimuth
  const horizontal = Math.cos(sun.elevation)
  return new Vector3(Math.sin(angle) * horizontal, Math.sin(sun.elevation), -Math.cos(angle) * horizontal)
}

/** Auf- und Untergang am Tag von {@code time} (Ortszeit der Zeitzone ist Sache der Anzeige); null bei Polartag/-nacht. */
export function sunriseSunset(compass: Compass, time: number): { sunrise: number; sunset: number } | null {
  // Grob in 10-Minuten-Schritten über den UTC-Tag um die Sonnenmittagszeit suchen, dann verfeinern
  const noon = solarNoon(time, compass.longitude)
  const above = (t: number) => sunPosition(t, compass.latitude, compass.longitude).elevation > -0.833 * RAD
  if (!above(noon) || above(noon - 12 * 3600000)) return null
  const edge = (from: number, to: number) => {
    // from ist unter, to über dem Horizont (oder umgekehrt); Bisektion auf eine Minute
    for (let i = 0; i < 20 && Math.abs(to - from) > 60000; i++) {
      const mid = (from + to) / 2
      if (above(mid) === above(to)) to = mid
      else from = mid
    }
    return to
  }
  return { sunrise: edge(noon - 12 * 3600000, noon), sunset: edge(noon + 12 * 3600000, noon) }
}

/** Ungefährer Sonnenmittag (UTC) am Tag von {@code time} in Sonnenzeit an diesem Längengrad. */
function solarNoon(time: number, longitude: number): number {
  // Sonnenzeit läuft der UTC je Grad Länge um vier Minuten voraus
  const offset = (longitude / RAD) * 240000
  const day = Math.floor((time + offset) / 86400000)
  return day * 86400000 + 43200000 - offset
}

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

/** Himmelsrichtung eines Azimuts als Schlüssel (N, NNE, …). */
export function compassPoint(azimuth: number): string {
  return POINTS[Math.round(((azimuth / RAD) % 360) / 22.5) % 16]
}

/** Datum und Minuten seit Mitternacht von {@code time} in der Zeitzone. */
export interface ZonedDate {
  year: number
  /** 1–12 */
  month: number
  day: number
  minutes: number
}

export function toZoned(time: number, timeZone: string): ZonedDate {
  const parts: Record<string, number> = {}
  for (const part of zoneFormat(timeZone).formatToParts(time)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value)
  }
  // „24“ steht in manchen Browsern für Mitternacht
  return { year: parts.year, month: parts.month, day: parts.day, minutes: (parts.hour % 24) * 60 + parts.minute }
}

/** Zeitpunkt (ms UTC) zu Datum und Uhrzeit in der Zeitzone. */
export function fromZoned({ year, month, day, minutes }: ZonedDate, timeZone: string): number {
  const wall = Date.UTC(year, month - 1, day, 0, minutes)
  // Abstand der Zeitzone zur UTC an dieser Stelle; zweimal, damit Sommerzeitwechsel stimmen
  let time = wall
  for (let i = 0; i < 2; i++) {
    const zoned = toZoned(time, timeZone)
    time += wall - Date.UTC(zoned.year, zoned.month - 1, zoned.day, 0, zoned.minutes)
  }
  return time
}

const formats = new Map<string, Intl.DateTimeFormat>()

function zoneFormat(timeZone: string): Intl.DateTimeFormat {
  let format = formats.get(timeZone)
  if (!format) {
    const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }
    try {
      format = new Intl.DateTimeFormat('en-US', { ...options, timeZone })
    } catch {
      // Unbekannte Zeitzone, z. B. aus einer fremden Datei
      format = new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' })
    }
    formats.set(timeZone, format)
  }
  return format
}
