// Turns the raw "× Error · …" text MCode prints into a message that says whose
// problem it is. Quota and sign-in failures have their own outcomes; this covers
// the rest, chiefly the provider or the network being unreachable.

const PROVIDER_DOWN = /temporarily unavailable|service unavailable|overloaded|bad gateway|gateway time-?out|internal server error/i;
const NETWORK_DOWN = /network|timed? ?out|timeout|ECONN\w*|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up|unreachable/i;

export const STALL_AFTER_MS = 120000;

export const stallNote = 'MiniMax has not answered for 2 minutes. The MiniMax service or this computer\'s connection to it may be down. If it stays like this, stop the turn and try again later.';

export function describeFailure(text) {
  if (typeof text !== 'string' || !text.trim()) return undefined;
  const raw = text.replace(/\s+/g, ' ').trim();
  const code = /\bCode:\s*(\d{3,6})\b/i.exec(raw)?.[1];
  const tag = code ? ` (Code: ${code})` : '';
  if (PROVIDER_DOWN.test(raw)) return `The MiniMax service is unavailable${tag}. This is a problem on the provider's side, not with your message. Wait a few minutes and resend it.`;
  if (NETWORK_DOWN.test(raw)) return `MiniMax Code could not reach the MiniMax service${tag}. Check this computer's internet connection, VPN or proxy, then resend your message.`;
  if (code) return `MiniMax Code reported an error${tag}: ${raw.slice(0, 200)}`;
  return undefined;
}
