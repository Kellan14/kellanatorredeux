import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
// Use service role key for server-side uploads (bypasses RLS)
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request)
    if (!auth.ok) return auth.response

    if (!supabaseKey) {
      return NextResponse.json({ error: 'Server not configured for uploads' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    const body = await request.json()
    const { machineKey, imageType, imageData } = body

    if (!machineKey || !imageType || !imageData) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Sanitize machineKey — it becomes part of the storage path, so reject
    // anything outside a safe slug charset to prevent path traversal.
    if (!/^[a-z0-9_-]+$/i.test(machineKey)) {
      return NextResponse.json({ error: 'Invalid machineKey' }, { status: 400 })
    }
    if (imageType !== 'thumbnail' && imageType !== 'full') {
      return NextResponse.json({ error: 'Invalid imageType' }, { status: 400 })
    }

    // Convert base64 data URL to buffer
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')

    // Determine the path based on image type
    const path = imageType === 'thumbnail'
      ? `thumbnails/${machineKey}.jpg`
      : `${machineKey}.jpg`

    // Upload to Supabase Storage using service role (bypasses policies)
    const { data, error } = await supabase.storage
      .from('backglass-images')
      .upload(path, buffer, {
        contentType: 'image/jpeg',
        upsert: true
      })

    if (error) {
      console.error('Upload error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Get the public URL with cache-busting parameter
    const { data: urlData } = supabase.storage
      .from('backglass-images')
      .getPublicUrl(path)

    const cacheBustedUrl = `${urlData.publicUrl}?t=${Date.now()}`

    // Record in database (using service role bypasses RLS)
    const { error: dbError } = await supabase.from('custom_backglass_images').upsert({
      machine_key: machineKey,
      image_type: imageType,
      storage_path: path,
      public_url: cacheBustedUrl,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'machine_key,image_type'
    })

    if (dbError) {
      console.error('Database error:', dbError)
      // Still return success since image uploaded
    }

    return NextResponse.json({
      success: true,
      path: data.path,
      publicUrl: cacheBustedUrl
    })
  } catch (error) {
    console.error('Error uploading image:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET endpoint to check which machines have custom images
export async function GET() {
  try {
    const supabase = createClient(supabaseUrl, supabaseKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

    const { data, error } = await supabase
      .from('custom_backglass_images')
      .select('machine_key, image_type, storage_path, public_url, updated_at')

    if (error) {
      return NextResponse.json({ images: [] })
    }

    // Add cache-busting to URLs using updated_at timestamp
    const images = (data || []).map((img: any) => ({
      ...img,
      public_url: img.public_url
        ? `${img.public_url.split('?')[0]}?t=${new Date(img.updated_at).getTime()}`
        : img.public_url
    }))

    return NextResponse.json({ images })
  } catch (error) {
    return NextResponse.json({ images: [] })
  }
}
