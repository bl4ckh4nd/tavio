"""The worker as a whole, against a real LiveKit server: people speak in a room, the assistant answers.

Needs a LiveKit dev server (`livekit-server --dev`, keys devkey/secret), and the worker running against it:

    cd agent && set -a && . ./.env && set +a
    LIVEKIT_URL=ws://localhost:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret .venv/bin/python -m tavio_assistant.main start &
    .venv/bin/python -m evals.worker_smoke

Two people join with a microphone each (spoken by text-to-speech, in real time) and say a few things. Convex is a small fake
in this script that records what the assistant sends. What it checks is what only a running worker shows: the state the
assistant reports (listening, heard, thinking), a question being answered without the name, each person being listened to in
their own language, talk about the assistant being left alone.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
URL = os.environ.get("LIVEKIT_URL", "ws://localhost:7880")
KEY = os.environ.get("LIVEKIT_API_KEY", "devkey")
SECRET = os.environ.get("LIVEKIT_API_SECRET", "secret")
AGENT = os.environ.get("ASSISTANT_AGENT_NAME", "tavio-assistant")
SAMPLE_RATE = 16000
# A room of its own for each run: a finished one lingers on the server for a while and would not take a new dispatch.
ROOM = f"smoke-{int(time.time())}"


class Timeline:
    def __init__(self):
        self.t0 = time.monotonic()
        self.events: list[tuple[float, str, str]] = []

    def add(self, kind: str, text: str) -> None:
        self.events.append((time.monotonic() - self.t0, kind, text))
        print(f"  {self.events[-1][0]:6.1f}s  {kind:9} {text}", flush=True)

    def since(self, mark: int, kind: str) -> list[str]:
        return [text for _, k, text in self.events[mark:] if k == kind]


class FakeConvex:
    """Answers the worker's calls the way the real backend would, and keeps them."""

    def __init__(self, timeline: Timeline):
        self.timeline = timeline
        self.mutations: list[tuple[str, dict]] = []

    async def handle(self, request):
        from aiohttp import web

        kind = request.path.rsplit("/", 1)[-1]
        body = await request.json()
        path, args = body["path"], body["args"]
        if kind == "query" and path == "assistant:context":
            value = {"board": [], "notesHtml": "", "notesLocked": False}
        else:
            shown = {k: v for k, v in args.items() if k not in ("roomId", "accessToken", "commandId")}
            self.mutations.append((path, shown))
            self.timeline.add("convex", f"{path.split(':')[1]} {json.dumps(shown, ensure_ascii=False)[:150]}")
            value = {"editId": "x", "count": 1, "ids": {}}
        return web.json_response({"status": "success", "value": value})

    async def start(self, port: int):
        from aiohttp import web

        app = web.Application()
        app.router.add_post("/api/query", self.handle)
        app.router.add_post("/api/mutation", self.handle)
        runner = web.AppRunner(app)
        await runner.setup()
        await web.TCPSite(runner, "127.0.0.1", port).start()
        return runner


