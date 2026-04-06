import { supabase } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// POST — log a visitor
export async function POST(req: NextRequest) {
  const ua = req.headers.get('user-agent') ?? ''
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'desconocida'
  const country = req.headers.get('x-vercel-ip-country') ?? null
  const referrer = req.headers.get('referer') ?? null

  // Parse device/browser/os from user-agent
  const device  = /Mobile|Android|iPhone|iPad/i.test(ua) ? 'Móvil' : 'Escritorio'
  const browser = ua.includes('Chrome') && !ua.includes('Edg') ? 'Chrome'
    : ua.includes('Firefox') ? 'Firefox'
    : ua.includes('Safari') && !ua.includes('Chrome') ? 'Safari'
    : ua.includes('Edg') ? 'Edge'
    : 'Otro'
  const os = ua.includes('Windows') ? 'Windows'
    : ua.includes('Mac') ? 'macOS'
    : ua.includes('Android') ? 'Android'
    : ua.includes('iPhone') || ua.includes('iPad') ? 'iOS'
    : ua.includes('Linux') ? 'Linux'
    : 'Otro'

  await supabase.from('maintenance_visits').insert({ ip, country, device, browser, os, referrer })

  return NextResponse.json({ ok: true })
}

// GET — list visits (requires admin token)
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token || token !== process.env.MAINTENANCE_ADMIN_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('maintenance_visits')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ visits: data })
}
