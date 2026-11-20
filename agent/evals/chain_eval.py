"""Speech to action for talk that is not for the assistant: of the sentences that wake the matcher, how many make it do something?

    cd agent && set -a && . ./.env && set +a
    .venv/bin/python -m evals.wake_eval --cache /tmp/tts --out /tmp/wake.json     # real speech, matcher
    .venv/bin/python -m evals.chain_eval /tmp/wake.json                           # what the model does with what woke it

Takes the negative sentences from a wake_eval result file that the matcher let through, hands the transcript to the
assistant exactly as it would receive it, with the real model and a recorder in place of Convex.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


async def main(path: str, src: str, concurrency: int) -> None:
    import json

    sys.path.insert(0, src)
    import tavio_assistant.brain as brain_mod
    import tavio_assistant.wake as wake_mod
    from openai import AsyncOpenAI
    from evals.brain_eval import NOW, Recorder, make_command
    from evals.brain_cases import ROOM

    results = json.loads(Path(path).read_text())
    negatives = [r for r in results if not r["positive"]]
    woken = [r for r in negatives if r["woke"]]
    llm = AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"], max_retries=3, timeout=60)
    model = os.environ["LLM_MODEL"]
    gate = asyncio.Semaphore(concurrency)

    async def one(r):
        async with gate:
            api = Recorder(ROOM["empty"])
            brain = brain_mod.Brain(llm, model, api, clock=lambda: NOW)
            command = make_command(wake_mod.Command, speaker="Lena", speaker_id="lena", heard=r["heard"], command=r["commands"][0], started_wall=NOW, language=r["lang"])
            try:
                try:
                    transcript = brain_mod.Transcript(started=NOW - 3600)
                except TypeError:  # an older version without it
                    transcript = brain_mod.Transcript()
                await asyncio.wait_for(brain.handle(command, transcript), timeout=90)
            except Exception as e:
                api.calls.append(("error", {"why": str(e)[:60]}))
            return r, api.calls

    done = await asyncio.gather(*[one(r) for r in woken])
    await llm.close()
    acted = [(r, c) for r, c in done if c]
    print(f"code: {brain_mod.__file__}")
    print(f"talk that is not for the assistant: {len(negatives)} sentences (3 voices each counted separately)")
    print(f"  woke the matcher:                    {len(woken)}")
    print(f"  of those, it did or said something:  {len(acted)}  ({100 * len(acted) / max(1, len(negatives)):.1f} % of all talk)")
    for r, calls in acted:
        print(f"    {r['id']} heard {r['heard']!r} -> {[n.split(':')[-1] for n, _ in calls]}")


if __name__ == "__main__":
    sys.path.insert(1, str(HERE.parent))
    src = sys.argv[2] if len(sys.argv) > 2 else str(HERE.parent)
    asyncio.run(main(sys.argv[1], src, 3))
