import type OpenAI from 'openai'
import type { CommandContext, PlannedIntent } from '@/lib/command/types'
import { extractQuotedValue, isIsoDate, normalizeTimeToken, resolveDayToken } from '@/lib/command/utils'

function findByName<T extends { id: string; name: string }>(items: T[], query: string): T | null {
  const q = query.toLowerCase()
  const matches = items.filter((item) => q.includes(item.name.toLowerCase()))
  if (matches.length === 0) return null
  matches.sort((a, b) => b.name.length - a.name.length)
  return matches[0]
}

function extractDateTokens(query: string): string[] {
  const lower = query.toLowerCase()
  const isoMatches = [...lower.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map((m) => m[0])
  const dayMatches = [...lower.matchAll(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|mon|tue|wed|thu|fri|sat|sun)\b/g)].map((m) => m[0])
  return [...isoMatches, ...dayMatches]
}

function extractField(query: string): string | null {
  const lower = query.toLowerCase()
  const fieldMap: Array<[RegExp, string]> = [
    [/\bbluebook\b|\bbluebook url\b|\blink\b/, 'bluebook_url'],
    [/\bmom email\b|\bmother email\b/, 'mom_email'],
    [/\bmom phone\b|\bmother phone\b/, 'mom_phone'],
    [/\bmom name\b|\bmother name\b/, 'mom_name'],
    [/\bdad email\b|\bfather email\b/, 'dad_email'],
    [/\bdad phone\b|\bfather phone\b/, 'dad_phone'],
    [/\bdad name\b|\bfather name\b/, 'dad_name'],
    [/\bparent email\b/, 'parent_email'],
    [/\bparent phone\b/, 'parent_phone'],
    [/\bparent name\b/, 'parent_name'],
    [/\bemail\b/, 'email'],
    [/\bphone\b/, 'phone'],
  ]

  for (const [matcher, field] of fieldMap) {
    if (matcher.test(lower)) return field
  }
  return null
}

function extractValue(query: string): string | null {
  const quoted = extractQuotedValue(query)
  if (quoted) return quoted

  const toSplit = query.split(/\bto\b/i)
  if (toSplit.length >= 2) {
    const value = toSplit.slice(1).join(' to ').trim()
    if (value) return value
  }

  const asSplit = query.split(/\bas\b/i)
  if (asSplit.length >= 2) {
    const value = asSplit.slice(1).join(' as ').trim()
    if (value) return value
  }

  return null
}

function extractTimeToken(query: string): string {
  return query.match(/\b(\d{1,2}(?::\d{2})?\s?(?:am|pm)|\d{1,2}:\d{2})\b/i)?.[0] ?? ''
}

function extractDayToken(query: string): string {
  const m = query.toLowerCase().match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/)
  return m?.[0] ?? ''
}

