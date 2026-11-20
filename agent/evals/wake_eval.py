"""Measures how well "Vivo, ..." is recognised, from speech to command.

    cd agent && set -a && . ./.env && set +a
    .venv/bin/python -m evals.wake_eval --text                     # matcher only, on the written sentences
    .venv/bin/python -m evals.wake_eval --cache /tmp/tts           # real speech: text-to-speech -> Deepgram -> matcher
    .venv/bin/python -m evals.wake_eval --cache /tmp/tts --snr 12  # the same with noise in the room
    .venv/bin/python -m evals.wake_eval --src /path/with/old/code  # measure another version of tavio_assistant

Speech goes through the speech-to-text settings the worker uses (`tavio_assistant.speech`, or the old values if that
module does not exist), in real time, so the transcript and its timing are what a meeting would produce. The
transcripts then go through the collector as a simulated clock, which gives the command and how long it took.
All sentences are made up; nothing from a real meeting is used.
"""

from __future__ import annotations

import argparse
import asyncio
import difflib
import hashlib
import inspect
import json
import os
import re
import statistics
import sys
import time
import unicodedata
import wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
HOOKS: dict[str, bool] = {}  # which optional parts of the new code the run actually used
SAMPLE_RATE = 16000
VOICES = {
    "de": ["aura-2-julius-de", "aura-2-viktoria-de", "aura-2-fabian-de"],
    "en": ["aura-2-thalia-en", "aura-2-apollo-en", "aura-2-arcas-en"],
}
PAUSE_S = 2.0
LEAD_S = 0.5
TAIL_S = 3.0


def norm(text: str) -> str:
    plain = "".join(unicodedata.normalize("NFD", c)[0] for c in text)
    return re.sub(r"[^\w]+", " ", plain.lower()).strip()


def similar(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, norm(a), norm(b)).ratio()


# ---- speech -----------------------------------------------------------------------------------------------------

async def synthesize(session, voice: str, text: str, cache: Path):
    import numpy as np

    key = hashlib.sha1(f"{voice}|{text}".encode()).hexdigest()[:16]
    path = cache / f"{key}.wav"
    if not path.exists():
        async with session.post(
            "https://api.deepgram.com/v1/speak",
            params={"model": voice, "encoding": "linear16", "container": "wav", "sample_rate": str(SAMPLE_RATE)},
            headers={"Authorization": f"Token {os.environ['DEEPGRAM_API_KEY']}", "Content-Type": "application/json"},
            json={"text": text},
        ) as response:
            body = await response.read()
            if response.status != 200:
                raise RuntimeError(f"TTS {voice} failed: {response.status} {body[:120]!r}")
        path.write_bytes(body)
    with wave.open(str(path)) as wav:
        return np.frombuffer(wav.readframes(wav.getnframes()), dtype=np.int16)


def silence(seconds: float):
    import numpy as np
    return np.zeros(int(seconds * SAMPLE_RATE), dtype=np.int16)


def with_noise(audio, snr_db: float, seed: int):
    """Room noise: low-passed noise, the way a fan or street sounds, at a signal-to-noise ratio against the speech."""
    import numpy as np

    rng = np.random.default_rng(seed)
    noise = rng.normal(size=audio.shape[0])
    noise = np.convolve(noise, np.ones(8) / 8, mode="same")
    voiced = audio[np.abs(audio) > 500].astype(np.float64)
    speech_rms = np.sqrt(np.mean(voiced ** 2)) if voiced.size else 1000.0
    noise *= speech_rms / (10 ** (snr_db / 20)) / (np.sqrt(np.mean(noise ** 2)) or 1.0)
    return np.clip(audio.astype(np.float64) + noise, -32768, 32767).astype(np.int16)


def make_stt(wake_dir: str, language: str, session):
    """The worker's own settings when it has them in one place, else the values the old worker had inline."""
    try:
        from tavio_assistant.speech import make_stt as production
        HOOKS["speech.make_stt"] = True
        return production(language, http_session=session), True
    except ImportError:
        from livekit.plugins import deepgram
        return deepgram.STT(model="nova-3", language="de", keyterm=["Vivo"], smart_format=True, endpointing_ms=600, http_session=session), False


