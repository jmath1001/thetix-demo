import { NextRequest, NextResponse } from 'next/server'

// Server-side proxy to cron-job.org REST API.
// Keeps CRONJOB_ORG_API_KEY out of the browser entirely.
//
// Job types (via ?type= query param):
//   reminder      → CRONJOB_ORG_JOB_ID          (default, student reminders)
//   tutor-weekly  → CRONJOB_ORG_TUTOR_WEEKLY_JOB_ID
//   tutor-daily   → CRONJOB_ORG_TUTOR_DAILY_JOB_ID

const CRONJOB_BASE = 'https://api.cron-job.org'

const JOB_TYPE_ENV: Record<string, string> = {
  'reminder':     'CRONJOB_ORG_JOB_ID',
  'tutor-weekly': 'CRONJOB_ORG_TUTOR_WEEKLY_JOB_ID',
  'tutor-daily':  'CRONJOB_ORG_TUTOR_DAILY_JOB_ID',
}

function apiHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.CRONJOB_ORG_API_KEY ?? ''}`,
  }
}

function resolveJobId(type: string): string | null {
  const envKey = JOB_TYPE_ENV[type] ?? JOB_TYPE_ENV['reminder']
  return process.env[envKey] ?? null
}

function missingConfig(type: string) {
  const envKey = JOB_TYPE_ENV[type] ?? JOB_TYPE_ENV['reminder']
  return NextResponse.json(
    { error: `CRONJOB_ORG_API_KEY or ${envKey} is not configured` },
    { status: 503 }
  )
}

// GET /api/cron-config?type=reminder        → current job details
// GET /api/cron-config?type=reminder&history → last execution history
// type defaults to 'reminder'
export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams
  const type = params.get('type') ?? 'reminder'
  const jobId = resolveJobId(type)

  if (!process.env.CRONJOB_ORG_API_KEY || !jobId) return missingConfig(type)

  const wantHistory = params.has('history')
  const url = wantHistory
    ? `${CRONJOB_BASE}/jobs/${jobId}/history`
    : `${CRONJOB_BASE}/jobs/${jobId}`

  const res = await fetch(url, { headers: apiHeaders(), cache: 'no-store' })
  const body = await res.json().catch(() => ({}))

  if (!res.ok) {
    return NextResponse.json({ error: body?.error ?? 'cron-job.org error' }, { status: res.status })
  }
  return NextResponse.json(body)
}

// PATCH /api/cron-config?type=reminder  body: { enabled?, schedule? }
// schedule shape: { hours: number[], minutes: number[], wdays?: number[], timezone?: string }
export async function PATCH(req: NextRequest) {
  const params = new URL(req.url).searchParams
  const type = params.get('type') ?? 'reminder'
  const jobId = resolveJobId(type)

  if (!process.env.CRONJOB_ORG_API_KEY || !jobId) return missingConfig(type)

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

  const res = await fetch(`${CRONJOB_BASE}/jobs/${jobId}`, {
    method: 'PATCH',
    headers: apiHeaders(),
    body: JSON.stringify({ job }),
  })
  const resBody = await res.json().catch(() => ({}))

  if (!res.ok) {
    return NextResponse.json({ error: resBody?.error ?? 'cron-job.org error' }, { status: res.status })
  }
  return NextResponse.json({ ok: true })
}