function maybeDeterministicPlan(query: string, context: CommandContext): PlannedIntent | null {
  const lower = query.toLowerCase().trim()
  const students = context.students ?? []
  const tutors = context.tutors ?? []
  const today = context.today ?? new Date().toISOString().slice(0, 10)

  // Demo-safe scripted queries for reliable showcasing.
  if (lower.includes('demo') && (lower.includes('time off') || lower.includes('pto'))) {
    const tutor = tutors[0]
    if (tutor) {
      return {
        type: 'capability',
        capability: 'create_time_off_range',
        params: {
          tutorId: tutor.id,
          startDate: today,
          endDate: resolveDayToken('tomorrow', today) ?? today,
          note: 'Demo: conference travel',
        },
      }
    }
  }

  if (lower.includes('demo') && lower.includes('contact')) {
    const student = students[0]
    if (student) {
      return {
        type: 'capability',
        capability: 'update_student_contact',
        params: {
          studentId: student.id,
          field: 'email',
          value: 'demo.parent@example.com',
        },
      }
    }
  }

  if (lower.includes('demo') && (lower.includes('move') || lower.includes('resched'))) {
    const session = (context.sessions ?? []).find((s) => (s.students ?? []).some((st) => st.status !== 'cancelled'))
    const toTutor = tutors.find((t) => t.id !== session?.tutorId)
    const student = session?.students?.find((st) => st.status !== 'cancelled' && st.id)
    if (session && toTutor && student?.id) {
      return {
        type: 'capability',
        capability: 'move_session_with_conflict_check',
        params: {
          studentId: student.id,
          rowId: student.rowId ?? student.id,
          fromSessionId: session.id,
          toTutorId: toTutor.id,
          toDate: session.date,
          toTime: session.time,
        },
      }
    }
  }

  // Unified tutor schedule management parser (availability + time off).
  if (/(time off|pto|vacation|availability|available blocks|avail blocks)/.test(lower)) {
    const tutor = findByName(tutors, lower)
    if (tutor) {
      const dateTokens = extractDateTokens(lower)
      const dayToken = extractDayToken(lower)
      const normalizedTime = normalizeTimeToken(extractTimeToken(lower))

      if (/(show|view|list|see|what|display)/.test(lower)) {
        return {
          type: 'capability',
          capability: 'manage_tutor_schedule',
          params: { action: 'view', tutorId: tutor.id },
        }
      }

      if (/(add|set|enable|open)/.test(lower) && /availability/.test(lower) && dayToken && normalizedTime) {
        return {
          type: 'capability',
          capability: 'manage_tutor_schedule',
          params: {
            action: 'add_availability',
            tutorId: tutor.id,
            day: dayToken,
            time: normalizedTime,
          },
        }
      }

      if (/(remove|delete|clear|disable|close)/.test(lower) && /availability/.test(lower) && dayToken && normalizedTime) {
        return {
          type: 'capability',
          capability: 'manage_tutor_schedule',
          params: {
            action: 'remove_availability',
            tutorId: tutor.id,
            day: dayToken,
            time: normalizedTime,
          },
        }
      }

      if (/(add|set|block|mark|put)/.test(lower) && /(time off|pto|vacation)/.test(lower) && dateTokens.length > 0) {
        const startToken = dateTokens[0]
        const endToken = dateTokens[1] ?? startToken
        return {
          type: 'capability',
          capability: 'manage_tutor_schedule',
          params: {
            action: 'add_time_off',
            tutorId: tutor.id,
            startDate: startToken,
            endDate: endToken,
            note: extractQuotedValue(query) ?? '',
          },
        }
      }

      if (/(remove|delete|clear|unblock)/.test(lower) && /(time off|pto|vacation)/.test(lower) && dateTokens.length > 0) {
        const startToken = dateTokens[0]
        const endToken = dateTokens[1] ?? startToken
        return {
          type: 'capability',
          capability: 'manage_tutor_schedule',
          params: {
            action: 'remove_time_off',
            tutorId: tutor.id,
            startDate: startToken,
            endDate: endToken,
          },
        }
      }
    }
  }

  // Deterministic contact update parser.
  if (/(set|update|change|edit)\b/.test(lower) && /(email|phone|parent|mom|dad|bluebook|contact)/.test(lower)) {
    const student = findByName(students, lower)
    const field = extractField(lower)
    const value = extractValue(query)
    if (student && field && value !== null) {
      return {
        type: 'capability',
        capability: 'update_student_contact',
        params: {
          studentId: student.id,
          field,
          value,
        },
      }
    }
  }

  // Deterministic move parser.
  if ((lower.includes('move') || lower.includes('reschedule')) && (lower.includes(' to ') || lower.includes('into '))) {
    const student = findByName(students, lower)
    const toTutor = findByName(tutors, lower)
    const dateTokens = extractDateTokens(lower)
    const timeToken = lower.match(/\b(\d{1,2}(?::\d{2})?\s?(?:am|pm)|\d{1,2}:\d{2})\b/i)?.[0] ?? ''
    const normalizedTime = normalizeTimeToken(timeToken)

    if (student && toTutor && normalizedTime && dateTokens.length > 0) {
      return {
        type: 'capability',
        capability: 'move_session_with_conflict_check',
        params: {
          studentId: student.id,
          toTutorId: toTutor.id,
          toDate: dateTokens[0],
          toTime: normalizedTime,
        },
      }
    }
  }

  // Deterministic booking parser.
  if (/(book|schedule|enroll|add)\b/.test(lower) && /(student|session|slot|with|for)/.test(lower)) {
    const student = findByName(students, lower)
    if (student) {
      const tutor = findByName(tutors, lower)
      const dateTokens = extractDateTokens(lower)
      const normalizedTime = normalizeTimeToken(extractTimeToken(lower))
      const subjectMatch = lower.match(/\b(algebra|geometry|calculus|statistics|physics|chemistry|biology|math|english|reading|writing|sat|act)\b/)

      return {
        type: 'capability',
        capability: 'book_student_with_optimization',
        params: {
          studentId: student.id,
          ...(tutor ? { tutorId: tutor.id } : {}),
          ...(dateTokens[0] ? { date: dateTokens[0] } : {}),
          ...(normalizedTime ? { time: normalizedTime } : {}),
          ...(subjectMatch?.[0] ? { topic: subjectMatch[0] } : {}),
        },
      }
    }
  }

  // Deterministic booking deletion parser.
  if (/(delete|remove|cancel|unbook|drop)\b/.test(lower) && /(student|booking|session|slot)/.test(lower)) {
    const student = findByName(students, lower)
    if (student) {
      const tutor = findByName(tutors, lower)
      const dateTokens = extractDateTokens(lower)
      const normalizedTime = normalizeTimeToken(extractTimeToken(lower))

      return {
        type: 'capability',
        capability: 'delete_student_booking_with_optimization',
        params: {
          studentId: student.id,
          ...(tutor ? { tutorId: tutor.id } : {}),
          ...(dateTokens[0] ? { date: dateTokens[0] } : {}),
          ...(normalizedTime ? { time: normalizedTime } : {}),
        },
      }
    }
  }

  // Deterministic read-only student lookup.
  const namedStudent = findByName(students, lower)
  if (namedStudent && /contact|email|phone|parent/.test(lower)) {
    return { type: 'student_contact', studentId: namedStudent.id }
  }
  if (namedStudent && /info|information|hours|hour|detail|details|record|all|everything/.test(lower)) {
    return { type: 'student_profile', studentId: namedStudent.id }
  }
  if (namedStudent && /history|upcoming|session|schedule|booked/.test(lower)) {
    return { type: 'student_sessions', studentId: namedStudent.id }
  }
  if (namedStudent && /show|find|lookup|look up|profile/.test(lower)) {
    return { type: 'student_profile', studentId: namedStudent.id }
  }
  if (namedStudent) {
    return { type: 'student_profile', studentId: namedStudent.id }
  }

  // Deterministic slots query.
  if (/open slots|available|find a slot|slots/.test(lower)) {
    const day = extractDateTokens(lower)[0] ?? ''
    const subjectMatch = lower.match(/\b(algebra|geometry|calculus|statistics|physics|chemistry|biology|math|english|reading|writing|sat|act)\b/)
    return {
      type: 'slots',
      subject: subjectMatch?.[0] ?? '',
      day,
      reason: 'Matched by deterministic parser.',
    }
  }

  return null
}

