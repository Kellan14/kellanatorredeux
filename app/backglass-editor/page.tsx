'use client'

import { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Upload, Download, Image as ImageIcon, RefreshCw, Check, X } from 'lucide-react'
import Link from 'next/link'
import { getMachineThumbnailPath } from '@/lib/machine-images'
import { authFetch } from '@/lib/auth-fetch'

interface Machine {
  key: string
  name: string
}

export default function BackglassEditorPage() {
  const [machines, setMachines] = useState<Machine[]>([])
  const [selectedMachine, setSelectedMachine] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [loading, setLoading] = useState(true)

  // Image states
  const [fullSizeUrl, setFullSizeUrl] = useState<string>('')
  const [thumbnailUrl, setThumbnailUrl] = useState<string>('')
  const [fullSizeError, setFullSizeError] = useState(false)
  const [thumbnailError, setThumbnailError] = useState(false)

  // Missing images state
  const [missingImages, setMissingImages] = useState<Machine[]>([])
  const [checkingImages, setCheckingImages] = useState(false)
  const [lastChecked, setLastChecked] = useState<string | null>(null)

  // New image states
  const [newImage, setNewImage] = useState<string | null>(null)
  const [newThumbnail, setNewThumbnail] = useState<string | null>(null)
  const [newImageName, setNewImageName] = useState<string>('')

  // Upload states
  const [uploading, setUploading] = useState(false)
  const [uploadMessage, setUploadMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Custom images from Supabase
  const [customImages, setCustomImages] = useState<Record<string, { full?: string; thumbnail?: string }>>({})

  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)

  // Load machines and custom images on mount
  useEffect(() => {
    loadMachines()
    loadCustomImages()
  }, [])

  const loadCustomImages = async () => {
    try {
      const response = await fetch('/api/upload-backglass')
      if (response.ok) {
        const data = await response.json()
        const imageMap: Record<string, { full?: string; thumbnail?: string }> = {}
        for (const img of data.images || []) {
          if (!imageMap[img.machine_key]) {
            imageMap[img.machine_key] = {}
          }
          if (img.image_type === 'full') {
            imageMap[img.machine_key].full = img.public_url
          } else if (img.image_type === 'thumbnail') {
            imageMap[img.machine_key].thumbnail = img.public_url
          }
        }
        setCustomImages(imageMap)
      }
    } catch (error) {
      console.error('Error loading custom images:', error)
    }
  }

  // Check for missing images after machines load
  useEffect(() => {
    if (machines.length > 0) {
      checkMissingImages()
    }
  }, [machines])

  // Update image URLs when machine changes
  useEffect(() => {
    if (selectedMachine) {
      const machine = machines.find(m => m.key === selectedMachine)
      if (machine) {
        // Check for custom uploaded images first
        const custom = customImages[machine.key]
        if (custom?.full) {
          setFullSizeUrl(custom.full)
        } else {
          setFullSizeUrl(`/opdb_backglass_images/${machine.key}.jpg`)
        }
        if (custom?.thumbnail) {
          setThumbnailUrl(custom.thumbnail)
        } else {
          setThumbnailUrl(`/opdb_backglass_images/thumbnails/${machine.key}.jpg`)
        }
        setFullSizeError(false)
        setThumbnailError(false)
        setNewImage(null)
        setNewThumbnail(null)
        setNewImageName(machine.key)
      }
    }
  }, [selectedMachine, machines, customImages])

  // Handle paste events
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return

      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            handleImageFile(file)
          }
          break
        }
      }
    }

    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [])

  const loadMachines = async () => {
    try {
      const response = await fetch('/api/machines')
      if (response.ok) {
        const data = await response.json()
        const machineList: Machine[] = Object.values(data).map((m: any) => ({
          key: m.key,
          name: m.name
        }))
        machineList.sort((a, b) => a.name.localeCompare(b.name))
        setMachines(machineList)
      }
    } catch (error) {
      console.error('Error loading machines:', error)
    } finally {
      setLoading(false)
    }
  }

  const checkMissingImages = async (forceLive = false) => {
    setCheckingImages(true)

    try {
      // Use server-side API to check missing images (reads actual files)
      const url = forceLive ? '/api/missing-images?refresh=true' : '/api/missing-images'
      const response = await fetch(url)

      if (response.ok) {
        const data = await response.json()
        setMissingImages(data.machines || [])
        setLastChecked(data.lastChecked)
      }
    } catch (error) {
      console.error('Error checking missing images:', error)
    } finally {
      setCheckingImages(false)
    }
  }

  const handleImageFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      setNewImage(dataUrl)
      setNewThumbnail(null)
    }
    reader.readAsDataURL(file)
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleImageFile(file)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('image/')) {
      handleImageFile(file)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const generateThumbnail = () => {
    const sourceImage = newImage || fullSizeUrl
    if (!sourceImage) return

    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // Target thumbnail width of 200px, maintain aspect ratio
      const targetWidth = 200
      const scale = targetWidth / img.width
      const targetHeight = img.height * scale

      canvas.width = targetWidth
      canvas.height = targetHeight

      ctx.drawImage(img, 0, 0, targetWidth, targetHeight)

      const thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.85)
      setNewThumbnail(thumbnailDataUrl)
    }
    img.src = sourceImage
  }

  const downloadImage = (dataUrl: string, filename: string) => {
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const downloadFullSize = () => {
    if (newImage) {
      downloadImage(newImage, `${newImageName}.jpg`)
    }
  }

  const downloadThumbnail = () => {
    if (newThumbnail) {
      downloadImage(newThumbnail, `${newImageName}.jpg`)
    }
  }

  // Compress image to reduce size before upload
  const compressImage = (dataUrl: string, maxWidth: number, quality: number): Promise<string> => {
    return new Promise((resolve) => {
      const img = new window.Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let width = img.width
        let height = img.height

        if (width > maxWidth) {
          height = (height * maxWidth) / width
          width = maxWidth
        }

        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.src = dataUrl
    })
  }

  const uploadImage = async (imageData: string, imageType: 'full' | 'thumbnail') => {
    if (!newImageName) {
      setUploadMessage({ type: 'error', text: 'Please enter a filename' })
      return
    }

    setUploading(true)
    setUploadMessage(null)

    try {
      // Compress image to stay under size limit
      const maxWidth = imageType === 'thumbnail' ? 200 : 800
      const quality = imageType === 'thumbnail' ? 0.8 : 0.85
      const compressedData = await compressImage(imageData, maxWidth, quality)

      // Upload via server API
      const response = await authFetch('/api/upload-backglass', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machineKey: newImageName,
          imageType,
          imageData: compressedData
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Upload failed')
      }

      setUploadMessage({ type: 'success', text: `${imageType === 'full' ? 'Full-size' : 'Thumbnail'} image uploaded successfully!` })

      // Refresh custom images and missing images check after successful upload
      await loadCustomImages()
      if (imageType === 'thumbnail') {
        checkMissingImages(true)
      }
    } catch (error) {
      setUploadMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to upload image' })
    } finally {
      setUploading(false)
    }
  }

  const uploadBothImages = async () => {
    if (!newImage) return

    // Generate thumbnail if not already done
    if (!newThumbnail) {
      setUploadMessage({ type: 'error', text: 'Please generate a thumbnail first' })
      return
    }

    if (!newImageName) {
      setUploadMessage({ type: 'error', text: 'Please enter a filename' })
      return
    }

    setUploading(true)
    setUploadMessage(null)

    try {
      // Compress full size image
      const compressedFull = await compressImage(newImage, 800, 0.85)

      // Upload full size
      const fullResponse = await authFetch('/api/upload-backglass', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machineKey: newImageName,
          imageType: 'full',
          imageData: compressedFull
        })
      })

      if (!fullResponse.ok) {
        const result = await fullResponse.json()
        throw new Error(result.error || 'Full-size upload failed')
      }

      // Upload thumbnail (already small)
      const thumbResponse = await authFetch('/api/upload-backglass', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machineKey: newImageName,
          imageType: 'thumbnail',
          imageData: newThumbnail
        })
      })

      if (!thumbResponse.ok) {
        const result = await thumbResponse.json()
        throw new Error(result.error || 'Thumbnail upload failed')
      }

      setUploadMessage({ type: 'success', text: 'Both images uploaded successfully!' })
      await loadCustomImages()
      checkMissingImages(true)
    } catch (error) {
      setUploadMessage({ type: 'error', text: error instanceof Error ? error.message : 'Upload failed' })
    } finally {
      setUploading(false)
    }
  }

  const filteredMachines = machines.filter(m =>
    m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.key.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const selectedMachineData = machines.find(m => m.key === selectedMachine)

  return (
    <div className="container py-8 px-4 md:px-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-2">
          <Link href="/options" className="text-muted-foreground hover:text-foreground">
            &larr; Back to Options
          </Link>
        </div>
        <h1 className="text-4xl font-bold mb-2">Backglass Editor</h1>
        <p className="text-muted-foreground text-lg">
          View, upload, and generate thumbnails for machine backglass images
        </p>
      </div>

      {/* Machine Selector */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Select Machine</CardTitle>
          <CardDescription>Choose a machine to view or edit its backglass image</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative w-full md:w-96">
            <Input
              type="text"
              placeholder="Search machines..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setShowDropdown(true)
              }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
            />
            {showDropdown && filteredMachines.length > 0 && (
              <div className="absolute z-10 w-full mt-1 max-h-60 overflow-y-auto bg-background border rounded-md shadow-lg">
                {filteredMachines.slice(0, 50).map(machine => (
                  <button
                    key={machine.key}
                    className="w-full px-3 py-2 text-left hover:bg-muted flex justify-between items-center"
                    onMouseDown={() => {
                      setSelectedMachine(machine.key)
                      setSearchQuery(machine.name)
                      setShowDropdown(false)
                    }}
                  >
                    <span>{machine.name}</span>
                    <span className="text-xs text-muted-foreground">{machine.key}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {selectedMachineData && (
            <p className="mt-2 text-sm text-muted-foreground">
              Selected: <span className="font-medium">{selectedMachineData.name}</span> ({selectedMachineData.key})
            </p>
          )}
        </CardContent>
      </Card>

      {/* Missing Images */}
      {missingImages.length > 0 && (
        <Card className="mb-8 border-yellow-500/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-yellow-500">
                <X className="h-5 w-5" />
                Machines Missing Thumbnails ({missingImages.length})
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => checkMissingImages(true)}
                disabled={checkingImages}
              >
                <RefreshCw className={`h-4 w-4 mr-1 ${checkingImages ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
            <CardDescription>
              These machines don't have thumbnail images and will show AFM as fallback
              {lastChecked && (
                <span className="block mt-1 text-xs">
                  Last checked: {new Date(lastChecked).toLocaleString()}
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {missingImages.map(machine => (
                <Button
                  key={machine.key}
                  variant="outline"
                  size="sm"
                  className="border-yellow-500/30 hover:border-yellow-500"
                  onClick={() => {
                    setSelectedMachine(machine.key)
                    setSearchQuery(machine.name)
                  }}
                >
                  {machine.name}
                  <span className="ml-1 text-xs text-muted-foreground">({machine.key})</span>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {checkingImages && (
        <Card className="mb-8">
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              Checking for missing images...
            </p>
          </CardContent>
        </Card>
      )}

      {!checkingImages && missingImages.length === 0 && machines.length > 0 && (
        <Card className="mb-8 border-green-500/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-green-500">
                <Check className="h-5 w-5" />
                All Images Found
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => checkMissingImages(true)}
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                Refresh
              </Button>
            </div>
            <CardDescription>
              All {machines.length} machines have thumbnail images
              {lastChecked && (
                <span className="block mt-1 text-xs">
                  Last checked: {new Date(lastChecked).toLocaleString()}
                </span>
              )}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {selectedMachine && (
        <>
          {/* Current Images */}
          <Card className="mb-8">
            <CardHeader>
              <CardTitle>Current Images</CardTitle>
              <CardDescription>Existing backglass images for {selectedMachineData?.name}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Full Size */}
                <div>
                  <Label className="mb-2 block">Full Size</Label>
                  <div className="border rounded-lg overflow-hidden bg-slate-900 aspect-[3/4] flex items-center justify-center">
                    {!fullSizeError ? (
                      <img
                        src={fullSizeUrl}
                        alt={`${selectedMachineData?.name} backglass`}
                        className="max-w-full max-h-full object-contain"
                        onError={() => setFullSizeError(true)}
                      />
                    ) : (
                      <div className="text-center text-muted-foreground p-4">
                        <X className="h-12 w-12 mx-auto mb-2 opacity-50" />
                        <p>No full-size image found</p>
                        <p className="text-xs mt-1">{fullSizeUrl}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Thumbnail */}
                <div>
                  <Label className="mb-2 block">Thumbnail (200px wide)</Label>
                  <div className="border rounded-lg overflow-hidden bg-slate-900 aspect-[3/4] flex items-center justify-center">
                    {!thumbnailError ? (
                      <img
                        src={thumbnailUrl}
                        alt={`${selectedMachineData?.name} thumbnail`}
                        className="max-w-full max-h-full object-contain"
                        onError={() => setThumbnailError(true)}
                      />
                    ) : (
                      <div className="text-center text-muted-foreground p-4">
                        <X className="h-12 w-12 mx-auto mb-2 opacity-50" />
                        <p>No thumbnail found</p>
                        <p className="text-xs mt-1">{thumbnailUrl}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Upload New Image */}
          <Card className="mb-8">
            <CardHeader>
              <CardTitle>Upload New Image</CardTitle>
              <CardDescription>
                Upload a new backglass image or paste from clipboard (Cmd/Ctrl+V)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                ref={dropZoneRef}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-lg mb-2">Drop image here, click to upload, or paste</p>
                <p className="text-sm text-muted-foreground">Supports JPG, PNG, WebP</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </div>

              {/* Filename input */}
              <div className="mt-4">
                <Label htmlFor="filename">Output Filename (without extension)</Label>
                <Input
                  id="filename"
                  value={newImageName}
                  onChange={(e) => setNewImageName(e.target.value)}
                  placeholder="e.g., ALIEN"
                  className="mt-1 w-full md:w-64"
                />
              </div>
            </CardContent>
          </Card>

          {/* New Image Preview */}
          {newImage && (
            <Card className="mb-8">
              <CardHeader>
                <CardTitle>New Image Preview</CardTitle>
                <CardDescription>Preview and generate thumbnail</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* New Full Size */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label>New Full Size</Label>
                      <Button size="sm" variant="outline" onClick={downloadFullSize}>
                        <Download className="h-4 w-4 mr-1" />
                        Download
                      </Button>
                    </div>
                    <div className="border rounded-lg overflow-hidden bg-slate-900 aspect-[3/4] flex items-center justify-center">
                      <img
                        src={newImage}
                        alt="New backglass"
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Save to: public/opdb_backglass_images/{newImageName}.jpg
                    </p>
                  </div>

                  {/* New Thumbnail */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label>Generated Thumbnail</Label>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={generateThumbnail}>
                          <RefreshCw className="h-4 w-4 mr-1" />
                          Generate
                        </Button>
                        {newThumbnail && (
                          <Button size="sm" variant="outline" onClick={downloadThumbnail}>
                            <Download className="h-4 w-4 mr-1" />
                            Download
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="border rounded-lg overflow-hidden bg-slate-900 aspect-[3/4] flex items-center justify-center">
                      {newThumbnail ? (
                        <img
                          src={newThumbnail}
                          alt="Generated thumbnail"
                          className="max-w-full max-h-full object-contain"
                        />
                      ) : (
                        <div className="text-center text-muted-foreground p-4">
                          <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
                          <p>Click "Generate" to create thumbnail</p>
                        </div>
                      )}
                    </div>
                    {newThumbnail && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Save to: public/opdb_backglass_images/thumbnails/{newImageName}.jpg
                      </p>
                    )}
                  </div>
                </div>

                {/* Upload buttons */}
                <div className="mt-6 p-4 bg-muted rounded-lg">
                  <h4 className="font-medium mb-4">Upload Images</h4>

                  {uploadMessage && (
                    <div className={`mb-4 p-3 rounded-lg ${uploadMessage.type === 'success' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
                      {uploadMessage.text}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3">
                    <Button
                      onClick={uploadBothImages}
                      disabled={uploading || !newImage || !newThumbnail}
                      className="bg-primary"
                    >
                      {uploading ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4 mr-2" />
                          Upload Both Images
                        </>
                      )}
                    </Button>

                    <Button
                      variant="outline"
                      onClick={() => newImage && uploadImage(newImage, 'full')}
                      disabled={uploading || !newImage}
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Upload Full Size Only
                    </Button>

                    <Button
                      variant="outline"
                      onClick={() => newThumbnail && uploadImage(newThumbnail, 'thumbnail')}
                      disabled={uploading || !newThumbnail}
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Upload Thumbnail Only
                    </Button>
                  </div>

                  <p className="text-xs text-muted-foreground mt-4">
                    Images will be stored in cloud storage and immediately available on the site.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Generate from existing */}
          {!newImage && !thumbnailError && fullSizeError && (
            <Card className="mb-8">
              <CardContent className="pt-6">
                <p className="text-muted-foreground">
                  No full-size image exists. Upload a new image above to get started.
                </p>
              </CardContent>
            </Card>
          )}

          {!newImage && !fullSizeError && thumbnailError && (
            <Card className="mb-8">
              <CardHeader>
                <CardTitle>Generate Missing Thumbnail</CardTitle>
                <CardDescription>
                  A full-size image exists but no thumbnail. Generate one from the full-size image.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={generateThumbnail}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Generate Thumbnail from Full Size
                </Button>

                {newThumbnail && (
                  <div className="mt-4">
                    {uploadMessage && (
                      <div className={`mb-4 p-3 rounded-lg ${uploadMessage.type === 'success' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
                        {uploadMessage.text}
                      </div>
                    )}

                    <div className="flex items-center justify-between mb-2">
                      <Label>Generated Thumbnail</Label>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => uploadImage(newThumbnail, 'thumbnail')}
                          disabled={uploading}
                        >
                          {uploading ? (
                            <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                          ) : (
                            <Upload className="h-4 w-4 mr-1" />
                          )}
                          Upload
                        </Button>
                        <Button size="sm" variant="outline" onClick={downloadThumbnail}>
                          <Download className="h-4 w-4 mr-1" />
                          Download
                        </Button>
                      </div>
                    </div>
                    <div className="border rounded-lg overflow-hidden bg-slate-900 w-48 aspect-[3/4] flex items-center justify-center">
                      <img
                        src={newThumbnail}
                        alt="Generated thumbnail"
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {!selectedMachine && !loading && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              Select a machine above to view and edit its backglass image
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
