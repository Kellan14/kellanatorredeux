import type { Metadata } from 'next'
import { VenuePinballPicker } from '@/components/venue-pinball-picker'

export const metadata: Metadata = {
  title: 'Virtual Machine Picker | TWC Stats',
  description: 'Race the machines at a venue and let virtual pinball choose what to play.',
}

export default function VirtualPickerPage() {
  return <VenuePinballPicker />
}
