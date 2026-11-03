import hashlib
import json

import numpy as np

GROUPS = ("mood", "energy", "instrument", "vocals", "production", "genre", "era")

VOCAB = [
    ("mood", "melancholic", "Melancholic", ["melancholic sad music", "a melancholy song", "sad and wistful music"]),
    ("mood", "happy", "Happy", ["happy upbeat music", "a joyful cheerful song"]),
    ("mood", "euphoric", "Euphoric", ["euphoric uplifting music", "an ecstatic euphoric song"]),
    ("mood", "dark", "Dark", ["dark ominous music", "a dark brooding song"]),
    ("mood", "dreamy", "Dreamy", ["dreamy hazy music", "a dreamy ethereal song"]),
    ("mood", "aggressive", "Aggressive", ["aggressive intense music", "an angry aggressive song"]),
    ("mood", "chill", "Chill", ["chill relaxed music", "a laid back mellow song"]),
    ("mood", "romantic", "Romantic", ["romantic love song", "tender romantic music"]),
    ("mood", "nostalgic", "Nostalgic", ["nostalgic bittersweet music", "a nostalgic song"]),
    ("mood", "mysterious", "Mysterious", ["mysterious atmospheric music", "a mysterious eerie song"]),
    ("mood", "hopeful", "Hopeful", ["hopeful optimistic music", "an inspiring hopeful song"]),
    ("mood", "peaceful", "Peaceful", ["peaceful calm serene music", "a soothing peaceful song"]),
    ("mood", "playful", "Playful", ["playful fun quirky music", "a playful silly song"]),
    ("mood", "sensual", "Sensual", ["sensual smooth seductive music", "a sultry song"]),
    ("mood", "triumphant", "Triumphant", ["triumphant epic music", "a heroic triumphant song"]),
    ("mood", "anxious", "Anxious", ["anxious tense music", "a nervous restless song"]),
    ("mood", "lonely", "Lonely", ["lonely isolated music", "a lonely late night song"]),
    ("mood", "warm", "Warm", ["warm cozy music", "a warm comforting song"]),
    ("mood", "hypnotic", "Hypnotic", ["hypnotic repetitive trance-like music"]),
    ("mood", "gritty", "Gritty", ["gritty raw street music", "a gritty rough song"]),
    ("energy", "very_calm", "Very calm", ["very quiet calm ambient music", "slow quiet gentle music"]),
    ("energy", "laid_back", "Laid-back", ["slow laid back groove", "relaxed slow tempo music"]),
    ("energy", "mid", "Mid-tempo", ["mid tempo steady music"]),
    ("energy", "energetic", "Energetic", ["energetic fast music", "high energy upbeat song"]),
    ("energy", "intense", "Intense", ["very intense loud fast music", "explosive high energy music"]),
    ("energy", "danceable", "Danceable", ["danceable groovy music", "music you can dance to"]),
    ("instrument", "guitar_clean", "Clean guitar", ["clean electric guitar", "chiming clean electric guitar"]),
    ("instrument", "guitar_fuzz", "Fuzzy guitar", ["distorted fuzzy electric guitar", "heavy fuzz guitar"]),
    ("instrument", "guitar_acoustic", "Acoustic guitar", ["acoustic guitar", "fingerpicked acoustic guitar"]),
    ("instrument", "guitar_jangle", "Jangly guitar", ["jangly guitar pop", "jangle pop guitar"]),
    ("instrument", "guitar_riff", "Guitar riffs", ["heavy guitar riff", "catchy electric guitar riff",
                                                   "a song driven by a distorted guitar riff", "crunchy rock guitar riff"]),
    ("instrument", "guitar_solo", "Guitar solos", ["electric guitar solo", "a blistering lead guitar solo",
                                                   "virtuoso guitar solo with string bends", "wailing blues guitar solo"]),
    ("instrument", "guitar_shred", "Shredding", ["fast technical shredding guitar", "metal guitar shredding solo"]),
    ("instrument", "guitar_twinkly", "Twinkly guitar", ["twinkly clean guitar arpeggios", "math rock tapping guitar",
                                                        "noodly emo guitar riffs"]),
    ("instrument", "piano", "Piano", ["piano", "solo piano music"]),
    ("instrument", "rhodes", "Electric piano", ["rhodes electric piano", "warm electric piano chords"]),
    ("instrument", "synth_analog", "Analog synth", ["analog synthesizer", "vintage analog synth"]),
    ("instrument", "synth_pad", "Synth pads", ["lush synth pads", "ambient synthesizer pads"]),
    ("instrument", "bass_808", "808 bass", ["booming 808 bass", "deep 808 sub bass"]),
    ("instrument", "bass_upright", "Upright bass", ["upright double bass", "walking upright bass"]),
    ("instrument", "bass_electric", "Bass guitar", ["prominent electric bass guitar", "funky bass guitar"]),
    ("instrument", "strings", "Strings", ["orchestral strings", "string section violins and cellos"]),
    ("instrument", "horns", "Horns", ["brass horn section", "trumpets and horns"]),
    ("instrument", "saxophone", "Saxophone", ["saxophone", "jazz saxophone solo"]),
    ("instrument", "trumpet", "Trumpet", ["muted jazz trumpet", "trumpet melody"]),
    ("instrument", "flute", "Flute", ["flute melody", "jazz flute"]),
    ("instrument", "organ", "Organ", ["hammond organ", "church organ"]),
    ("instrument", "harp", "Harp", ["harp", "plucked harp"]),
    ("instrument", "banjo", "Banjo / mandolin", ["banjo", "mandolin and banjo"]),
    ("instrument", "drum_machine", "Drum machine", ["drum machine beat", "programmed drum machine"]),
    ("instrument", "drums_live", "Live drums", ["live acoustic drum kit", "real drummer playing drums"]),
    ("instrument", "breakbeat", "Breakbeats", ["sampled breakbeat drums", "chopped breakbeat"]),
    ("instrument", "trap_hats", "Trap hi-hats", ["rolling trap hi-hats", "trap beat with hi-hat rolls"]),
    ("instrument", "percussion", "Hand percussion", ["congas and bongos percussion", "hand percussion"]),
    ("instrument", "vocal_chops", "Vocal samples", ["chopped vocal samples", "pitched vocal samples"]),
    ("instrument", "scratching", "Turntables", ["turntable scratching", "DJ scratches"]),
    ("instrument", "bells", "Bells / glockenspiel", ["glockenspiel and bells", "music box bells"]),
    ("instrument", "sitar", "Sitar", ["sitar", "indian sitar"]),
    ("instrument", "steel_pan", "Steel drums", ["steel pan drums"]),
    ("vocals", "male", "Male vocals", ["male vocals", "a man singing"]),
    ("vocals", "female", "Female vocals", ["female vocals", "a woman singing"]),
    ("vocals", "rap", "Rapping", ["rapping", "hip hop rap vocals"]),
    ("vocals", "autotune", "Auto-tune", ["autotuned vocals", "heavy autotune singing"]),
    ("vocals", "falsetto", "Falsetto", ["falsetto vocals", "high falsetto singing"]),
    ("vocals", "choir", "Choir", ["choir", "choral voices"]),
    ("vocals", "spoken", "Spoken word", ["spoken word", "talking over music"]),
    ("vocals", "screamed", "Screamed vocals", ["screamed vocals", "screaming hardcore vocals"]),
    ("vocals", "whisper", "Soft vocals", ["soft whispered vocals", "breathy quiet singing"]),
    ("vocals", "harmonies", "Harmonies", ["vocal harmonies", "layered harmonized vocals"]),
    ("vocals", "instrumental", "Instrumental", ["instrumental music with no vocals", "an instrumental track"]),
    ("production", "lofi", "Lo-fi", ["lo-fi recording", "lo-fi bedroom recording with tape hiss"]),
    ("production", "polished", "Polished", ["polished modern studio production", "crisp clean production"]),
    ("production", "live", "Live recording", ["live concert recording", "recorded live with audience"]),
    ("production", "reverb", "Reverb-washed", ["reverb drenched washed out sound", "lots of reverb"]),
    ("production", "distorted", "Noisy / distorted", ["noisy distorted production", "harsh noise"]),
    ("production", "vintage", "Vintage recording", ["vintage analog recording", "old vinyl record sound"]),
    ("production", "minimal", "Minimal", ["minimal sparse arrangement", "stripped back minimal song"]),
    ("production", "wall", "Wall of sound", ["dense wall of sound", "thick layered production"]),
    ("production", "bass_heavy", "Bass-heavy", ["bass heavy mix", "booming low end"]),
    ("production", "muffled", "Muffled / warm", ["muffled warm sound", "dusty muffled sample"]),
    ("production", "orchestral", "Orchestral", ["cinematic orchestral production", "film score orchestra"]),
    ("genre", "shoegaze", "Shoegaze", ["shoegaze", "shoegaze with walls of guitar"]),
    ("genre", "slowcore", "Slowcore", ["slowcore", "slow sad indie rock slowcore"]),
    ("genre", "emo", "Emo", ["emo", "midwest emo with twinkly guitars"]),
    ("genre", "dream_pop", "Dream pop", ["dream pop"]),
    ("genre", "indie_rock", "Indie rock", ["indie rock"]),
    ("genre", "bedroom_pop", "Bedroom pop", ["bedroom pop"]),
    ("genre", "post_punk", "Post-punk", ["post-punk", "dark post-punk"]),
    ("genre", "punk", "Punk", ["punk rock", "fast punk"]),
    ("genre", "hardcore", "Hardcore", ["hardcore punk"]),
    ("genre", "metal", "Metal", ["heavy metal", "metal"]),
    ("genre", "grunge", "Grunge", ["grunge", "90s grunge rock"]),
    ("genre", "alt_rock", "Alternative rock", ["alternative rock"]),
    ("genre", "hip_hop", "Hip hop", ["hip hop"]),
    ("genre", "cloud_rap", "Cloud rap", ["cloud rap", "hazy atmospheric rap"]),
    ("genre", "trap", "Trap", ["trap music"]),
    ("genre", "boom_bap", "Boom bap", ["boom bap hip hop", "90s boom bap"]),
    ("genre", "jazz_rap", "Jazz rap", ["jazz rap", "jazzy hip hop"]),
    ("genre", "plugg", "Plugg", ["plugg beat", "pluggnb"]),
    ("genre", "rnb", "R&B", ["r&b", "contemporary rnb"]),
    ("genre", "soul", "Soul", ["soul music", "70s soul"]),
    ("genre", "funk", "Funk", ["funk", "funky groove"]),
    ("genre", "disco", "Disco", ["disco"]),
    ("genre", "house", "House", ["house music"]),
    ("genre", "techno", "Techno", ["techno"]),
    ("genre", "ambient", "Ambient", ["ambient music"]),
    ("genre", "idm", "IDM", ["idm electronic", "glitchy electronic music"]),
    ("genre", "dnb", "Drum & bass", ["drum and bass", "jungle"]),
    ("genre", "synthpop", "Synth-pop", ["synth-pop", "80s synthpop"]),
    ("genre", "new_wave", "New wave", ["new wave"]),
    ("genre", "city_pop", "City pop", ["japanese city pop"]),
    ("genre", "bossa", "Bossa nova", ["bossa nova"]),
    ("genre", "jazz", "Jazz", ["jazz"]),
    ("genre", "spiritual_jazz", "Spiritual jazz", ["spiritual jazz", "cosmic spiritual jazz"]),
    ("genre", "folk", "Folk", ["folk music", "acoustic folk"]),
    ("genre", "singer_songwriter", "Singer-songwriter", ["singer-songwriter"]),
    ("genre", "country", "Country", ["country music"]),
    ("genre", "blues", "Blues", ["blues"]),
    ("genre", "reggae", "Reggae", ["reggae"]),
    ("genre", "dub", "Dub", ["dub", "dub reggae with echo"]),
    ("genre", "afrobeat", "Afrobeat", ["afrobeat", "west african funk"]),
    ("genre", "latin", "Latin", ["latin music", "salsa"]),
    ("genre", "cumbia", "Cumbia", ["cumbia"]),
    ("genre", "kpop", "K-pop", ["k-pop"]),
    ("genre", "jpop", "J-pop", ["j-pop"]),
    ("genre", "classical", "Classical", ["classical music"]),
    ("genre", "soundtrack", "Soundtrack", ["anime soundtrack", "film soundtrack score"]),
    ("genre", "psych", "Psychedelic", ["psychedelic rock", "psychedelic music"]),
    ("genre", "krautrock", "Krautrock", ["krautrock motorik beat"]),
    ("genre", "noise", "Noise", ["noise rock", "experimental noise"]),
    ("genre", "experimental", "Experimental", ["experimental music", "avant-garde"]),
    ("genre", "gospel", "Gospel", ["gospel"]),
    ("genre", "hyperpop", "Hyperpop", ["hyperpop"]),
    ("genre", "phonk", "Phonk", ["phonk"]),
    ("genre", "drill", "Drill", ["drill rap"]),
    ("genre", "lounge", "Lounge", ["lounge exotica"]),
    ("genre", "electronic", "Electronic", ["electronic music"]),
    ("genre", "pop", "Pop", ["pop music"]),
    ("era", "era_60s", "1960s sound", ["1960s recording", "sixties music"]),
    ("era", "era_70s", "1970s sound", ["1970s recording", "seventies music"]),
    ("era", "era_80s", "1980s sound", ["1980s recording", "eighties music"]),
    ("era", "era_90s", "1990s sound", ["1990s recording", "nineties music"]),
    ("era", "era_00s", "2000s sound", ["2000s recording", "music from the 2000s"]),
    ("era", "era_modern", "Modern sound", ["modern 2020s production", "contemporary music"]),
]

