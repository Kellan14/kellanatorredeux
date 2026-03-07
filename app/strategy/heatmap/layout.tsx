export default function HeatmapLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen z-50 bg-gray-900 overflow-auto">
      {children}
    </div>
  )
}
