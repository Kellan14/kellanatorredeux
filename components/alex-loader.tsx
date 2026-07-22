import { cn } from '@/lib/utils'

interface AlexLoaderProps {
  /** Rendered width in pixels (height scales to the sprite's 4:3 ratio). Default 112. */
  size?: number
  className?: string
}

/**
 * Animated pixel-art "Alex" loading indicator. Drop-in replacement for the
 * large centered <Loader2 className="h-8 w-8 animate-spin" /> spinners.
 */
export function AlexLoader({ size = 112, className }: AlexLoaderProps) {
  return (
    <img
      src="/alex-loader.gif"
      alt="Loading"
      width={size}
      height={Math.round((size * 3) / 4)}
      className={cn('select-none', className)}
      style={{ imageRendering: 'pixelated' }}
      aria-live="polite"
    />
  )
}
