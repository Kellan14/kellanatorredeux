import MachineDetail from '@/components/machine-detail'
import { getMachineCanon, resolveWithIndex, displayWithIndex } from '@/lib/machines-canon'

export default async function MachinePage({ params }: { params: Promise<{ machine: string }> }) {
  const { machine: requestedMachine } = await params
  const canon = await getMachineCanon()
  const machine = decodeURIComponent(requestedMachine)
  const machineKey = resolveWithIndex(canon, machine) ?? machine

  return <MachineDetail key={machineKey} machineKey={machineKey} machineName={displayWithIndex(canon, machineKey)} />
}
