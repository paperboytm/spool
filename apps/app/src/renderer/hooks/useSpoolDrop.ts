import { useCallback, useRef, useState, type DragEvent } from 'react'

type Options = {
  enabled: boolean
  onImport: (file: File) => void | Promise<void>
  onReject?: (files: File[]) => void
}

export function useSpoolDrop({ enabled, onImport, onReject }: Options) {
  const [isDragActive, setIsDragActive] = useState(false)
  // dragenter / dragleave fire per nested element; depth counter tells
  // us when the drag has truly left the target.
  const depthRef = useRef(0)

  const isFileDrag = (event: DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files')

  const onDragEnter = useCallback(
    (event: DragEvent) => {
      if (!enabled || !isFileDrag(event)) return
      event.preventDefault()
      depthRef.current += 1
      setIsDragActive(true)
    },
    [enabled],
  )

  const onDragOver = useCallback(
    (event: DragEvent) => {
      if (!enabled || !isFileDrag(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    },
    [enabled],
  )

  const onDragLeave = useCallback(
    (event: DragEvent) => {
      if (!enabled || !isFileDrag(event)) return
      event.preventDefault()
      depthRef.current = Math.max(0, depthRef.current - 1)
      if (depthRef.current === 0) setIsDragActive(false)
    },
    [enabled],
  )

  const onDrop = useCallback(
    (event: DragEvent) => {
      if (!enabled || !isFileDrag(event)) return
      event.preventDefault()
      depthRef.current = 0
      setIsDragActive(false)
      const files = Array.from(event.dataTransfer?.files ?? [])
      const spool = files.find((f) => f.name.toLowerCase().endsWith('.spool'))
      if (spool) void onImport(spool)
      else if (files.length > 0) onReject?.(files)
    },
    [enabled, onImport, onReject],
  )

  return {
    isDragActive,
    dragHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  }
}
