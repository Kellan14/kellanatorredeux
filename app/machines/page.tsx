'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search, Heart, Info } from 'lucide-react'
import { getMachineImagePath, getMachineThumbnailPath } from '@/lib/machine-images'
import machinesData from '@/mnp-data-archive/machines.json'

interface Machine {
  key: string
  name: string
  image: string
  thumbnail: string
}

// Convert machines.json to array
const machinesArray: Machine[] = Object.values(machinesData).map((machine: any) => ({
  key: machine.key,
  name: machine.name,
  image: getMachineImagePath(machine.key, machine.name),
  thumbnail: getMachineThumbnailPath(machine.key, machine.name),
}))

export default function MachinesPage() {
  const [searchTerm, setSearchTerm] = useState('')
  const [favorites, setFavorites] = useState<string[]>([])

  const filteredMachines = machinesArray.filter(machine =>
    machine.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    machine.key.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const toggleFavorite = (machineKey: string) => {
    setFavorites(prev =>
      prev.includes(machineKey)
        ? prev.filter(key => key !== machineKey)
        : [...prev, machineKey]
    )
  }

  return (
    <div className="container py-8 px-4 md:px-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">Pinball Machines</h1>
        <p className="text-muted-foreground text-lg">
          Browse and track your favorite machines
        </p>
      </div>

      {/* Search Bar */}
      <div className="mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            type="text"
            placeholder="Search machines..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Machine Grid */}
      <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-2 md:gap-4">
        {filteredMachines.map((machine) => (
          <Link key={machine.key} href={`/machines/${encodeURIComponent(machine.name)}`}>
            <Card className="overflow-hidden hover:shadow-lg transition-all hover:scale-105 cursor-pointer">
              <div className="relative aspect-[3/4] bg-gradient-to-br from-slate-800 to-slate-900">
                <Image
                  src={machine.thumbnail}
                  alt={machine.name}
                  fill
                  className="object-cover"
                  sizes="(max-width: 640px) 25vw, (max-width: 768px) 20vw, (max-width: 1024px) 16vw, (max-width: 1280px) 14vw, 12vw"
                  onError={(e) => {
                    // Fallback to AFM thumbnail if image fails to load
                    const target = e.target as HTMLImageElement
                    target.src = '/opdb_backglass_images/thumbnails/AFM.jpg'
                  }}
                />

                {/* Favorite button */}
                <button
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    toggleFavorite(machine.key)
                  }}
                  className="absolute top-1 right-1 md:top-2 md:right-2 p-1 md:p-2 rounded-full bg-black/50 backdrop-blur-sm hover:bg-black/70 transition-colors z-10"
                >
                  <Heart
                    className={`h-3 w-3 md:h-5 md:w-5 ${
                      favorites.includes(machine.key)
                        ? 'fill-neon-pink text-neon-pink'
                        : 'text-white'
                    }`}
                  />
                </button>
              </div>

              <CardContent className="p-1 md:p-3">
                <h3 className="font-semibold text-[10px] md:text-sm lg:text-base mb-0.5 md:mb-1 line-clamp-2">
                  {machine.name}
                </h3>
                <p className="text-[8px] md:text-xs text-muted-foreground hidden md:block">
                  {machine.key}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Empty state */}
      {filteredMachines.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No machines found matching "{searchTerm}"</p>
        </div>
      )}
    </div>
  )
}