IDS = [v[1] for v in VOCAB]
INDEX = {cid: i for i, cid in enumerate(IDS)}
LABELS = {v[1]: v[2] for v in VOCAB}
GROUP_OF = {v[1]: v[0] for v in VOCAB}

ASPECTS = {
    "guitar": [c for c in IDS if c.startswith("guitar_")] + ["distorted", "reverb"],
    "drums": ["drum_machine", "drums_live", "breakbeat", "trap_hats", "percussion"],
    "vocals": [c for c, g in GROUP_OF.items() if g == "vocals"],
    "atmosphere": [c for c, g in GROUP_OF.items() if g == "mood"] + ["reverb", "lofi", "minimal", "wall", "muffled"],
    "production": [c for c, g in GROUP_OF.items() if g == "production"] + [c for c, g in GROUP_OF.items() if g == "era"],
    "instruments": [c for c, g in GROUP_OF.items() if g == "instrument"],
}


def vocab_hash():
    raw = json.dumps(VOCAB, sort_keys=True).encode()
    return int(hashlib.sha1(raw).hexdigest()[:8], 16)


VERSION = vocab_hash()


def concept_matrix(clap):
    rows = []
    for _, _, _, prompts in VOCAB:
        emb = clap.text(prompts)
        vec = emb.mean(axis=0)
        rows.append(vec / max(np.linalg.norm(vec), 1e-9))
    return np.stack(rows).astype(np.float32)


