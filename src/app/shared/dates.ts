/** Today's date as YYYY-MM-DD in the user's local time zone (toISOString() would use UTC and can be off by a day). */
export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
