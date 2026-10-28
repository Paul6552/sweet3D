import Checkbox from '@mui/material/Checkbox'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { dispatch, executeCommand, useEditorStore } from '../store/editorStore'

const format = (value: number) => (Math.round(value * 10) / 10).toLocaleString()

export function FurnitureListPanel() {
  const { t } = useTranslation()
  const furniture = useEditorStore((s) => s.home?.furniture ?? [])
  const selection = useEditorStore((s) => s.selection)

  if (furniture.length === 0) {
    return <Typography sx={{ p: 2 }} color="text.secondary">{t('furniture.empty')}</Typography>
  }

  return (
    <TableContainer sx={{ height: '100%' }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>{t('furniture.name')}</TableCell>
            <TableCell align="right">{t('furniture.width')}</TableCell>
            <TableCell align="right">{t('furniture.depth')}</TableCell>
            <TableCell align="right">{t('furniture.height')}</TableCell>
            <TableCell padding="checkbox">{t('furniture.visible')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {furniture.map((piece) => (
            <TableRow
              key={piece.id}
              hover
              selected={selection.includes(piece.id)}
              onClick={(e) =>
                dispatch({
                  type: 'select',
                  ids: e.ctrlKey || e.metaKey ? [...selection, piece.id] : [piece.id],
                })
              }
              sx={{ cursor: 'pointer' }}
            >
              <TableCell>{piece.name}</TableCell>
              <TableCell align="right">{format(piece.width)}</TableCell>
              <TableCell align="right">{format(piece.depth)}</TableCell>
              <TableCell align="right">{format(piece.height)}</TableCell>
              <TableCell padding="checkbox">
                <Checkbox
                  size="small"
                  checked={piece.visible}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    executeCommand({ type: 'updateFurniture', changes: [{ id: piece.id, visible: e.target.checked }] })
                  }
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