async def transcribe(stt, audio):
    """Streams the audio in real time and returns every transcript event with its arrival time."""
    from livekit import rtc
    from livekit.agents import stt as stt_api

    stream = stt.stream()
    t0 = time.monotonic()
    events: list[dict] = []

    async def read():
        async for event in stream:
            if event.type not in (stt_api.SpeechEventType.FINAL_TRANSCRIPT, stt_api.SpeechEventType.INTERIM_TRANSCRIPT) or not event.alternatives:
                continue
            alt = event.alternatives[0]
            if not alt.text.strip():
                continue
            events.append({
                "t": time.monotonic() - t0, "final": event.type == stt_api.SpeechEventType.FINAL_TRANSCRIPT,
                "text": alt.text.strip(), "start": alt.start_time, "end": alt.end_time,
            })

    reader = asyncio.create_task(read())
    chunk = SAMPLE_RATE // 10
    for i in range(0, len(audio), chunk):
        piece = audio[i:i + chunk]
        stream.push_frame(rtc.AudioFrame(data=piece.tobytes(), sample_rate=SAMPLE_RATE, num_channels=1, samples_per_channel=len(piece)))
        await asyncio.sleep(0.1)
    audio_end = time.monotonic() - t0
    stream.end_input()
    await asyncio.wait_for(reader, timeout=20)
    await stream.aclose()
    return events, audio_end


# ---- matching -----------------------------------------------------------------------------------------------------

def replay(wake, events: list[dict], audio_end: float, lang: str, collector_args: dict, asks_back: bool = False):
    """The finals go through the collector on a simulated clock. Returns the commands with when each came out."""
    collector = wake.CommandCollector(**collector_args)
    params = inspect.signature(collector.feed).parameters
    commands: list[tuple[float, object]] = []
    finals = [e for e in events if e["final"]]

    def advance(until: float, now: float) -> float:
        while now < until:
            now += 0.05
            for c in collector.due(now):
                commands.append((now, c))
                if asks_back and hasattr(collector, "expect_followup"):
                    # A command with a pause in it comes out as its first half; the model asks what is missing, and the second half is the answer.
                    HOOKS["follow-up"] = True
                    collector.expect_followup(c.speaker_id or "lena", now)
        return now

    now = 0.0
    for event in sorted((e for e in events if e["final"] or hasattr(collector, "activity")), key=lambda e: e["t"]):
        now = advance(event["t"], now)
        if not event["final"]:
            HOOKS["activity"] = True
            collector.activity("lena", event["t"], span=(event["start"], event["end"]))
            continue
        extra = {}
        if "span" in params:
            HOOKS["span"] = True
            extra["span"] = (event["start"], event["end"])
        if "wall" in params:
            extra["wall"] = event["t"]
        if "language" in params:
            extra["language"] = lang
        collector.feed("lena", "Lena", event["text"], now=event["t"], **extra)
        now = max(now, event["t"])
    advance((finals[-1]["t"] if finals else audio_end) + 15, now)
    return commands


def run_case(wake, case: dict, events: list[dict], audio_end: float, collector_args: dict):
    commands = replay(wake, events, audio_end, case["lang"], collector_args, asks_back=case["kind"] == "pause")
    heard = None
    sniff = getattr(wake, "hears_wake", None)
    HOOKS["hears_wake"] = HOOKS.get("hears_wake", False) or bool(sniff)
    if sniff:
        heard = next((e["t"] - audio_end for e in events if not e["final"] and sniff(e["text"], final=False)), None)
    first = commands[0] if commands else None
    return {
        "id": case["id"], "split": case["split"], "lang": case["lang"], "kind": case["kind"], "positive": case["positive"],
        "heard": " | ".join(e["text"] for e in events if e["final"]),
        "commands": [c.command for _, c in commands],
        "woke": bool(commands),
        # A command said with a pause in it comes out as two, the second a follow-up to Vivo asking back (assumed for these cases): the chain counts.
        "similarity": (similar(" ".join(c.command for _, c in commands) if case["kind"] == "pause" else first[1].command, case["expect"])
                       if first and case.get("expect") is not None else None),
        "latency": (first[0] - audio_end) if first else None,
        "heard_latency": heard,
    }


