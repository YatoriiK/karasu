import math
import re
import unicodedata
from datetime import datetime, timezone

_FEAT = re.compile(
    r"\s*[\(\[]\s*(?:feat\.?|ft\.?|featuring|with)\s[^\)\]]*[\)\]]"
    r"|\s+(?:feat\.?|ft\.?|featuring)\s.+$",
    re.I,
)
_VARIANT_WORDS = (
    r"remaster|remastered|re-master|mono|stereo|version|edit|mix|live|demo|deluxe|bonus|reissue|"
    r"anniversary|single|instrumental|acoustic|session|take|mixed|rerecorded|re-recorded|original"
)
_SUFFIX = re.compile(
    rf"\s*(?:[\(\[][^\)\]]*(?:{_VARIANT_WORDS})[^\)\]]*[\)\]]|\s[-–]\s[^-–]*(?:{_VARIANT_WORDS})[^-–]*)$",
    re.I,
)
_VARIANT = re.compile(r"\b(?:live|remaster(?:ed)?|demo|remix|re-?recorded|karaoke|instrumental)\b", re.I)
_PUNCT = re.compile(r"[^\w\s]", re.U)
_SPACE = re.compile(r"\s+")

JUNK = re.compile(
    r"karaoke|tribute|in the style of|originally performed|made famous|lullab|\b8[- ]?bit\b|slowed|"
    r"sped[ -]?up|nightcore|type beat|white noise|ringtone|cover version|backing track|"
    r"piano version of|music box version|rock version of|metal version of",
    re.I,
)
FILLER = re.compile(
    r"\bsleep (?:music|sounds|aid|meditation|hypnosis)|deep sleep|\bfor sleep(?:ing)?\b|baby sleep|"
    r"lo-?fi (?:beats|hip hop) to|study music|music for (?:study|studying|sleep|focus|relax|reading|work)|"
    r"\bmeditation (?:music|sounds)|relaxing (?:music|piano|sounds|guitar)|rain sounds|ocean waves|spa music|"
    r"yoga music|binaural|\basmr\b|focus music|background music|healing frequenc|\b\d{3}\s?hz\b|chakra|"
    r"brown noise|pink noise|white noise",
    re.I,
)


def fold(text):
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return text.casefold()


def _clean(text):
    text = _PUNCT.sub(" ", text)
    return _SPACE.sub(" ", text).strip()


def norm_artist(name):
    text = fold(name).replace("&", " and ").replace("+", " and ").replace(".", "")
    text = _clean(text)
    if text.startswith("the "):
        text = text[4:]
    return text


def norm_title(title):
    text = title or ""
    for _ in range(3):
        text = _FEAT.sub("", text)
        text = _SUFFIX.sub("", text)
    text = _clean(fold(text))
    return text or _clean(fold(title or ""))


def track_key(artist, title):
    return f"{norm_artist(artist)}|{norm_title(title)}"


def is_variant(title):
    return bool(_VARIANT.search(title or ""))


def is_junk(*texts):
    return any(JUNK.search(t or "") for t in texts)


def is_filler(*texts):
    return any(FILLER.search(t or "") for t in texts)


def year_of(value):
    if not value:
        return None
    match = re.match(r"(\d{4})", str(value))
    if not match:
        return None
    year = int(match.group(1))
    return year if 1900 <= year <= 2100 else None


def now():
    return datetime.now(timezone.utc)


def now_iso():
    return now().strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(value):
    if not value:
        return None
    value = str(value).replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        try:
            dt = datetime.strptime(value[:10], "%Y-%m-%d")
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def days_since(value):
    dt = parse_iso(value)
    if dt is None:
        return None
    return (now() - dt).total_seconds() / 86400


def log_scale(value):
    if value is None:
        return None
    return math.log10(1 + max(0, value))


def percentile_ranks(values):
    present = sorted((v, i) for i, v in enumerate(values) if v is not None)
    out = [None] * len(values)
    n = len(present)
    if n == 0:
        return out
    if n == 1:
        out[present[0][1]] = 0.5
        return out
    i = 0
    while i < n:
        j = i
        while j + 1 < n and present[j + 1][0] == present[i][0]:
            j += 1
        rank = (i + j) / 2 / (n - 1)
        for k in range(i, j + 1):
            out[present[k][1]] = rank
        i = j + 1
    return out


def chunks(items, size):
    items = list(items)
    for i in range(0, len(items), size):
        yield items[i:i + size]
