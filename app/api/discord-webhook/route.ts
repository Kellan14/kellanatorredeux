import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const DISCORD_MAX_LENGTH = 2000

/**
 * Split a report into Discord-safe chunks (<=2000 chars each),
 * breaking at line boundaries and section headers when possible.
 */
function splitForDiscord(text: string): string[] {
  const lines = text.split('\n')
  const chunks: string[] = []
  let current = ''

  for (const line of lines) {
    const candidate = current ? current + '\n' + line : line

    if (candidate.length > DISCORD_MAX_LENGTH) {
      if (current) chunks.push(current)
      // If a single line exceeds the limit, force-split it
      if (line.length > DISCORD_MAX_LENGTH) {
        for (let i = 0; i < line.length; i += DISCORD_MAX_LENGTH) {
          chunks.push(line.slice(i, i + DISCORD_MAX_LENGTH))
        }
        current = ''
      } else {
        current = line
      }
    } else {
      current = candidate
    }
  }

  if (current) chunks.push(current)
  return chunks
}

export async function POST(request: Request) {
  try {
    // Require login so the webhook can't be spammed anonymously.
    const auth = await requireUser(request)
    if (!auth.ok) return auth.response

    const { reportText } = await request.json()

    const webhookUrl = process.env.DISCORD_WEBHOOK_URL
    if (!webhookUrl) {
      return NextResponse.json(
        { error: 'Discord webhook URL not configured. Add DISCORD_WEBHOOK_URL to .env.local' },
        { status: 500 }
      )
    }

    if (!reportText) {
      return NextResponse.json({ error: 'No report text provided' }, { status: 400 })
    }

    // Wrap in code block for monospace formatting
    const formatted = '```\n' + reportText + '\n```'
    const chunks = splitForDiscord(formatted)

    // If wrapping in code blocks caused splits, re-wrap each chunk
    const wrappedChunks = chunks.length === 1
      ? chunks
      : chunks.map((chunk, i) => {
          // Strip the opening/closing ``` if they got split
          let clean = chunk
          if (i === 0 && clean.startsWith('```\n')) {
            clean = clean.slice(4)
          }
          if (i === chunks.length - 1 && clean.endsWith('\n```')) {
            clean = clean.slice(0, -4)
          }
          return '```\n' + clean + '\n```'
        })

    // Send each chunk as a separate message
    for (const chunk of wrappedChunks) {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: chunk }),
      })

      if (!res.ok) {
        const errorText = await res.text()
        console.error('Discord webhook error:', errorText)
        return NextResponse.json(
          { error: `Discord API error: ${res.status}` },
          { status: 502 }
        )
      }

      // Discord rate limit: small delay between messages
      if (wrappedChunks.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }

    return NextResponse.json({ success: true, messagesSent: wrappedChunks.length })
  } catch (error) {
    console.error('Discord webhook error:', error)
    return NextResponse.json({ error: 'Failed to send to Discord' }, { status: 500 })
  }
}
