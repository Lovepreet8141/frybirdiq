import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClockCard } from "@/components/staff/clock-card";
import { PageHeader } from "@/components/staff/page-header";
import { ShiftCorrectForm } from "@/components/staff/shift-correct-form";
import { EmptyState } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { addDays, businessDate } from "@/lib/dates";
import { getOpenShift, listOnShiftNow, listShifts } from "@/lib/repositories/shifts";
import { formatHours, formatIstLocal, summariseHours, weekStart } from "@/lib/shifts/hours";

export const metadata: Metadata = { title: "Shifts", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const time = (date: Date) => date.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
const shiftMinutes = (s: { clockInAt: Date; clockOutAt: Date | null }, now: Date) =>
  Math.max(0, Math.floor(((s.clockOutAt ?? now).getTime() - s.clockInAt.getTime()) / 60_000));
const day = (iso: string) => new Date(`${iso}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" });

/**
 * Basic shifts (roadmap 6.4). Everyone signed in clocks themselves and sees who
 * is on shift. Managers (`staff.manage`) also see hours per person per day and
 * week, and may correct a shift. Hours are clock-out minus clock-in: no wages,
 * breaks or overtime.
 */
export default async function ShiftsPage() {
  const staff = await requireStaff();
  const canManage = await staffCan("staff.manage");
  const now = new Date();
  const today = businessDate(now);

  const [mine, onNow] = await Promise.all([getOpenShift(staff.orgId, staff.userId), listOnShiftNow(staff.orgId)]);

  const from = weekStart(addDays(today, -7));
  const recent = canManage ? await listShifts(staff.orgId, from, today) : [];
  const thisWeek = weekStart(today);
  const weekMinutes = summariseHours(recent.filter((s) => s.businessDate >= thisWeek), now);
  const names = new Map(recent.map((s) => [s.userId, s.name]));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader title="Shifts" description="Clock in and out, and see who is on shift." />

      <Card>
        <CardContent className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-semibold">Your shift</h2>
          <ClockCard onShiftSince={mine ? time(mine.clockInAt) : null} />
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
                  <span className="tabular text-muted-foreground">since {time(s.clockInAt)}</span>
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
              <p className="text-xs text-muted-foreground">Hours are clock-out minus clock-in. An open shift counts up to now.</p>
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
                            <span className="ml-2 text-muted-foreground">{formatHours(shiftMinutes(s, now))}</span>
                          </span>
                        </summary>
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
