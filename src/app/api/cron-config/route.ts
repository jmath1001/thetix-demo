import { NextRequest, NextResponse } from 'next/server'

// Server-side proxy to cron-job.org REST API.
// Keeps CRONJOB_ORG_API_KEY out of the browser entirely.
// Requires CRONJOB_ORG_JOB_ID to identify which job to manage.

const CRONJOB_BASE = 'https://api.cron-job.org'

function headers() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.CRONJOB_ORG_API_KEY ?? ''}`,
  }
}

function jobId(): string | null {
  return process.env.CRONJOB_ORG_JOB_ID ?? null
}

function missingConfig() {
  return NextResponse.json(
    { error: 'CRONJOB_ORG_API_KEY or CRONJOB_ORG_JOB_ID is not configured' },
    { status: 503 }
  )
}

// GET /api/cron-config          → current job details
// GET /api/cron-config?history  → last execution history
export async function GET(req: NextRequest) {
  if (!process.env.CRONJOB_ORG_API_KEY || !jobId()) return missingConfig()

  const wantHistory = new URL(req.url).searchParams.has('history')
  const url = wantHistory
    ? `${CRONJOB_BASE}/jobs/${jobId()}/history`
    : `${CRONJOB_BASE}/jobs/${jobId()}`

  const res = await fetch(url, { headers: headers(), cache: 'no-store' })
  const body = await res.json().catch(() => ({}))

  if (!res.ok) {
    return NextResponse.json({ error: body?.error ?? 'cron-job.org error' }, { status: res.status })
  }
  return NextResponse.json(body)
}

// PATCH /api/cron-config  body: { enabled?, schedule? }
// schedule shape: { hours: number[], minutes: number[], timezone?: string }
export async function PATCH(req: NextRequest) {
  if (!process.env.CRONJOB_ORG_API_KEY || !jobId()) return missingConfig()

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Only allow safe fields through — never let the client mutate the URL or auth.
  const job: Record<string, unknown> = {}
  if (typeof body.enabled === 'boolean') job.enabled = body.enabled
  if (body.schedule && typeof body.schedule === 'object' && !Array.isArray(body.schedule)) {
    const s = body.schedule as Record<string, unknown>
    const sched: Record<string, unknown> = {}
    if (Array.isArray(s.hours))   sched.hours   = (s.hours   as number[]).map(Number)
    if (Array.isArray(s.minutes)) sched.minutes = (s.minutes as number[]).map(Number)
    if (Array.isArray(s.wdays))   sched.wdays   = (s.wdays   as number[]).map(Number)
    if (typeof s.timezone === 'string') sched.timezone = s.timezone
    job.schedule = sched
  }

  if (Object.keys(job).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const res = await fetch(`${CRONJOB_BASE}/jobs/${jobId()}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ job }),
  })
  const resBody = await res.json().catch(() => ({}))

  if (!res.ok) {
    return NextResponse.json({ error: resBody?.error ?? 'cron-job.org error' }, { status: res.status })
  }
  return NextResponse.json({ ok: true })
}
