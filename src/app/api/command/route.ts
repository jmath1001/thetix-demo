import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(req: NextRequest) {
  const { query, context } = await req.json()

  const systemPrompt = `
You are an AI assistant built into Thetix, a scheduling app for a tutoring center.
You have access to the center's live schedule data split into pastSessions and upcomingSessions.

RESPONSE FORMAT — return ONLY one of these JSON shapes, nothing else:

1. For slot/opening queries ("open slots", "available", "find a slot", "Physics slots", "who can I book"):
{"type":"slots","slotIndices":[0,1,2],"reason":"Short explanation of what matched"}
slotIndices are indices into the availableSeats array provided in context.

2. For list queries ("who has no-shows", "attendance today", "list students"):
{"type":"list","title":"Short title","items":["item 1","item 2"]}

3. For booking requests ("book Maya for Physics Tuesday evening"):
{"type":"action","action":"open_booking","studentId":"<id>","slotDate":"<YYYY-MM-DD>","slotTime":"<HH:MM>","tutorId":"<id>","topic":"<subject>"}

4. For simple questions ("how full is Thursday", "what time does X have"):
{"type":"answer","text":"Short plain English answer, max 2 sentences."}

RULES:
- Never use "-" bullet points in text answers
- Use 12hr time format (3:30pm not 15:30)
- Use short dates (Mon Apr 7 not April 7 2026)
- For history questions use only pastSessions
- For upcoming/availability questions use only upcomingSessions
- availableSeats contains open slots for this week only
- Match slots by subject, tutor name, day, or time of day:
  morning = before 12:00, afternoon = 12:00-17:00, evening = 17:00+
- If nothing matches, return {"type":"answer","text":"I couldn't find any matching slots this week."}
`

  const userMessage = `
Today: ${context.today}

Available seats this week:
${JSON.stringify(context.availableSeats?.map((s: any, i: number) => ({
  index: i,
  tutor: s.tutor.name,
  subjects: s.tutor.subjects,
  day: s.dayName,
  date: s.date,
  time: s.time,
  seatsLeft: s.seatsLeft,
  label: s.block?.label,
  display: s.block?.display,
})), null, 2)}

Past sessions:
${JSON.stringify(context.pastSessions, null, 2)}

Upcoming sessions:
${JSON.stringify(context.upcomingSessions, null, 2)}

Students:
${JSON.stringify(context.students, null, 2)}

User query: "${query}"
`

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 400,
      temperature: 0.2,
    })

    const text = response.choices[0].message.content?.trim() ?? ''

    try {
      const parsed = JSON.parse(text)
      return NextResponse.json(parsed)
    } catch {
      return NextResponse.json({ type: 'answer', text })
    }
  } catch (err: any) {
    console.error('Command route error:', err)
    return NextResponse.json({ type: 'error', text: 'Something went wrong. Try again.' }, { status: 500 })
  }
}