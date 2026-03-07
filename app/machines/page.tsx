'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search, Heart, Info } from 'lucide-react'
import { getMachineImagePath, getMachineThumbnailPath } from '@/lib/machine-images'

interface Machine {
  key: string
  name: string
  image: string
  thumbnail: string
}

interface NextMatch {
  venue: string
  opponent: string
  week: number
  season: number
  machines: string[]
}

export default function MachinesPage() {
  const [searchTerm, setSearchTerm] = useState('')
  const [favorites, setFavorites] = useState<string[]>([])
  const [machinesData, setMachinesData] = useState<Record<string, any>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [nextMatch, setNextMatch] = useState<NextMatch | null>(null)
  const [filterByVenue, setFilterByVenue] = useState(false)

  // Fetch machines data and next match info
  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true)
        const [machinesRes, matchRes, venuesRes] = await Promise.all([
          fetch('/api/machines'),
          fetch('/api/latest-twc-match'),
          fetch('/api/venues')
        ])
        const machinesJson = await machinesRes.json()
        setMachinesData(machinesJson)

        if (matchRes.ok && venuesRes.ok) {
          const matchData = await matchRes.json()
          const venuesData = await venuesRes.json()
          const venue = (venuesData.venues || []).find((v: any) => v.name === matchData.venue)
          if (matchData.venue && venue) {
            setNextMatch({
              venue: matchData.venue,
              opponent: matchData.opponent || '',
              week: matchData.week,
              season: matchData.season,
              machines: venue.machines || []
            })
          }
        }
      } catch (error) {
        console.error('Error fetching data:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [])

  // Convert machines.json to array, using custom images if available
  const machinesArray: Machine[] = Object.values(machinesData).map((machine: any) => ({
    key: machine.key,
    name: machine.name,
    image: machine.customImage || getMachineImagePath(machine.key, machine.name),
    thumbnail: machine.customThumbnail || getMachineThumbnailPath(machine.key, machine.name),
  }))

  const filteredMachines = machinesArray
    .filter(machine => {
      const matchesSearch = machine.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        machine.key.toLowerCase().includes(searchTerm.toLowerCase())
      if (!matchesSearch) return false
      if (filterByVenue && nextMatch) {
        return nextMatch.machines.some(m =>
          m.toLowerCase() === machine.key.toLowerCase() ||
          m.toLowerCase() === machine.name.toLowerCase()
        )
      }
      return true
    })
    .sort((a, b) => a.name.localeCompare(b.name))

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

      {/* Search Bar and Venue Filter */}
      <div className="mb-6 flex flex-col sm:flex-row gap-3">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            type="text"
            placeholder="Search machines..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        {nextMatch && (
          <button
            onClick={() => setFilterByVenue(!filterByVenue)}
            className={`
              px-4 py-2 text-sm rounded-md border transition-colors whitespace-nowrap
              ${filterByVenue
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-foreground border-border hover:bg-muted'}
            `}
          >
            {filterByVenue ? `Showing ${nextMatch.venue}` : `Show only ${nextMatch.venue}`}
          </button>
        )}
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">Loading machines...</p>
        </div>
      )}

      {/* Machine Grid */}
      {!isLoading && (
        <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-2 md:gap-4">
        {filteredMachines.map((machine) => (
          <Link key={machine.key} href={`/machines/${encodeURIComponent(machine.name)}${filterByVenue && nextMatch ? `?venue=${encodeURIComponent(nextMatch.venue)}` : ''}`}>
            <Card className="overflow-hidden hover:shadow-lg transition-all hover:scale-105 cursor-pointer">
              <div className="relative aspect-[3/4] bg-gradient-to-br from-slate-800 to-slate-900">
                <Image
                  src={machine.thumbnail}
                  alt={machine.name}
                  fill
                  className="object-cover"
                  sizes="(max-width: 640px) 25vw, (max-width: 768px) 20vw, (max-width: 1024px) 16vw, (max-width: 1280px) 14vw, 12vw"
                  unoptimized
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
      )}

      {/* Empty state */}
      {!isLoading && filteredMachines.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No machines found matching "{searchTerm}"</p>
        </div>
      )}
    </div>
  )
}
