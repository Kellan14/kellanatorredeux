'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { Menu, X, LogIn, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createSupabaseClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import type { User as SupabaseUser } from '@supabase/supabase-js'

export function MainNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [user, setUser] = useState<SupabaseUser | null>(null)
  const supabase = createSupabaseClient()

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
    }
    getUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [supabase.auth])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  const navItems = [
    { href: '/' as const, label: 'Dashboard' },
    { href: '/stats' as const, label: 'Statistics' },
    { href: '/machines' as const, label: 'Machines' },
    ...(user ? [
      { href: '/strategy' as const, label: 'Strategy' },
    ] : []),
  ] as const

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center">
        {/* Desktop Navigation */}
        <nav className="hidden md:flex flex-1 items-center justify-between">
          <div className="flex items-center space-x-6 text-sm font-medium">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`transition-colors hover:text-foreground/80 ${
                  pathname === item.href ? 'text-foreground' : 'text-foreground/60'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
          
          <div className="flex items-center space-x-2">
            {user ? (
              <>
                <span className="text-sm text-muted-foreground mr-2">
                  {user.email}
                </span>
                <Button variant="ghost" size="sm" onClick={handleSignOut}>
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign Out
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/login">
                    <LogIn className="h-4 w-4 mr-2" />
                    Login
                  </Link>
                </Button>
                <Button size="sm" asChild>
                  <Link href="/register">Sign Up</Link>
                </Button>
              </>
            )}
          </div>
        </nav>

        {/* Mobile Navigation Toggle */}
        <div className="flex flex-1 items-center justify-end md:hidden">
          <Button
            variant="ghost"
            className="px-2"
            onClick={() => setIsOpen(!isOpen)}
          >
            {isOpen ? (
              <X className="h-6 w-6" />
            ) : (
              <Menu className="h-6 w-6" />
            )}
          </Button>
        </div>
      </div>

      {/* Mobile Navigation Menu */}
      {isOpen && (
        <div className="md:hidden border-t">
          <nav className="flex flex-col space-y-3 p-4">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className={`transition-colors hover:text-foreground/80 ${
                  pathname === item.href ? 'text-foreground' : 'text-foreground/60'
                }`}
              >
                {item.label}
              </Link>
            ))}
            
            <div className="pt-3 border-t space-y-2">
              {user ? (
                <>
                  <div className="text-sm text-muted-foreground py-2">
                    {user.email}
                  </div>
                  <Button 
                    variant="outline" 
                    className="w-full justify-start" 
                    onClick={handleSignOut}
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    Sign Out
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" className="w-full justify-start" asChild>
                    <Link href="/login" onClick={() => setIsOpen(false)}>
                      <LogIn className="h-4 w-4 mr-2" />
                      Login
                    </Link>
                  </Button>
                  <Button className="w-full justify-start" asChild>
                    <Link href="/register" onClick={() => setIsOpen(false)}>
                      Sign Up
                    </Link>
                  </Button>
                </>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}
