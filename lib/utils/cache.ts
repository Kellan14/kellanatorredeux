import { supabase } from '@/lib/supabase'

interface CacheOptions {
  ttl?: number // Time to live in seconds, defaults to 300 (5 minutes)
  cacheType?: string
}

/**
 * Get a cached value or compute and cache it
 */
export async function getCached<T>(
  key: string,
  computeFn: () => Promise<T>,
  options: CacheOptions = {}
): Promise<T> {
  const { ttl = 300, cacheType = 'default' } = options

  try {
    // Try to get from cache first
    // @ts-ignore - strategy_cache table will be created later
    const { data: cached, error: cacheError } = await supabase
      .from('strategy_cache')
      .select('cache_value, expires_at')
      .eq('cache_key', key)
      .single()

    if (!cacheError && cached) {
      const expiresAt = new Date((cached as any).expires_at)
      if (expiresAt > new Date()) {
        // Cache hit and not expired
        return (cached as any).cache_value as T
      }
    }

    // Cache miss or expired, compute new value
    const value = await computeFn()

    // Store in cache
    const expiresAt = new Date()
    expiresAt.setSeconds(expiresAt.getSeconds() + ttl)

    // @ts-ignore - strategy_cache table will be created later
    await supabase
      .from('strategy_cache')
      // @ts-ignore
      .upsert({
        cache_key: key,
        cache_value: value,
        cache_type: cacheType,
        expires_at: expiresAt.toISOString()
      }, {
        onConflict: 'cache_key'
      })

    return value
  } catch (error) {
    console.error('Cache error, falling back to compute:', error)
    // On cache error, just compute and return
    return await computeFn()
  }
}

/**
 * Invalidate a specific cache key
 */
export async function invalidateCache(key: string): Promise<void> {
  try {
    await supabase
      .from('strategy_cache')
      .delete()
      .eq('cache_key', key)
  } catch (error) {
    console.error('Error invalidating cache:', error)
  }
}

/**
 * Invalidate all cache entries matching a pattern
 */
export async function invalidateCachePattern(pattern: string): Promise<void> {
  try {
    await supabase
      .from('strategy_cache')
      .delete()
      .like('cache_key', pattern)
  } catch (error) {
    console.error('Error invalidating cache pattern:', error)
  }
}

/**
 * Invalidate all cache entries of a specific type
 */
export async function invalidateCacheType(cacheType: string): Promise<void> {
  try {
    await supabase
      .from('strategy_cache')
      .delete()
      .eq('cache_type', cacheType)
  } catch (error) {
    console.error('Error invalidating cache type:', error)
  }
}

/**
 * Clean up expired cache entries
 */
export async function cleanExpiredCache(): Promise<void> {
  try {
    await supabase
      .from('strategy_cache')
      .delete()
      .lt('expires_at', new Date().toISOString())
  } catch (error) {
    console.error('Error cleaning expired cache:', error)
  }
}
