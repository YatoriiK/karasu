import numpy as np

SHAPES = ("steady", "build", "wave", "winddown")


def curve(shape, n, base=0.55, depth=0.32):
    t = np.linspace(0.0, 1.0, max(n, 1))
    if shape == "build":
        out = base - depth * 0.6 + depth * 1.2 * t
    elif shape == "winddown":
        out = base + depth * 0.6 - depth * 1.2 * t
    elif shape == "wave":
        out = base + depth * 0.55 * np.sin(t * 2 * np.pi * 1.5)
    else:
        out = np.full(len(t), base)
    return np.clip(out, 0.05, 0.95)


def tempo_gap(a, b):
    if not a or not b:
        return 0.35
    return min(abs(a - b), abs(a - 2 * b), abs(2 * a - b)) / 40.0


class Flow:
    def __init__(self, ids, energy, tempo, vecs, artists, shape="steady", target=None):
        self.ids = list(ids)
        n = len(self.ids)
        self.e = np.array([energy.get(i) if energy.get(i) is not None else 0.5 for i in self.ids], dtype=np.float64)
        self.t = [tempo.get(i) for i in self.ids]
        self.a = [artists.get(i) for i in self.ids]
        dim = next((len(v) for v in vecs.values() if v is not None), 0)
        if dim:
            m = np.stack([vecs.get(i) if vecs.get(i) is not None else np.zeros(dim, np.float32) for i in self.ids])
            self.sim = m @ m.T
        else:
            self.sim = np.zeros((n, n))
        base = float(np.median(self.e)) if target is None else float(target)
        self.targets = curve(shape, n, base=base)

    def edge(self, i, j):
        same = 6.0 if self.a[i] and self.a[i] == self.a[j] else 0.0
        return 0.7 * min(tempo_gap(self.t[i], self.t[j]), 1.0) + 0.6 * (1 - float(self.sim[i, j])) + same

    def place(self, j, pos):
        return 2.2 * abs(self.e[j] - self.targets[pos])

    def total(self, seq):
        cost = sum(self.place(j, p) for p, j in enumerate(seq))
        return cost + sum(self.edge(seq[k], seq[k + 1]) for k in range(len(seq) - 1))

    def order(self, passes=2):
        n = len(self.ids)
        if n <= 2:
            return list(self.ids)
        remaining = set(range(n))
        start = min(remaining, key=lambda j: self.place(j, 0))
        seq = [start]
        remaining.discard(start)
        for pos in range(1, n):
            prev = seq[-1]
            best = min(remaining, key=lambda j: self.place(j, pos) + self.edge(prev, j))
            seq.append(best)
            remaining.discard(best)
        if n <= 80:
            best_cost = self.total(seq)
            for _ in range(passes):
                improved = False
                for i in range(1, n - 1):
                    for k in range(i + 1, n):
                        cand = seq[:i] + seq[i:k + 1][::-1] + seq[k + 1:]
                        cost = self.total(cand)
                        if cost < best_cost - 1e-6:
                            seq, best_cost, improved = cand, cost, True
                if not improved:
                    break
        return [self.ids[k] for k in seq]


def order(ids, energy, tempo, vecs, artists, shape="steady", target=None):
    return Flow(ids, energy, tempo, vecs, artists, shape, target).order()


def adjacent_same_artist(ids, artists):
    return sum(1 for a, b in zip(ids, ids[1:]) if artists.get(a) and artists.get(a) == artists.get(b))