function buildSystemPrompt(context: CommandContext): string {
  const students = context.students ?? []
  const tutors = context.tutors ?? []
  const sessions = context.sessions ?? []
  const studentIndex = students.map((s) => ({ id: s.id, name: s.name }))
  const tutorIndex = tutors.map((t) => ({
    id: t.id,
    name: t.name,
    availability: t.availability ?? [],
    availabilityBlocks: t.availabilityBlocks ?? [],
  }))
  const sessionIndex = sessions.slice(0, 120).map((s) => ({
    id: s.id,
    tutorId: s.tutorId,
    date: s.date,
    time: s.time,
    students: (s.students ?? [])
      .filter((st) => st.status !== 'cancelled')
      .map((st) => ({ rowId: st.rowId, studentId: st.id, name: st.name, topic: st.topic })),
  }))

  return `You are a scheduling assistant for a tutoring center. Return ONLY JSON and no markdown.

STUDENTS: ${JSON.stringify(studentIndex)}
TUTORS: ${JSON.stringify(tutorIndex)}
SESSION_INDEX: ${JSON.stringify(sessionIndex)}

Return one shape:
{"type":"student_contact","studentId":"<id>"}
{"type":"student_sessions","studentId":"<id>"}
{"type":"student_profile","studentId":"<id>"}
{"type":"slots","subject":"<subject or empty>","day":"<day token or empty>","reason":"<one sentence>"}
{"type":"capability","capability":"create_time_off_range","params":{"tutorId":"<id>","startDate":"<date/day>","endDate":"<date/day>","note":"<optional>"}}
{"type":"capability","capability":"update_student_contact","params":{"studentId":"<id>","field":"<email|phone|parent_name|parent_email|parent_phone|mom_name|mom_email|mom_phone|dad_name|dad_email|dad_phone|bluebook_url>","value":"<new value>"}}
{"type":"capability","capability":"move_session_with_conflict_check","params":{"studentId":"<id>","rowId":"<optional>","fromTutorId":"<optional>","fromDate":"<optional>","fromTime":"<optional>","toTutorId":"<id>","toDate":"<date/day>","toTime":"<HH:mm>"}}
{"type":"capability","capability":"book_student_with_optimization","params":{"studentId":"<id>","tutorId":"<optional>","date":"<optional date/day>","time":"<optional HH:mm>","topic":"<optional>"}}
{"type":"capability","capability":"delete_student_booking_with_optimization","params":{"studentId":"<id>","tutorId":"<optional>","date":"<optional date/day>","time":"<optional HH:mm>"}}
{"type":"capability","capability":"manage_tutor_schedule","params":{"action":"<view|add_time_off|remove_time_off|add_availability|remove_availability>","tutorId":"<id>","startDate":"<optional date/day>","endDate":"<optional date/day>","day":"<optional weekday token>","time":"<optional HH:mm>","note":"<optional>"}}
{"type":"answer","text":"<brief answer>"}

Rules:
- Prefer IDs from STUDENTS/TUTORS, never names in params.
- Use YYYY-MM-DD when explicit dates appear.
- Use manage_tutor_schedule for tutor availability/time-off view and edits.
- Keep params minimal and valid JSON.`
}

export async function planQuery(
  query: string,
  context: CommandContext,
  openai: OpenAI
): Promise<PlannedIntent> {
  const deterministic = maybeDeterministicPlan(query, context)
  if (deterministic) return deterministic

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: buildSystemPrompt(context) },
      { role: 'user', content: query },
    ],
    max_tokens: 220,
    temperature: 0,
  })

  const text = response.choices[0].message.content?.trim() ?? ''
  try {
    const parsed = JSON.parse(text) as PlannedIntent

    // Light guardrail to reduce model hallucinations on day values.
    if (parsed.type === 'slots') {
      const day = parsed.day.trim().toLowerCase()
      if (day && !isIsoDate(day) && !resolveDayToken(day, context.today ?? '')) {
        return { ...parsed, day: '' }
      }
    }

    return parsed
  } catch {
    return { type: 'answer', text: text || 'I could not parse that request.' }
  }
}
