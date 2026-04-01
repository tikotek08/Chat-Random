import { auth } from '@/auth'
import { supabase } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// GET — list saved connections for current user
export async function GET() {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ connections: [] })

  const { data, error } = await supabase
    .from('connections')
    .select('*')
    .eq('user_email', session.user.email)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ connections: data })
}

// POST — save a new connection
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { stranger_name, stranger_email, stranger_photo, room_id, note } = await req.json()

  const { data, error } = await supabase
    .from('connections')
    .insert({
      user_email: session.user.email,
      stranger_name: stranger_name ?? null,
      stranger_email: stranger_email ?? null,
      stranger_photo: stranger_photo ?? null,
      room_id: room_id ?? null,
      note: note ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ connection: data })
}

// DELETE — remove a connection
export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json()
  const { error } = await supabase
    .from('connections')
    .delete()
    .eq('id', id)
    .eq('user_email', session.user.email)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