class Person:
    """Someone in the room with a microphone that plays what they say, and silence otherwise, as a real one does."""

    def __init__(self, identity: str, name: str, lang: str | None):
        self.identity, self.name, self.lang = identity, name, lang
        self.room = None
        self.queue: asyncio.Queue = asyncio.Queue()
        self.speaking_until = 0.0

    async def join(self, timeline: Timeline):
        from livekit import api, rtc

        attributes = {"role": "Participant", **({"lang": self.lang} if self.lang else {})}
        token = api.AccessToken(KEY, SECRET).with_identity(self.identity).with_name(self.name).with_attributes(attributes) \
            .with_grants(api.VideoGrants(room_join=True, room=ROOM)).to_jwt()
        self.room = rtc.Room()

        def on_attributes(changed, participant):
            if participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_AGENT and "lk.agent.state" in changed and self.identity == "lena":
                timeline.add("state", changed["lk.agent.state"])

        self.room.on("participant_attributes_changed", on_attributes)
        await self.room.connect(URL, token)
        self.source = rtc.AudioSource(SAMPLE_RATE, 1)
        track = rtc.LocalAudioTrack.create_audio_track("mic", self.source)
        await self.room.local_participant.publish_track(track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
        self.pump_task = asyncio.create_task(self.pump())

    async def pump(self):
        import numpy as np
        from livekit import rtc

        chunk = SAMPLE_RATE // 10
        silence = np.zeros(chunk, dtype=np.int16)
        while True:
            try:
                piece = self.queue.get_nowait()
            except asyncio.QueueEmpty:
                piece = silence
            await self.source.capture_frame(rtc.AudioFrame(data=piece.tobytes(), sample_rate=SAMPLE_RATE, num_channels=1, samples_per_channel=len(piece)))

    def say(self, audio) -> float:
        chunk = SAMPLE_RATE // 10
        for i in range(0, len(audio), chunk):
            piece = audio[i:i + chunk]
            self.queue.put_nowait(piece if len(piece) == chunk else __import__("numpy").pad(piece, (0, chunk - len(piece))))
        return len(audio) / SAMPLE_RATE


async def wait_for(check, timeout: float) -> bool:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if check():
            return True
        await asyncio.sleep(0.2)
    return False


async def main() -> int:
    import aiohttp
    from livekit import api, rtc
    sys.path.insert(0, str(HERE.parent))
    from evals.wake_eval import synthesize

    timeline = Timeline()
    convex = FakeConvex(timeline)
    runner = await convex.start(8765)
    cache = Path(os.environ.get("TTS_CACHE", "/tmp/tavio-eval-tts"))
    cache.mkdir(parents=True, exist_ok=True)
    results: list[tuple[str, bool]] = []

    def check(name: str, ok: bool) -> None:
        results.append((name, ok))
        print(f"  -> {'ok  ' if ok else 'FAIL'} {name}", flush=True)

    async with aiohttp.ClientSession() as session:
        voices = {"de": "aura-2-julius-de", "en": "aura-2-thalia-en"}

        async def speech(lang: str, text: str):
            return await synthesize(session, voices[lang], text, cache)

        lena = Person("lena", "Lena", "de")
        sam = Person("sam", "Sam", "en")
        await lena.join(timeline)
        await sam.join(timeline)
        lk = api.LiveKitAPI(URL.replace("ws", "http"), KEY, SECRET)
        await lk.agent_dispatch.create_dispatch(api.CreateAgentDispatchRequest(
            agent_name=AGENT, room=ROOM, metadata=json.dumps({"roomId": "r1", "accessToken": "t1", "convexUrl": "http://127.0.0.1:8765"})))
        print("dispatched, waiting for the assistant ...")
        agent_in = await wait_for(lambda: any(p.kind == rtc.ParticipantKind.PARTICIPANT_KIND_AGENT for p in lena.room.remote_participants.values()), 40)
        check("the assistant joined", agent_in)
        if not agent_in:
            return 1
        await asyncio.sleep(4)

        async def speak(person: Person, lang: str, text: str, label: str, wait_s: float = 30):
            """Says it, waits for the assistant to go quiet again. Returns the index into the timeline from before."""
            mark = len(timeline.events)
            print(f'\n[{label}] {person.name} ({lang}): "{text}"')
            seconds = person.say(await speech(lang, text))
            await asyncio.sleep(seconds + 0.5)
            # Done when nothing has happened for a while: the assistant may be slow, and it may do nothing at all.
            spoken_until = time.monotonic() - timeline.t0
            deadline = time.monotonic() + wait_s + 15
            while time.monotonic() < deadline:
                last = max([spoken_until] + [t for t, kind, _ in timeline.events[mark:] if kind in ("state", "convex")])
                if time.monotonic() - timeline.t0 - last > 6:
                    break
                await asyncio.sleep(0.5)
            return mark

        # 1. A vague command, first, so that there is nothing earlier it could mean: it asks, and the answer needs no name.
        before = len(convex.mutations)
        mark = await speak(lena, "de", "Vivo, schreib das auf.", "vague command")
        asked = [a["text"] for n, a in convex.mutations[before:] if n == "assistant:reply" and a.get("text", "").endswith("?")]
        check("it asked what to write down", bool(asked))
        before = len(convex.mutations)
        mark = await speak(lena, "de", "Das Angebot an Müller schicken.", "the answer, without the name")
        check("the answer was taken as a command without the name", any(n in ("assistant:addToBoard", "assistant:appendToNotes", "assistant:addTasksToBoard") and "müller" in json.dumps(a, ensure_ascii=False).lower() for n, a in convex.mutations[before:]))

        # 2. A plain command, name first.
        mark = await speak(lena, "de", "Vivo, schreib aufs Whiteboard: Release am dritten Dezember.", "plain command")
        states = timeline.since(mark, "state")
        check("it showed it heard its name before it began to write", "heard" in states and states.index("heard") < states.index("thinking"))
        check("it wrote the release onto the board", any(n == "assistant:addToBoard" and "release" in json.dumps(a, ensure_ascii=False).lower() for n, a in convex.mutations))

        # 3. The other person speaks English.
        before = len(convex.mutations)
        mark = await speak(sam, "en", "Hey Vivo, add a sticky note: finish the budget.", "english speaker")
        check("the English speaker was understood", any(n == "assistant:addToBoard" and "budget" in json.dumps(a, ensure_ascii=False).lower() for n, a in convex.mutations[before:]))

        # 4. The name at the end.
        before = len(convex.mutations)
        mark = await speak(lena, "de", "Leg eine Aufgabe für Jonas an: Zahlen schicken, Vivo.", "name last")
        check("the name last still worked", any(n == "assistant:addTasksToBoard" and "jonas" in json.dumps(a, ensure_ascii=False).lower() for n, a in convex.mutations[before:]))

        # 5. Talk about the assistant: nothing may happen.
        before = len(convex.mutations)
        mark = await speak(lena, "de", "Gestern hat Vivo das richtig gut gemacht.", "talk about it", wait_s=20)
        await asyncio.sleep(6)
        check("talk about the assistant changed nothing and was not answered", len(convex.mutations) == before)

        # 6. The name alone, then nothing: the state must come back by itself.
        before = len(convex.mutations)
        mark = await speak(lena, "de", "Vivo.", "name alone", wait_s=25)
        def agent_state():
            agents = [p for p in lena.room.remote_participants.values() if p.kind == rtc.ParticipantKind.PARTICIPANT_KIND_AGENT]
            return agents[0].attributes.get("lk.agent.state") if agents else None

        await wait_for(lambda: agent_state() == "listening", 25)
        await asyncio.sleep(1)
        check("a name with no command ends back at listening on its own, and nothing was done", agent_state() == "listening" and len(convex.mutations) == before)

        for person in (lena, sam):
            person.pump_task.cancel()
            await person.room.disconnect()
        await lk.aclose()
    await runner.cleanup()

    print("\nsummary:")
    for name, ok in results:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
    return 0 if all(ok for _, ok in results) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
