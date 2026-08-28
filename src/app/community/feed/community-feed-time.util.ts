// src/app/community/feed/community-feed-time.util.ts
const relativeFormatter = new Intl.RelativeTimeFormat('pt-BR', {
  numeric: 'auto',
});
const shortDateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
});

export function formatCommunityFeedIso(publishedAt: number): string {
  return new Date(publishedAt).toISOString();
}

export function formatCommunityFeedTime(
  publishedAt: number,
  now = Date.now()
): string {
  const elapsed = publishedAt - now;
  const absolute = Math.abs(elapsed);

  if (absolute < 60_000) return 'agora';
  if (absolute < 3_600_000) {
    return relativeFormatter.format(Math.round(elapsed / 60_000), 'minute');
  }
  if (absolute < 86_400_000) {
    return relativeFormatter.format(Math.round(elapsed / 3_600_000), 'hour');
  }
  if (absolute < 7 * 86_400_000) {
    return relativeFormatter.format(Math.round(elapsed / 86_400_000), 'day');
  }

  return shortDateFormatter.format(publishedAt);
}