def score(audio_matrix, concepts):
    raw = audio_matrix @ concepts.T
    mean = raw.mean(axis=0, keepdims=True)
    std = raw.std(axis=0, keepdims=True) + 1e-6
    return ((raw - mean) / std).astype(np.float32), mean.ravel(), std.ravel()


def load(db, ids=None):
    if ids is None:
        rows = db.q("select dz_id, vec from facets where version=?", (VERSION,))
    else:
        ids = list(ids)
        rows = []
        for i in range(0, len(ids), 900):
            part = ids[i:i + 900]
            rows += db.q(f"select dz_id, vec from facets where version=? and dz_id in ({','.join('?' * len(part))})",
                         [VERSION] + part)
    return {r["dz_id"]: np.frombuffer(r["vec"], dtype=np.float32) for r in rows}


def top_labels(vec, groups=("mood", "production", "instrument", "vocals"), limit=3, threshold=1.0):
    picks = []
    for i in np.argsort(-vec):
        cid = IDS[i]
        if GROUP_OF[cid] in groups and vec[i] >= threshold:
            picks.append(LABELS[cid])
            if len(picks) >= limit:
                break
    return picks


def top_genres(vec, limit=3, threshold=0.8):
    order = [i for i in np.argsort(-vec) if GROUP_OF[IDS[i]] == "genre" and vec[i] >= threshold]
    return [LABELS[IDS[i]] for i in order[:limit]]


