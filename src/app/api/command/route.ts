import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { planQuery } from '@/lib/command/planner'
import { runCapabilityDryRun, runCapabilityExecute } from '@/lib/command/capabilities'
import type { CommandContext, PlannedIntent } from '@/lib/command/types'
import { resolveDayToken } from '@/lib/command/utils'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

type ExecutePayload = {
  capability?: string
  params?: Record<string, unknown>
}

function resolveSlots(
  planned: Extract<PlannedIntent, { type: 'slots' }>,
  context: CommandContext
) {
  const availableSeats = context.availableSeats ?? []
  const today = context.today ?? new Date().toISOString().slice(0, 10)
  const subject = (planned.subject ?? '').toLowerCase().trim()
  const dayRaw = (planned.day ?? '').toLowerCase().trim()
  const resolvedDay = resolveDayToken(dayRaw, today)

  const slotIndices: number[] = availableSeats.reduce((acc, seat, i) => {
    if (subject) {
      const tutorSubjects = (seat.tutor?.subjects ?? []).map((s) => s.toLowerCase())
      const subjectMatch = tutorSubjects.some((s) => s.includes(subject) || subject.includes(s))
      if (!subjectMatch) return acc
    }

    if (resolvedDay) {
      if ((seat.date ?? '') !== resolvedDay) return acc
    }

    acc.push(i)
    return acc
  }, [] as number[])

  return {
    type: 'slots' as const,
    slotIndices,
    reason:
      planned.reason ??
      `Available slots${subject ? ` for ${subject}` : ''}${dayRaw ? ` on ${dayRaw}` : ' this week'}`,
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const mode = body.mode === 'execute' ? 'execute' : 'draft'
  const query = typeof body.query === 'string' ? body.query : ''
  const context: CommandContext = body.context ?? {}

  if (mode === 'execute') {
    const pendingAction = (body.pendingAction ?? {}) as ExecutePayload
    if (!pendingAction.capability || !pendingAction.params) {
      return NextResponse.json({ type: 'error', text: 'Missing pending action to execute.' }, { status: 400 })
    }

    try {
      const result = await runCapabilityExecute(pendingAction.capability, pendingAction.params)
      return NextResponse.json(result)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to apply this command.'
      return NextResponse.json({ type: 'error', text: msg }, { status: 500 })
    }
  }

  try {
    const planned = await planQuery(query, context, openai)

    if (planned.type === 'capability') {
      const dryRun = await runCapabilityDryRun(planned.capability, planned.params, context)
      return NextResponse.json(dryRun)
    }

    if (planned.type === 'slots') {
      return NextResponse.json(resolveSlots(planned, context))
    }

    return NextResponse.json(planned)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Something went wrong. Try again.'
    return NextResponse.json({ type: 'error', text: msg }, { status: 500 })
  }
}