# ---- report -------------------------------------------------------------------------------------------------------

def pct(n: int, d: int) -> str:
    return f"{100 * n / d:5.1f} % ({n}/{d})" if d else "   -"


def summarize(results: list[dict], title: str) -> None:
    print(f"\n== {title}")
    pos = [r for r in results if r["positive"]]
    neg = [r for r in results if not r["positive"]]
    woke = [r for r in pos if r["woke"]]
    right = [r for r in pos if r["similarity"] is not None and r["similarity"] >= 0.8]
    print(f"  woke on a command      {pct(len(woke), len(pos))}")
    print(f"  right command (≥0.8)   {pct(len(right), len(pos))}")
    print(f"  woke on other talk     {pct(len([r for r in neg if r['woke']]), len(neg))}   (lower is better)")
    lat = [r["latency"] for r in right if r["latency"] is not None]
    if lat:
        print(f"  seconds from the end of speech to the command: median {statistics.median(lat):.2f}, p90 {sorted(lat)[int(0.9 * (len(lat) - 1))]:.2f}")
    hl = [r["heard_latency"] for r in pos if r["heard_latency"] is not None]
    if hl:
        print(f"  seconds from the end of speech to 'heard you' (interim): median {statistics.median(hl):.2f}  ({len(hl)}/{len(pos)} had one)")
    sentences: dict[str, list[bool]] = {}
    for r in pos:
        sentences.setdefault(r["id"], []).append(r["similarity"] is not None and r["similarity"] >= 0.8)
    print(f"  sentences right in every voice {pct(len([v for v in sentences.values() if all(v)]), len(sentences))}; in none {pct(len([v for v in sentences.values() if not any(v)]), len(sentences))}")
    for label, key in (("by kind", "kind"), ("by language", "lang"), ("by half", "split")):
        parts = []
        for value in sorted({r[key] for r in results}):
            p = [r for r in pos if r[key] == value]
            n = [r for r in neg if r[key] == value]
            ok = len([r for r in p if r["similarity"] is not None and r["similarity"] >= 0.8])
            bad = len([r for r in n if r["woke"]])
            parts.append(f"{value}: {ok}/{len(p)} right" + (f", {bad}/{len(n)} false" if n else ""))
        print(f"  {label:12} " + "; ".join(parts))


