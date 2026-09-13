/** "30 seconds ago", "4 minutes ago", "Today, 2:48 PM", "12 Sept, 09:15". */
export function relativeTime(iso: string | null, now: number): string {
  if (!iso) return "Never";
  const at = Date.parse(iso);
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return `${seconds} seconds ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const date = new Date(at);
  const today = new Date(now);
  const sameDay = date.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) === today.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
  const time = date.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  return `${date.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}, ${time}`;
}
