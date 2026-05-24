import { MeetingsTab } from './MeetingsTab'

interface MemoryLibraryPanelProps {
  open: boolean
  onClose: () => void
}

export function MemoryLibraryPanel({ open, onClose }: MemoryLibraryPanelProps) {
  return <MeetingsTab open={open} onClose={onClose} />
}
