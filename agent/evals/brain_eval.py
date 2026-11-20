"""Measures what the assistant does with a spoken command, against the real model (the gateway in LLM_BASE_URL).

    cd agent && set -a && . ./.env && set +a
    .venv/bin/python -m evals.brain_eval --repeat 2
    .venv/bin/python -m evals.brain_eval --src /path/with/old/code     # measure another version of tavio_assistant

Convex is replaced by a recorder, so only the model's choice of tools and arguments is judged. The cases are in
`brain_cases.py`; they are made up.
"""

from __future__ import annotations

import argparse
import asyncio
import dataclasses
import json
import os
import re
import statistics
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
NOW = 1794567600  # 2026-11-13 12:00 in Europe/Berlin; the cases are written for this day


class Recorder:
    """Stands in for Convex: keeps every mutation the assistant sends."""

    def __init__(self, room: dict):
        self.room = room
        self.calls: list[tuple[str, dict]] = []

    async def mutation(self, name: str, args: dict):
        args = {k: v for k, v in args.items() if k not in ("commandId", "heard")}
        self.calls.append((name, args))
        if name == "assistant:addToBoard":
            return {"editId": "x", "count": len(args.get("items", [])), "ids": {i.get("key", f"k{n}"): f"new-{n}" for n, i in enumerate(args.get("items", []))}}
        return {"editId": "x", "count": 1}

    async def query(self, name: str, args: dict):
        return self.room


def make_command(cls, **fields):
    names = {f.name for f in dataclasses.fields(cls)}
    return cls(**{k: v for k, v in fields.items() if k in names})


def position(wake_mod, case: dict) -> str:
    """Where the name stood, as the matcher of that version says (older versions have none)."""
    if case.get("kind"):
        return case["kind"]
    find = getattr(wake_mod, "find_wake", None)
    wake = find(case.get("full", f"Vivo, {case['say']}")) if find else None
    return wake.kind if wake else "start"


async def run_case(brain_mod, wake_mod, llm, model: str, case: dict, rooms: dict):
    api = Recorder(rooms[case.get("room", "empty")])
    brain = brain_mod.Brain(llm, model, api, clock=lambda: NOW)
    transcript = brain_mod.Transcript()
    # Joining a minute before the first thing said, as a worker that was there all along.
    if hasattr(transcript, "started"):
        transcript.started = NOW - 3600
    for ago, line in case.get("heard", []):
        speaker, text = line.split(": ", 1)
        transcript.add(at=NOW - ago, speaker=speaker, text=text)
    history = getattr(brain, "history", None)
    for ago, speaker, command, outcome in case.get("history", []):
        if history is not None:
            history.add(at=NOW - ago, speaker=speaker, command=command, outcome=outcome)
    speaker = case.get("speaker", "Lena")
    command = make_command(wake_mod.Command, speaker=speaker, speaker_id=speaker.lower(), heard=case.get("full", f"Vivo, {case['say']}"), command=case["say"],
                           started_wall=NOW, kind=position(wake_mod, case), language="en" if case["id"].startswith("en-") else "de")
    started = time.monotonic()
    error = None
    try:
        await asyncio.wait_for(brain.handle(command, transcript), timeout=90)
    except Exception as e:  # a failure of the model call counts against the case
        error = f"{type(e).__name__}: {e}"
    return api.calls, time.monotonic() - started, error


def judge(case: dict, calls: list[tuple[str, dict]], error: str | None) -> tuple[bool, str]:
    if error:
        return False, f"error {error[:80]}"
    names = [n for n, _ in calls]
    dump = json.dumps([a for _, a in calls], ensure_ascii=False).lower()
    if case.get("silent"):
        return (not calls), ("did " + ", ".join(n.split(":")[1] for n in names) if calls else "")
    if not any(n in case["any"] for n in names):
        return False, "did " + (", ".join(n.split(":")[1] for n in names) or "nothing")
    missing = [w for w in case.get("has", []) if not any(alt in dump for alt in w.split("|"))]
    if missing:
        return False, f"missing {missing}"
    present = [w for w in case.get("avoid", []) if w in dump]
    if present:
        return False, f"contained {present}"
    return True, ""


async def amain(args) -> None:
    sys.path.insert(0, args.src)
    import tavio_assistant.brain as brain_mod
    import tavio_assistant.wake as wake_mod
    from openai import AsyncOpenAI
    from evals.brain_cases import CASES, ROOM

    llm = AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"], max_retries=3, timeout=60)
    model = os.environ["LLM_MODEL"]
    cases = [c for c in CASES if not args.only or re.search(args.only, c["id"])]
    print(f"code: {brain_mod.__file__}; model {model}; {len(cases)} cases x {args.repeat}")
    gate = asyncio.Semaphore(args.concurrency)

    async def one(case: dict, n: int):
        async with gate:
            calls, seconds, error = await run_case(brain_mod, wake_mod, llm, model, case, ROOM)
        ok, why = judge(case, calls, error)
        return {"id": case["id"], "group": case["group"], "run": n, "ok": ok, "why": why, "seconds": seconds,
                "did": [n for n, _ in calls], "calls": [[n, json.dumps(a, ensure_ascii=False)[:300]] for n, a in calls]}

    results = await asyncio.gather(*[one(c, n) for c in cases for n in range(args.repeat)])
    await llm.close()

    ok = [r for r in results if r["ok"]]
    print(f"\npassed {len(ok)}/{len(results)} ({100 * len(ok) / len(results):.1f} %)")
    secs = [r["seconds"] for r in results]
    print(f"seconds per command: median {statistics.median(secs):.1f}, p90 {sorted(secs)[int(0.9 * (len(secs) - 1))]:.1f}")
    for group in dict.fromkeys(c["group"] for c in cases):
        rs = [r for r in results if r["group"] == group]
        print(f"  {group:9} {len([r for r in rs if r['ok']])}/{len(rs)}")
    print("\nfailures:")
    for r in sorted(results, key=lambda r: (r["id"], r["run"])):
        if not r["ok"]:
            print(f"  {r['id']:18} run {r['run']}: {r['why']}")
            if args.show:
                for name, call in r["calls"]:
                    print(f"      {name.split(':')[1]} {call}")
    if args.out:
        Path(args.out).write_text(json.dumps(results, ensure_ascii=False, indent=1))


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--src", default=str(HERE.parent))
    p.add_argument("--repeat", type=int, default=2)
    p.add_argument("--concurrency", type=int, default=4)
    p.add_argument("--only", default="")
    p.add_argument("--show", action="store_true", help="print what it did in the failed runs")
    p.add_argument("--out", default="")
    args = p.parse_args()
    sys.path.insert(1, str(HERE.parent))
    asyncio.run(amain(args))


if __name__ == "__main__":
    main()
