import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClockCard } from "@/components/staff/clock-card";
import { PageHeader } from "@/components/staff/page-header";
import { BreakCorrectForm, ShiftCorrectForm } from "@/components/staff/shift-correct-form";
import { EmptyState } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { formatINR } from "@/lib/money";
import { addDays, businessDate } from "@/lib/dates";
import { getOpenBreak, getOpenShift, listOnShiftNow, listShifts, listTillSessionsDuring } from "@/lib/repositories/shifts";
import { formatHours, formatIstLocal, summariseHours, weekStart, workedMinutes } from "@/lib/shifts/hours";

export const metadata: Metadata = { title: "Shifts", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const time = (date: Date) => date.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
const day = (iso: string) => new Date(`${iso}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" });

/**
 * Basic shifts (roadmap 6.4). Everyone signed in clocks themselves and sees who
 * is on shift. Managers (`staff.manage`) also see hours per person per day and
 * week, and may correct a shift or a break. Worked time is the shift length
 * minus recorded break time: a factual duration. Pay rules (paid breaks,
 * overtime, rounding, wages) are out of scope by owner decision. Till sessions
 * a person opened or closed during a shift are shown read-only; shifts and the
 * till do not depend on each other.
 */
export default async function ShiftsPage() {
  const staff = await requireStaff();
  const canManage = await staffCan("staff.manage");
  const canSeeTillFigures = await staffCan("finance.view");
  const now = new Date();
  const today = businessDate(now);

  const [mine, myBreak, onNow] = await Promise.all([getOpenShift(staff.orgId, staff.userId), getOpenBreak(staff.orgId, staff.userId), listOnShiftNow(staff.orgId)]);

  const from = weekStart(addDays(today, -7));
  const recent = canManage ? await listShifts(staff.orgId, from, today) : [];
  const thisWeek = weekStart(today);
  const weekMinutes = summariseHours(recent.filter((s) => s.businessDate >= thisWeek), now);
  // Till sessions each person opened or closed during their shift: read-only, and figures only for finance.view.
  const tillByShift = new Map(
    await Promise.all(
      recent.map(async (s) => [s.id, await listTillSessionsDuring(staff.orgId, s.userId, s.clockInAt, s.clockOutAt ?? now, canSeeTillFigures)] as const),
    ),
  );
  const names = new Map(recent.map((s) => [s.userId, s.name]));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader title="Shifts" description="Clock in and out, and see who is on shift." />

      <Card>
        <CardContent className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-semibold">Your shift</h2>
          <ClockCard onShiftSince={mine ? time(mine.clockInAt) : null} onBreakSince={myBreak ? time(myBreak.startedAt) : null} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-semibold">On shift now</h2>
          {onNow.length === 0 ? (
            <EmptyState title="Nobody is clocked in" detail="People appear here as soon as they clock in." />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {onNow.map((s) => (
                <li key={s.id} className="flex items-baseline justify-between py-2 text-sm">
                  <span className="font-semibold">{s.name}</span>
                  <span className="tabular text-muted-foreground">
                    {s.breaks.some((b) => b.endedAt === null) ? "on a break, " : ""}since {time(s.clockInAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <>
          <Card>
            <CardContent className="flex flex-col gap-3">
              <h2 className="font-heading text-lg font-semibold">Hours this week</h2>
              {weekMinutes.size === 0 ? (
                <p className="text-sm text-muted-foreground">No shifts recorded this week.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Person</TableHead>
                      <TableHead className="text-right">Today</TableHead>
                      <TableHead className="text-right">This week</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...weekMinutes].map(([userId, h]) => (
                      <TableRow key={userId}>
                        <TableCell className="font-semibold">{names.get(userId) ?? "Staff member"}</TableCell>
                        <TableCell className="tabular text-right">{formatHours(h.byDate.get(today) ?? 0)}</TableCell>
                        <TableCell className="tabular text-right font-semibold">{formatHours(h.totalMinutes)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <p className="text-xs text-muted-foreground">Worked time is the shift length minus recorded break time, in whole minutes. An open shift or break counts up to now.</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-3">
              <h2 className="font-heading text-lg font-semibold">Recent shifts</h2>
              {recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">No shifts recorded yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {recent.map((s) => (
                    <li key={s.id} className="py-3">
                      <details>
                        <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2 text-sm">
                          <span>
                            <span className="font-semibold">{s.name}</span> <span className="text-muted-foreground">{day(s.businessDate)}</span>
                            {s.corrected && <span className="ml-2 text-xs text-muted-foreground">corrected</span>}
                          </span>
                          <span className="tabular">
                            {time(s.clockInAt)} to {s.clockOutAt ? time(s.clockOutAt) : "now"}
                            <span className="ml-2 text-muted-foreground">{formatHours(workedMinutes(s, s.breaks, now))}</span>
                          </span>
                        </summary>
                        <div className="flex flex-col gap-1 pt-2 text-sm text-muted-foreground">
                          {s.breaks.length > 0 && <div>Breaks: {s.breaks.map((b) => `${time(b.startedAt)} to ${b.endedAt ? time(b.endedAt) : "now"}`).join(", ")}</div>}
                          {(tillByShift.get(s.id) ?? []).map((t) => (
                            <div key={`${t.sessionId}-${t.action}`}>
                              Till {t.action} at {time(t.at)}
                              {t.figures && ` (counted ${formatINR(t.figures.counted, "whole")}, expected ${formatINR(t.figures.expected, "whole")}, difference ${formatINR(t.figures.variance, "whole")})`}
                            </div>
                          ))}
                        </div>
                        {s.breaks.map((b) => (
                          <details key={b.id} className="pt-2">
                            <summary className="cursor-pointer text-sm">Correct break {time(b.startedAt)}</summary>
                            <BreakCorrectForm breakId={b.id} start={formatIstLocal(b.startedAt)} end={b.endedAt ? formatIstLocal(b.endedAt) : ""} />
                          </details>
                        ))}
                        <ShiftCorrectForm shiftId={s.id} clockIn={formatIstLocal(s.clockInAt)} clockOut={s.clockOutAt ? formatIstLocal(s.clockOutAt) : ""} />
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
