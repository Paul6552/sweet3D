import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useEditorStore } from '../store/editorStore'
import { useNotify } from './useNotify'

/** Shows a notice when an edit was rejected because photo renderings are pending. */
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
}
