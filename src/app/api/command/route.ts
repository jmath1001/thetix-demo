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

2. For list queries (anything that returns multiple items - students, sessions, etc):
{"type":"list","title":"Descriptive title","items":["Item 1","Item 2","Item 3"]}

3. For booking requests ("book Maya for Physics Tuesday evening"):
{"type":"action","action":"open_booking","studentId":"<id>","slotDate":"<YYYY-MM-DD>","slotTime":"<HH:MM>","tutorId":"<id>","topic":"<subject>"}

4. For any other question:
{"type":"answer","text":"Plain English answer"}

RULES:
- Use 12hr time format (3:30pm not 15:30)
- Be flexible - if the user asks for students, sessions, anything - return as list type
- Don't be strict about format, just return useful data
- If uncertain, return answer type with your best guess
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