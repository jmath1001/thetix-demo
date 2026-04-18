'use client'

import { useCallback, useEffect } from 'react'
import { getSessionsForDay } from '@/components/constants'
import { dayOfWeek, getCentralTimeNow, toISODate } from '@/lib/useScheduleData'

type Seat = any

type OptimizerOption = {
  title: string
  detail: string
  explanation: string
}

export type OptimizerScope = 'daily' | 'weekly'

interface ScheduleOptimizerControllerProps {
  students: any[]
  tutors: any[]
  localSessions: any[]
  activeDates: Date[]
  allSeatsForBuilder: Seat[]
  onOpenProposal: (proposal: any) => void
  onNoSuggestions: (scope: OptimizerScope) => void
  onBindRun: (run: (scope?: OptimizerScope) => void) => void
}

function subjectMatch(subject: string, tutorSubjects: string[] = []) {
  const s = (subject || '').toLowerCase().trim()
  if (!s) return false
  return tutorSubjects.some(ts => {
    const t = (ts || '').toLowerCase().trim()
    return t === s || t.includes(s) || s.includes(t)
  })
}

function buildMoveOptions(candidates: Seat[], studentName: string, subject: string): OptimizerOption[] {
  return candidates.slice(0, 3).map((seat, idx) => ({
    title: `Option ${idx + 1}`,
    detail: `${seat.dayName} ${seat.block?.label ?? seat.time} with ${seat.tutor.name}`,
    explanation:
      idx === 0
        ? `Best fit for ${studentName}: maximizes consolidation while keeping ${subject} with a qualified tutor.`
        : idx === 1
          ? `Backup choice with similar subject fit and capacity if Option 1 is no longer available.`
          : `Alternative slot that still satisfies availability and avoids double-booking.`,
  }))
}

