import { auth } from '@/auth'
import { supabase } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'

export const dynamic = 'force-dynamic'

// POST — create invite + send email
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { to_email, to_name, scheduled_at, message } = await req.json()
  if (!to_email || !scheduled_at) {
    return NextResponse.json({ error: 'to_email and scheduled_at required' }, { status: 400 })
  }

  const { data: invite, error } = await supabase
    .from('meeting_invites')
    .insert({
      from_email:  session.user.email,
      from_name:   session.user.name ?? null,
      to_email,
      to_name:     to_name ?? null,
      scheduled_at,
      message:     message ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const resend = new Resend(process.env.RESEND_API_KEY)
  const dateLabel = new Date(scheduled_at).toLocaleDateString('es', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  const timeLabel = new Date(scheduled_at).toLocaleTimeString('es', {
    hour: '2-digit', minute: '2-digit',
  })

  const baseUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? 'https://chat-random-kohl.vercel.app'
  const acceptUrl = `${baseUrl}/?invite=${invite.token}`

  const html = `<!DOCTYPE html>
<html lang="es">
<body style="margin:0;padding:0;background:#07071a;font-family:sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#0c0c26;border:1px solid rgba(99,102,241,0.25);border-radius:20px;padding:36px 28px;text-align:center;">
    <div style="font-size:48px;margin-bottom:16px;">💬</div>
    <h1 style="color:white;font-size:22px;font-weight:800;margin:0 0 8px;">
      ¡Tienes una invitación para chatear!
    </h1>
    <p style="color:rgba(255,255,255,0.5);font-size:14px;margin:0 0 24px;">
      <strong style="color:#a5b4fc;">${invite.from_name ?? invite.from_email}</strong>
      te invita a una sesión en Chat Random
    </p>
    <div style="background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.3);border-radius:14px;padding:18px;margin-bottom:24px;">
      <div style="color:#a5b4fc;font-size:13px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;">Fecha y hora</div>
      <div style="color:white;font-size:16px;font-weight:700;">${dateLabel}</div>
      <div style="color:#a5b4fc;font-size:15px;font-weight:600;margin-top:4px;">${timeLabel}</div>
      ${invite.message ? `<div style="color:rgba(255,255,255,0.55);font-size:13px;margin-top:10px;font-style:italic;">"${invite.message}"</div>` : ''}
    </div>
    <a href="${acceptUrl}"
       style="display:inline-block;padding:15px 36px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;font-size:15px;font-weight:800;text-decoration:none;border-radius:14px;box-shadow:0 0 25px rgba(99,102,241,0.4);">
      Ver invitación →
    </a>
    <p style="color:rgba(255,255,255,0.2);font-size:11px;margin-top:24px;">
      Chat Random — Si no esperabas esta invitación, ignora este email.
    </p>
  </div>
</body>
</html>`

  try {
    await resend.emails.send({
      from:    process.env.RESEND_FROM ?? 'onboarding@resend.dev',
      to:      to_email,
      subject: `${invite.from_name ?? 'Alguien'} te invita a chatear en Chat Random`,
      html,
    })
  } catch (emailErr) {
    console.error('Email send failed:', emailErr)
    // Don't fail the request — invite is saved, email is best-effort
  }

  return NextResponse.json({ invite })
}

// GET ?to_email= — list pending invites for a recipient (badge count)
export async function GET(req: NextRequest) {
  const to_email = req.nextUrl.searchParams.get('to_email')
  if (!to_email) return NextResponse.json({ invites: [] })

  const { data, error } = await supabase
    .from('meeting_invites')
    .select('*')
    .eq('to_email', to_email)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ invites: data })
}