def energy_value(vec):
    if vec is None:
        return None
    raw = 0.45 * vec[INDEX["energetic"]] + 0.35 * vec[INDEX["intense"]] - 0.35 * vec[INDEX["very_calm"]] \
        - 0.25 * vec[INDEX["laid_back"]]
    return float(1 / (1 + np.exp(-raw)))


def aspect_vector(vec, aspect):
    idx = [INDEX[c] for c in ASPECTS[aspect]]
    return vec[idx]


def compute_all(ctx, clap, progress=None):
    from ..audio import model_name

    vecs = ctx.db.vecs(model=model_name(ctx.cfg))
    if not vecs:
        return 0
    ids = list(vecs)
    matrix = np.stack([vecs[i] for i in ids]).astype(np.float32)
    concepts = concept_matrix(clap)
    z, mean, std = score(matrix, concepts)
    ctx.db.set_meta("facet_norm", {"version": VERSION, "mean": mean.tolist(), "std": std.tolist()})
    ctx.db.set_meta("facet_concepts", {"version": VERSION})
    np.save(_concepts_path(), concepts)
    with ctx.db.tx():
        ctx.db.x("delete from facets where version != ?", (VERSION,))
        for n, (dz_id, row) in enumerate(zip(ids, z), 1):
            ctx.db.x("insert or replace into facets(dz_id, vec, version) values(?,?,?)",
                     (dz_id, row.astype(np.float32).tobytes(), VERSION))
            if progress and n % 500 == 0:
                progress(n, len(ids))
    return len(ids)


def _concepts_path():
    from .. import DATA
    return DATA / f"facet_concepts_{VERSION}.npy"


def score_new(ctx, dz_ids):
    from ..audio import model_name

    norm = ctx.db.meta("facet_norm")
    path = _concepts_path()
    if not norm or norm.get("version") != VERSION or not path.exists():
        return 0
    concepts = np.load(path)
    mean, std = np.array(norm["mean"], dtype=np.float32), np.array(norm["std"], dtype=np.float32)
    have = set(load(ctx.db, dz_ids))
    vecs = ctx.db.vecs([i for i in dz_ids if i not in have], model=model_name(ctx.cfg))
    with ctx.db.tx():
        for dz_id, vec in vecs.items():
            z = ((vec @ concepts.T) - mean) / std
            ctx.db.x("insert or replace into facets(dz_id, vec, version) values(?,?,?)",
                     (dz_id, z.astype(np.float32).tobytes(), VERSION))
    return len(vecs)
