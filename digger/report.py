import html

from . import DATA
from .publish import playlist_name
from .score import human
from .util import now

STYLE = """
:root{--bg:#16181b;--panel:#1c1f23;--line:#33373d;--text:#d8dade;--dim:#8b9097;--accent:#e0a526}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 "Segoe UI",system-ui,sans-serif}
main{max-width:1040px;margin:0 auto;padding:16px}
h1{font-size:18px;margin:4px 0 2px}
h2{font-size:15px;margin:22px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--line)}
.sub{color:var(--dim);font-size:12.5px}
.pick{display:grid;grid-template-columns:30px 1fr auto;gap:10px;align-items:start;border:1px solid var(--line);
background:var(--panel);padding:9px 10px;margin:6px 0}
.n{color:var(--dim);font-variant-numeric:tabular-nums}
.t{font-weight:600}.a{color:var(--dim)}
.why{color:var(--dim);font-size:12.5px;margin-top:3px}
.tag{display:inline-block;font-size:11px;border:1px solid var(--line);padding:0 6px;margin-left:6px;color:var(--accent)}
.side{display:flex;flex-direction:column;gap:4px;align-items:flex-end}
audio{width:230px;height:28px}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
table{border-collapse:collapse;width:100%;font-size:12.5px}
td,th{border:1px solid var(--line);padding:4px 8px;text-align:left}
th{color:var(--dim);font-weight:600}
@media (max-width:640px){.pick{grid-template-columns:24px 1fr}.side{grid-column:2;align-items:flex-start}audio{width:100%}}
"""


def _e(text):
    return html.escape(str(text if text is not None else ""))


def _pick(i, c):
    links = [f'<a href="https://www.deezer.com/track/{c.dz_id}" target="_blank">Deezer</a>']
    if c.sp_id:
        links.insert(0, f'<a href="https://open.spotify.com/track/{c.sp_id}" target="_blank">Spotify</a>')
    audio = f'<audio controls preload="none" src="{_e(c.preview)}"></audio>' if c.preview else ""
    album = f" · {_e(c.album)}" if c.album else ""
    return (
        f'<div class="pick"><div class="n">{i}</div><div><div><span class="t">{_e(c.title)}</span>'
        f'<span class="tag">{_e(c.source)}</span><span class="tag">{c.score:.2f}</span></div>'
        f'<div class="a">{_e(c.artist)}{album}</div><div class="why">{_e(c.reasons)}</div></div>'
        f'<div class="side">{audio}<div>{" · ".join(links)}</div></div></div>'
    )


def write(cfg, taste, picks, missing, stats, counts, dry_run):
    stamp = now()
    out = DATA / "reports" / f"{stamp.strftime('%Y-%m-%d_%H%M')}{'_dry' if dry_run else ''}.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    parts = [
        "<!doctype html><html lang=en><head><meta charset=utf-8>",
        "<meta name=viewport content='width=device-width,initial-scale=1'>",
        f"<title>Karasu {stamp.strftime('%b %d')}</title><style>{STYLE}</style></head><body><main>",
        f"<h1>Karasu picks</h1><div class=sub>{stamp.strftime('%Y-%m-%d %H:%M UTC')}"
        f"{' · dry run, nothing sent to Spotify' if dry_run else ''} · "
        f"{len(taste.seed_ids)} seed tracks, {len(taste.modes)} taste modes</div>",
    ]
    for lane in ("fresh", "lost"):
        chosen = picks.get(lane) or []
        parts.append(f"<h2>{_e(playlist_name(cfg, lane))} <span class=sub>({len(chosen)})</span></h2>")
        if not chosen:
            parts.append("<div class=sub>Nothing passed the filters this time.</div>")
        parts += [_pick(i, c) for i, c in enumerate(chosen, 1)]
    if missing:
        parts.append("<h2>Good picks that aren't on Spotify</h2>")
        parts += [_pick(i, c) for i, c in enumerate(missing, 1)]
    if len(taste.modes):
        parts.append("<h2>Your taste modes</h2><table><tr><th>#</th><th>Anchor track</th><th>Weight</th></tr>")
        total = float(taste.mode_weights.sum()) or 1.0
        for i, (label, weight) in enumerate(zip(taste.mode_labels, taste.mode_weights)):
            parts.append(f"<tr><td>{i}</td><td>{_e(label)}</td><td>{weight / total:.0%}</td></tr>")
        parts.append("</table>")
    parts.append("<h2>Pipeline</h2><table><tr><th>Step</th><th>Count</th></tr>")
    for key, value in list(counts.items()) + [(f"filtered: {k}", v) for k, v in stats.items()]:
        parts.append(f"<tr><td>{_e(key)}</td><td>{_e(human(value) if isinstance(value, int) else value)}</td></tr>")
    parts.append("</table></main></body></html>")
    out.write_text("".join(parts), encoding="utf-8")
    return out
