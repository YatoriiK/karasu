export function shuffled(length: number, first: number, random: () => number = Math.random) {
  const rest = Array.from({ length }, (_, i) => i).filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [first, ...rest];
}

export function nextPlayableIndex<T>(queue: T[], order: number[], from: number, step: 1 | -1, wrap: boolean, ok: (t: T) => boolean): number {
  const position = order.indexOf(from);
  for (let k = 1; k <= order.length; k++) {
    let p = position + step * k;
    if (p >= order.length || p < 0) {
      if (!wrap) return -1;
      p = (p + order.length) % order.length;
    }
    const candidate = order[p];
    if (queue[candidate] && ok(queue[candidate])) return candidate;
  }
  return -1;
}