async def amain(args) -> None:
    sys.path.insert(0, args.src)
    import tavio_assistant.wake as wake
    from evals.wake_cases import cases as load_cases

    wanted = [c for c in load_cases() if (not args.only or re.search(args.only, c["id"]))]
    collector_args = {k: float(v) for k, v in (item.split("=") for item in args.collector)}
    print(f"code: {wake.__file__}; {len(wanted)} cases")

    results: list[dict] = []
    if args.text:
        for case in wanted:
            texts = case.get("parts") or [case["say"]]
            events = [{"t": 1.0 + 2.5 * i, "final": True, "text": t, "start": 2.5 * i, "end": 2.5 * i + 1.5} for i, t in enumerate(texts)]
            results.append(run_case(wake, case, events, audio_end=1.0 + 2.5 * len(texts), collector_args=collector_args))
        summarize(results, "written sentences (matcher only)")
        write(results, args)
        return

    if args.replay:
        saved = json.loads(Path(args.replay).read_text())
        by_id = {c["id"]: c for c in wanted}
        for item in saved:
            if item["id"] in by_id:
                result = run_case(wake, by_id[item["id"]], item["events"], item["audio_end"], collector_args)
                result["voice"] = item["voice"]
                results.append(result)
        summarize(results, f"replayed from {args.replay}")
        write(results, args)
        report_misses(results)
        return

    import aiohttp

    cache = Path(args.cache)
    cache.mkdir(parents=True, exist_ok=True)
    gate = asyncio.Semaphore(args.concurrency)
    async with aiohttp.ClientSession() as session:
        stt_cache: dict[str, object] = {}
        saved_events: list[dict] = []
        production = False

        def stt_for(lang: str):
            nonlocal production
            if lang not in stt_cache:
                stt_cache[lang], production = make_stt(args.src, args.stt_lang if args.stt_lang != "auto" else lang, session)
            return stt_cache[lang]

        async def one(case: dict, voice: str, n: int):
            async with gate:
                texts = case.get("parts") or [case["say"]]
                pieces = [silence(LEAD_S)]
                for i, text in enumerate(texts):
                    if i:
                        pieces.append(silence(PAUSE_S))
                    pieces.append(await synthesize(session, voice, text, cache))
                import numpy as np
                audio = np.concatenate(pieces)
                if args.snr:
                    audio = with_noise(audio, args.snr, seed=n)
                spoken_end = audio.shape[0] / SAMPLE_RATE
                audio = np.concatenate([audio, silence(TAIL_S)])
                for attempt in range(3):
                    try:
                        events, _ = await transcribe(stt_for(case["lang"]), audio)
                        break
                    except Exception as error:  # a dropped connection is retried, not counted as a miss
                        if attempt == 2:
                            print("  failed:", case["id"], voice, type(error).__name__, error)
                            return None
                        await asyncio.sleep(1)
                result = run_case(wake, case, events, spoken_end, collector_args)
                result["voice"] = voice
                saved_events.append({"id": case["id"], "voice": voice, "events": events, "audio_end": spoken_end})
                return result

        jobs = [one(case, voice, n) for n, case in enumerate(wanted) for voice in VOICES[case["lang"]][:args.voices]]
        for done in await asyncio.gather(*jobs):
            if done:
                results.append(done)
        print(f"speech-to-text settings: {'tavio_assistant.speech' if production else 'old inline values (de only, endpointing 600)'}")
    if args.save_events:
        Path(args.save_events).write_text(json.dumps(saved_events, ensure_ascii=False))
    title = f"speech (stt language {args.stt_lang}), {args.voices} voices per language" + (f", noise {args.snr} dB SNR" if args.snr else "")
    summarize(results, title)
    write(results, args)
    report_misses(results)


def report_misses(results: list[dict]) -> None:
    print(f"\nOptional parts of the code that were used: {HOOKS}")
    print("Misses (positive, wrong or no command) and false wakes:")
    for r in sorted(results, key=lambda r: r["id"]):
        who = r.get("voice", "?")[7:13]
        if r["positive"] and not (r["similarity"] is not None and r["similarity"] >= 0.8):
            print(f"  {r['id']} {who:8} heard {r['heard']!r} -> {r['commands']}")
        if not r["positive"] and r["woke"]:
            print(f"  {r['id']} {who:8} FALSE heard {r['heard']!r} -> {r['commands']}")


def write(results: list[dict], args) -> None:
    if args.out:
        Path(args.out).write_text(json.dumps(results, ensure_ascii=False, indent=1))


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--src", default=str(HERE.parent), help="directory that holds the tavio_assistant package to measure")
    p.add_argument("--text", action="store_true", help="skip speech, run the written sentences")
    p.add_argument("--cache", default="/tmp/tavio-eval-tts")
    p.add_argument("--voices", type=int, default=3)
    p.add_argument("--snr", type=float, default=0)
    p.add_argument("--concurrency", type=int, default=10)
    p.add_argument("--only", default="")
    p.add_argument("--out", default="")
    p.add_argument("--stt-lang", default="auto", help="auto = each case's own language; or de, en, multi for all")
    p.add_argument("--collector", nargs="*", default=[], help="CommandCollector settings, e.g. quiet_done_s=0.9")
    p.add_argument("--save-events", default="", help="keep the raw transcript events, to replay the matcher without speech")
    p.add_argument("--replay", default="", help="run the matcher on events saved with --save-events")
    args = p.parse_args()
    sys.path.insert(1, str(HERE.parent))
    asyncio.run(amain(args))


if __name__ == "__main__":
    main()