export function ScheduleOptimizerController({
  students,
  tutors,
  localSessions,
  activeDates,
  allSeatsForBuilder,
  onOpenProposal,
  onNoSuggestions,
  onBindRun,
}: ScheduleOptimizerControllerProps) {
  const runOptimizer = useCallback((scope: OptimizerScope = 'weekly') => {
    const todayIso = toISODate(getCentralTimeNow())
    const scopedDates = new Set(activeDates.map(d => toISODate(d)))
    const sortedScopeDates = [...scopedDates].sort()
    const weekStart = sortedScopeDates[0] ?? null
    const weekEnd = sortedScopeDates[sortedScopeDates.length - 1] ?? null

    const studentById = new Map(students.map((s: any) => [s.id, s]))
    const tutorById = new Map(tutors.map((t: any) => [t.id, t]))

    const remainingByKey = new Map<string, number>()
    allSeatsForBuilder.forEach((seat: Seat) => {
      const key = `${seat.tutor.id}|${seat.date}|${seat.time}`
      remainingByKey.set(key, seat.seatsLeft)
    })

    const sessionCounts = new Map<string, number>()
    const sessionMeta = new Map<string, { sessionId: string; tutorId: string; tutorName: string; date: string; time: string; dayNum: number }>()
    const rowsBySession = new Map<string, any[]>()
    const busyByStudent = new Map<string, Set<string>>()
    const bookedStudentIds = new Set<string>()

    localSessions.forEach((session: any) => {
      if (!session?.date || session.date < todayIso) return
      if (!scopedDates.has(session.date)) return

      const dayNum = dayOfWeek(session.date)
      const activeRows = (session.students ?? []).filter((st: any) => st.status !== 'cancelled')
      const key = `${session.tutorId}|${session.date}|${session.time}`

      sessionCounts.set(key, activeRows.length)
      sessionMeta.set(key, {
        sessionId: session.id,
        tutorId: session.tutorId,
        tutorName: tutorById.get(session.tutorId)?.name ?? 'Tutor',
        date: session.date,
        time: session.time,
        dayNum,
      })

      if (!remainingByKey.has(key)) remainingByKey.set(key, 0)

      activeRows.forEach((st: any) => {
        if (!st?.id) return
        bookedStudentIds.add(st.id)
        const busy = busyByStudent.get(st.id) ?? new Set<string>()
        busy.add(`${session.date}|${session.time}`)
        busyByStudent.set(st.id, busy)
      })

      // Any non-cancelled, non-recurring row is movable for optimization.
      const movableRows = activeRows.filter((st: any) => st.id && st.rowId && !st.seriesId)
      rowsBySession.set(
        key,
        movableRows.map((st: any) => ({
          rowId: st.rowId,
          studentId: st.id,
          studentName: st.name,
          subject: st.topic || studentById.get(st.id)?.subject || '',
          fromSessionId: session.id,
          fromKey: key,
        }))
      )
    })

    const initialCounts = new Map(sessionCounts)

    const sources = [...sessionCounts.entries()]
      .filter(([, count]) => count > 0)
      .sort((a, b) => a[1] - b[1])
      .map(([key]) => key)

    const changes: any[] = []
    const movedRowIds = new Set<string>()

    const canStudentTakeSeat = (student: any, seat: Seat, fromDate: string, fromTime: string) => {
      if (!student) return false
      if ((student.availabilityBlocks?.length ?? 0) > 0 && !student.availabilityBlocks.includes(`${seat.dayNum}-${seat.time}`)) {
        return false
      }
      const busy = busyByStudent.get(student.id) ?? new Set<string>()
      const targetKey = `${seat.date}|${seat.time}`
      const sourceKey = `${fromDate}|${fromTime}`
      if (targetKey !== sourceKey && busy.has(targetKey)) return false
      return true
    }

    for (const sourceKey of sources) {
      const sourceCount = sessionCounts.get(sourceKey) ?? 0
      if (sourceCount <= 0) continue

      const sourceMeta = sessionMeta.get(sourceKey)
      if (!sourceMeta) continue

      const sourceRows = (rowsBySession.get(sourceKey) ?? []).filter((r: any) => !movedRowIds.has(r.rowId))
      if (sourceRows.length !== sourceCount) continue

      const tentative: Array<{ row: any; targetSeat: Seat; targetKey: string; options: OptimizerOption[] }> = []
      const tempRemaining = new Map(remainingByKey)
      const tempCounts = new Map(sessionCounts)

      let canEmpty = true
      for (const row of sourceRows) {
        const student = studentById.get(row.studentId)

        const rankedTargets = allSeatsForBuilder
          .filter((seat: Seat) => {
            const targetKey = `${seat.tutor.id}|${seat.date}|${seat.time}`
            if (targetKey === sourceKey) return false
            if (scope === 'daily' && seat.date !== sourceMeta.date) return false
            if ((tempRemaining.get(targetKey) ?? 0) <= 0) return false
            if ((tempCounts.get(targetKey) ?? 0) <= 0) return false
            if (!subjectMatch(row.subject, seat.tutor.subjects ?? [])) return false
            if (!canStudentTakeSeat(student, seat, sourceMeta.date, sourceMeta.time)) return false
            return true
          })
          .sort((a: Seat, b: Seat) => {
            const aKey = `${a.tutor.id}|${a.date}|${a.time}`
            const bKey = `${b.tutor.id}|${b.date}|${b.time}`
            const countDiff = (tempCounts.get(bKey) ?? 0) - (tempCounts.get(aKey) ?? 0)
            if (countDiff !== 0) return countDiff
            return (tempRemaining.get(aKey) ?? 0) - (tempRemaining.get(bKey) ?? 0)
          })

        const target = rankedTargets[0]
        if (!target) {
          canEmpty = false
          break
        }

        const targetKey = `${target.tutor.id}|${target.date}|${target.time}`
        tentative.push({
          row,
          targetSeat: target,
          targetKey,
          options: buildMoveOptions(rankedTargets, row.studentName, row.subject),
        })
        tempRemaining.set(targetKey, (tempRemaining.get(targetKey) ?? 0) - 1)
        tempCounts.set(targetKey, (tempCounts.get(targetKey) ?? 0) + 1)
      }

      if (!canEmpty) continue

      tentative.forEach(({ row, targetSeat, targetKey, options }) => {
        const sourceMetaNow = sessionMeta.get(row.fromKey)
        if (!sourceMetaNow) return

        const busy = busyByStudent.get(row.studentId) ?? new Set<string>()
        busy.delete(`${sourceMetaNow.date}|${sourceMetaNow.time}`)
        busy.add(`${targetSeat.date}|${targetSeat.time}`)
        busyByStudent.set(row.studentId, busy)

        sessionCounts.set(row.fromKey, (sessionCounts.get(row.fromKey) ?? 0) - 1)
        sessionCounts.set(targetKey, (sessionCounts.get(targetKey) ?? 0) + 1)
        remainingByKey.set(targetKey, (remainingByKey.get(targetKey) ?? 0) - 1)
        remainingByKey.set(row.fromKey, (remainingByKey.get(row.fromKey) ?? 0) + 1)

        movedRowIds.add(row.rowId)
        const oldLabel = getSessionsForDay(sourceMetaNow.dayNum).find(b => b.time === sourceMetaNow.time)?.label ?? sourceMetaNow.time

        changes.push({
          action: 'move',
          rowId: row.rowId,
          studentId: row.studentId,
          fromSessionId: row.fromSessionId,
          studentName: row.studentName,
          subject: row.subject,
          oldTime: `${sourceMetaNow.tutorName} · ${oldLabel} · ${sourceMetaNow.date}`,
          explanation: 'Packed into a fuller session to eliminate a thin slot and raise the student-per-session ratio.',
          suggestionOptions: options,
          newSlot: {
            tutorId: targetSeat.tutor.id,
            tutorName: targetSeat.tutor.name,
            date: targetSeat.date,
            time: targetSeat.time,
            topic: row.subject,
            block: targetSeat.block,
          },
        })
      })
    }

    const fillSeats = [...allSeatsForBuilder].sort((a: Seat, b: Seat) => {
      const aKey = `${a.tutor.id}|${a.date}|${a.time}`
      const bKey = `${b.tutor.id}|${b.date}|${b.time}`
      const countDiff = (sessionCounts.get(bKey) ?? 0) - (sessionCounts.get(aKey) ?? 0)
      if (countDiff !== 0) return countDiff
      return (remainingByKey.get(aKey) ?? 0) - (remainingByKey.get(bKey) ?? 0)
    })

    if (scope === 'weekly') {
      const unbookedStudents = students
        .filter((student: any) => !bookedStudentIds.has(student.id) && !!student.subject)
        .sort((a: any, b: any) => {
          const candidateCount = (student: any) => fillSeats.filter((seat: Seat) => {
            const key = `${seat.tutor.id}|${seat.date}|${seat.time}`
            if ((remainingByKey.get(key) ?? 0) <= 0) return false
            if ((sessionCounts.get(key) ?? 0) <= 0) return false
            if (!subjectMatch(student.subject, seat.tutor.subjects ?? [])) return false
            if ((student.availabilityBlocks?.length ?? 0) > 0 && !student.availabilityBlocks.includes(`${seat.dayNum}-${seat.time}`)) return false
            const busy = busyByStudent.get(student.id) ?? new Set<string>()
            if (busy.has(`${seat.date}|${seat.time}`)) return false
            return true
          }).length

          return candidateCount(a) - candidateCount(b)
        })

      for (const student of unbookedStudents) {
        const rankedTargets = fillSeats.filter((seat: Seat) => {
          const key = `${seat.tutor.id}|${seat.date}|${seat.time}`
          if ((remainingByKey.get(key) ?? 0) <= 0) return false
          if ((sessionCounts.get(key) ?? 0) <= 0) return false
          if (!subjectMatch(student.subject, seat.tutor.subjects ?? [])) return false
          if ((student.availabilityBlocks?.length ?? 0) > 0 && !student.availabilityBlocks.includes(`${seat.dayNum}-${seat.time}`)) return false
          const busy = busyByStudent.get(student.id) ?? new Set<string>()
          if (busy.has(`${seat.date}|${seat.time}`)) return false
          return true
        })

        const target = rankedTargets[0]
        if (!target) continue

        const key = `${target.tutor.id}|${target.date}|${target.time}`
        remainingByKey.set(key, (remainingByKey.get(key) ?? 0) - 1)
        sessionCounts.set(key, (sessionCounts.get(key) ?? 0) + 1)
        const busy = busyByStudent.get(student.id) ?? new Set<string>()
        busy.add(`${target.date}|${target.time}`)
        busyByStudent.set(student.id, busy)

        changes.push({
          action: 'place',
          studentId: student.id,
          studentName: student.name,
          subject: student.subject,
          oldTime: 'Unassigned',
          explanation: 'Filled an open seat in an existing session — keeps capacity high and avoids creating a new thin slot.',
          suggestionOptions: buildMoveOptions(rankedTargets, student.name, student.subject),
          newSlot: {
            tutorId: target.tutor.id,
            tutorName: target.tutor.name,
            date: target.date,
            time: target.time,
            topic: student.subject,
            block: target.block,
          },
        })

        if (changes.length >= 12) break
      }
    }

    const ratioOf = (counts: Map<string, number>) => {
      const values = [...counts.values()].filter(v => v > 0)
      const activeSessions = values.length
      const totalStudents = values.reduce((sum, v) => sum + v, 0)
      return {
        activeSessions,
        totalStudents,
        ratio: activeSessions > 0 ? totalStudents / activeSessions : 0,
      }
    }

    const before = ratioOf(initialCounts)
    const after = ratioOf(sessionCounts)

    if (!changes.length) {
      onNoSuggestions(scope)
      return
    }

    const movedCount = changes.filter(c => c.action === 'move').length
    const placedCount = changes.filter(c => c.action === 'place').length
    const scopeLabel = scope === 'daily' ? 'Daily' : 'Weekly'
    const scopeReasoning =
      scope === 'daily'
        ? 'Primary objective: maximize packing density today by merging under-filled slots so sessions run as full as possible. Recurring series are preserved and not moved.'
        : 'Primary objective: maximize packing density this week by collapsing thin slots, filling open seats, and maximizing students per session. Recurring series are preserved and not moved.'
    const ratioDelta = after.ratio - before.ratio

    onOpenProposal({
      type: 'proposal',
      title: `${scopeLabel} Optimization Suggestions`,
      scope,
      context: {
        weekStart,
        weekEnd,
        dates: sortedScopeDates,
      },
      metrics: {
        studentsPerSessionBefore: before.ratio,
        studentsPerSessionAfter: after.ratio,
        studentsPerSessionDelta: ratioDelta,
        activeSessionsBefore: before.activeSessions,
        activeSessionsAfter: after.activeSessions,
        totalStudentsBefore: before.totalStudents,
        totalStudentsAfter: after.totalStudents,
      },
      reasoning: `${scopeReasoning} Proposed ${movedCount} move${movedCount === 1 ? '' : 's'} and ${placedCount} placement${placedCount === 1 ? '' : 's'} while respecting availability and subject constraints.`,
      changes,
    })
  }, [activeDates, allSeatsForBuilder, localSessions, onNoSuggestions, onOpenProposal, students, tutors])

  useEffect(() => {
    onBindRun(runOptimizer)
  }, [onBindRun, runOptimizer])

  return null
}
