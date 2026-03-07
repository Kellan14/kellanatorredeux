export default function HeatmapLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 bg-gray-900">
      {children}
    </div>
  )
}
