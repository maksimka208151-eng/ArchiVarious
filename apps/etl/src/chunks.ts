/** Prefer line or word boundaries without discarding source characters. */
export function chunks(text: string, limit = 6000): string[] {
  const result: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const minimum = Math.floor(limit / 2);
    let end = rest.lastIndexOf("\n", limit - 1);
    if (end < minimum) end = rest.lastIndexOf(" ", limit - 1);
    if (end < minimum) end = limit;
    else end++;
    result.push(rest.slice(0, end));
    rest = rest.slice(end);
  }
  if (rest) result.push(rest);
  return result;
}
