import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useEditorStore } from '../store/editorStore'
import { useRenderQueue } from '../view3d/renderQueue'
import { useNotify } from './useNotify'

/** Shows a notice when an edit was rejected because photo renderings are pending, or one could not be stored. */
export function useRenderLockNotice() {
  const { t } = useTranslation()
  const notify = useNotify()
  const rejections = useEditorStore((s) => s.lockRejections)
  const seen = useRef(rejections)
  useEffect(() => {
    if (rejections === seen.current) return
    seen.current = rejections
    notify(t('renderQueue.locked'))
  }, [rejections, notify, t])
  const notSaved = useRenderQueue((s) => s.notSaved)
  const seenNotSaved = useRef(notSaved)
  useEffect(() => {
    if (notSaved === seenNotSaved.current) return
    seenNotSaved.current = notSaved
    notify(t('renderQueue.notSaved'))
  }, [notSaved, notify, t])
}
