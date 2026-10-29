import Box from '@mui/material/Box'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import TextField from '@mui/material/TextField'
import { Fragment, useState, type ReactNode } from 'react'
import type { Surface } from '../model/home'
import { SurfaceEditor } from './SurfaceEditor'

/**
 * Ein Feld eines Eigenschaftsdialogs für mehrere Objekte zugleich. Haben die Objekte
 * verschiedene Werte, bleibt das Feld leer und ändert nur etwas, wenn man es ausfüllt.
 */
export interface Field<T> {
  node: ReactNode
  valid: boolean
  dirty: boolean
  /** Trägt den neuen Wert in die Änderung für ein Objekt ein. */
  apply: (change: Partial<T>, item: T) => void
}

/** Gemeinsamer Wert aller Objekte oder {@code undefined}, wenn sie sich unterscheiden. */
export function sharedValue<T, V>(items: T[], get: (item: T) => V): V | undefined {
  if (items.length === 0) return undefined
  const first = JSON.stringify(get(items[0]))
  return items.every((item) => JSON.stringify(get(item)) === first) ? get(items[0]) : undefined
}

/** Änderungen je Objekt aus allen geänderten Feldern; Objekte ohne Änderung fallen weg. */
export function collectChanges<T extends { id: string }>(items: T[], fields: Field<T>[]): (Partial<T> & { id: string })[] {
  const dirty = fields.filter((f) => f.dirty)
  if (dirty.length === 0) return []
  return items.map((item) => {
    const change = { id: item.id } as Partial<T> & { id: string }
    for (const field of dirty) field.apply(change, item)
    return change
  })
}

const round = (value: number) => String(Math.round(value * 10) / 10)
const parse = (text: string) => Number.parseFloat(text.replace(',', '.'))

interface NumberOptions {
  unit?: string
  /** Leeres Feld bedeutet {@code null} (z. B. Wandhöhe = Höhe der Ebene). */
  nullable?: boolean
  placeholder?: string
  min?: number
  /** Nur Werte größer als {@code min}. */
  exclusiveMin?: boolean
  /** Umrechnung für die Anzeige, z. B. Radiant ↔ Grad. */
  toDisplay?: (value: number) => number
  fromDisplay?: (value: number) => number
}

export const degrees: Pick<NumberOptions, 'unit' | 'toDisplay' | 'fromDisplay'> = {
  unit: '°',
  toDisplay: (rad) => (((Math.round((rad * 180) / Math.PI) % 360) + 360) % 360),
  fromDisplay: (deg) => (deg * Math.PI) / 180,
}

export function useNumberField<T>(
  items: T[],
  label: string,
  get: (item: T) => number | null,
  set: (change: Partial<T>, value: number | null, item: T) => void,
  options: NumberOptions = {},
): Field<T> {
  const { unit = 'cm', nullable = false, min, exclusiveMin = false, toDisplay = (v) => v, fromDisplay = (v) => v } = options
  const shared = sharedValue(items, get)
  const [initial] = useState(() => (shared === undefined || shared === null ? '' : round(toDisplay(shared))))
  const [text, setText] = useState(initial)
  const dirty = text.trim() !== initial
  const value = parse(text)
  const empty = text.trim() === ''
  const valid =
    !dirty ||
    (empty ? nullable : Number.isFinite(value) && (min === undefined || (exclusiveMin ? value > min : value >= min)))
  return {
    dirty,
    valid,
    apply: (change, item) => set(change, empty ? null : fromDisplay(value), item),
    node: (
      <TextField
        size="small"
        label={label}
        value={text}
        error={!valid}
        placeholder={shared === undefined && items.length > 1 ? '–' : options.placeholder}
        onChange={(e) => setText(e.target.value)}
        slotProps={{ htmlInput: { inputMode: 'decimal' }, input: { endAdornment: unit }, inputLabel: { shrink: true } }}
      />
    ),
  }
}

export function useTextField<T>(
  items: T[],
  label: string,
  get: (item: T) => string | null,
  set: (change: Partial<T>, value: string) => void,
  options: { multiline?: boolean; required?: boolean; autoFocus?: boolean } = {},
): Field<T> {
  const shared = sharedValue(items, get)
  const [initial] = useState(() => shared ?? '')
  const [text, setText] = useState(initial)
  const dirty = text !== initial
  const valid = !options.required || !dirty || text.trim() !== ''
  return {
    dirty,
    valid,
    apply: (change) => set(change, text),
    node: (
      <TextField
        size="small"
        fullWidth
        label={label}
        value={text}
        error={!valid}
        multiline={options.multiline}
        minRows={options.multiline ? 2 : undefined}
        autoFocus={options.autoFocus}
        placeholder={shared === undefined && items.length > 1 ? '–' : undefined}
        onChange={(e) => setText(e.target.value)}
        slotProps={{ inputLabel: { shrink: true } }}
      />
    ),
  }
}

export function useCheckField<T>(items: T[], label: string, get: (item: T) => boolean, set: (change: Partial<T>, value: boolean) => void): Field<T> {
  const shared = sharedValue(items, get)
  const [checked, setChecked] = useState<boolean | undefined>(shared)
  return {
    dirty: checked !== shared,
    valid: true,
    apply: (change) => set(change, checked!),
    node: (
      <FormControlLabel
        control={<Checkbox size="small" checked={checked ?? false} indeterminate={checked === undefined} onChange={(e) => setChecked(e.target.checked)} />}
        label={label}
      />
    ),
  }
}

export function useSurfaceField<T>(
  items: T[],
  label: string,
  get: (item: T) => Surface,
  set: (change: Partial<T>, value: Surface) => void,
  options: { textures?: boolean } = {},
): Field<T> {
  const shared = sharedValue(items, get)
  const [surface, setSurface] = useState<Surface | undefined>(shared)
  return {
    dirty: surface !== shared,
    valid: true,
    apply: (change) => set(change, surface!),
    node: <SurfaceEditor label={label} value={surface} onChange={setSurface} textures={options.textures ?? true} />,
  }
}

export const DEFAULT_SURFACE: Surface = { color: null, texture: null }

/** Felder nebeneinander im Raster bzw. über die ganze Breite (siehe layout.tsx). */
export const wide = <T,>(fields: Field<T>[]) =>
  fields.map((f, i) => (
    <Box key={i} sx={{ gridColumn: '1 / -1' }}>
      {f.node}
    </Box>
  ))

export const show = <T,>(fields: Field<T>[]) => fields.map((f, i) => <Fragment key={i}>{f.node}</Fragment>)

