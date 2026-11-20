"""The meeting assistant as a LiveKit agent.

It joins only when the app dispatches it (explicit dispatch by agent name), listens to every person
on their own speech-to-text stream, and acts on "Vivo, ...". It leaves when the last person leaves,
when someone sends it away, when nobody has given it a command for a while, and after a long meeting.

    python -m tavio_assistant.main dev     # against LIVEKIT_URL, reloads on change
    python -m tavio_assistant.main start   # production
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid

from livekit import rtc
from livekit.agents import AgentServer, AutoSubscribe, JobContext, cli, stt
from openai import AsyncOpenAI

from .brain import Brain, Transcript, say
from .convex_api import ConvexApi
from .speech import language_for, make_stt
from .wake import Command, CommandCollector, hears_wake

log = logging.getLogger("tavio-assistant")

AGENT_NAME = os.environ.get("ASSISTANT_AGENT_NAME", "tavio-assistant")
STATE = "lk.agent.state"
# What a person's client says about itself: the language the app is in, which is the language they will speak to the assistant.
LANGUAGE_ATTRIBUTE = "lang"
# Off by default: transcripts are never logged. For debugging on one's own machine, to see what the assistant was given.
LOG_COMMANDS = os.environ.get("ASSISTANT_LOG_COMMANDS") == "1"
# A command that waited this long for the one before it is no longer what anyone wants; one that takes this long to carry out failed.
STALE_S = 45.0
COMMAND_TIMEOUT_S = 75.0
# Every voice in the room goes to speech-to-text while the assistant is there, and anyone in the room can call it.
# So it leaves when nobody has given it a command for a while, and after a long meeting in any case; one click brings it back.
IDLE_LEAVE_S = float(os.environ.get("ASSISTANT_IDLE_MINUTES", "20")) * 60
MAX_STAY_S = float(os.environ.get("ASSISTANT_MAX_MINUTES", "120")) * 60


def leave_reason(now: float, started: float, last_used: float, idle_s: float = IDLE_LEAVE_S, max_s: float = MAX_STAY_S) -> str | None:
    if now - started > max_s:
        return f"it was here for {max_s / 60:.0f} minutes"
    if now - last_used > idle_s:
        return f"nobody gave it a command for {idle_s / 60:.0f} minutes"
    return None


def _require(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"{name} is not set")
    return value


def _is_person(participant: rtc.RemoteParticipant) -> bool:
    return participant.kind != rtc.ParticipantKind.PARTICIPANT_KIND_AGENT


# LiveKit stops sending jobs once the whole machine's CPU passes this. The worker needs little CPU itself,
# but shares the VPS with LiveKit and Egress, whose recordings would otherwise keep the assistant away.
server = AgentServer(load_threshold=float(os.environ.get("ASSISTANT_LOAD_THRESHOLD", "0.95")))


@server.rtc_session(agent_name=AGENT_NAME)
async def entry(ctx: JobContext) -> None:
    meta = json.loads(ctx.job.metadata or "{}")
    convex_url = meta.get("convexUrl") or _require("CONVEX_URL")
    api = ConvexApi(convex_url, meta["roomId"], meta["accessToken"])
    # Any OpenAI-compatible endpoint with tool calls: our gateway by default, OpenRouter works the same way.
    # The SDK retries 429s with backoff; the gateway shares one subscription and answers with them under load.
    # Without a timeout the SDK waits ten minutes, and commands are carried out one at a time, so one stuck call would stop all of them.
    llm = AsyncOpenAI(base_url=_require("LLM_BASE_URL"), api_key=_require("LLM_API_KEY"), max_retries=2, timeout=30)
    brain = Brain(llm, _require("LLM_MODEL"), api)
    speech: dict[str, object] = {}

    def stt_for(language: str):
        # One recogniser per language, shared by everyone who speaks it; each person still gets a stream of their own.
        if language not in speech:
            speech[language] = make_stt(language)
        return speech[language]

    transcript = Transcript()
    collector = CommandCollector()
    commands: asyncio.Queue = asyncio.Queue()

    class Listening:
        """One microphone being listened to: which track, in which language, and the task doing it."""

        def __init__(self, track: rtc.Track, participant: rtc.RemoteParticipant, language: str):
            self.track, self.participant, self.language = track, participant, language
            self.task = asyncio.create_task(listen(self))

    listening: dict[str, Listening] = {}

    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    me = ctx.room.local_participant

    class State:
        """What the assistant shows everyone: listening, heard its name, or thinking. Only changes are sent."""

        def __init__(self):
            self.value = ""
            self.since = 0.0

        async def set(self, value: str) -> None:
            if value != self.value:
                self.value, self.since = value, time.monotonic()
                await me.set_attributes({STATE: value})

    state = State()
    await state.set("listening")

    async def listen(mic: Listening) -> None:
        """Listens to one microphone; when speech-to-text drops, tries again instead of going deaf to that person."""
        backoff = 1.0
        while True:
            began = time.monotonic()
            try:
                await listen_once(mic)
                return
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("speech-to-text for %s stopped, trying again in %.0f s", mic.participant.identity, backoff)
            if time.monotonic() - began > 60:
                backoff = 1.0
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30.0)

    async def listen_once(mic: Listening) -> None:
        nonlocal last_speech
        participant = mic.participant
        stream = stt_for(mic.language).stream()
        audio = rtc.AudioStream.from_track(track=mic.track, sample_rate=16000, num_channels=1)

        async def push() -> None:
            async for event in audio:
                stream.push_frame(event.frame)
            stream.end_input()

        pusher = asyncio.create_task(push())
        try:
            async for event in stream:
                if not event.alternatives:
                    continue
                alt = event.alternatives[0]
                text = alt.text.strip()
                if not text:
                    continue
                last_speech = time.monotonic()
                if LOG_COMMANDS:
                    log.info("stt %s %s %.2f-%.2f %r", participant.identity, event.type.name[:5], alt.start_time, alt.end_time, text)
                if event.type == stt.SpeechEventType.INTERIM_TRANSCRIPT:
                    # Still being said: a command that this belongs to is not over yet, and if it starts with the name, show that it was heard.
                    collector.activity(participant.identity, time.monotonic(), span=(alt.start_time, alt.end_time))
                    if state.value == "listening" and hears_wake(text, final=False):
                        await state.set("heard")
                    continue
                if event.type != stt.SpeechEventType.FINAL_TRANSCRIPT:
                    continue
                name = participant.name or participant.identity
                wall = time.time()
                transcript.add(at=wall, speaker=name, text=text)
                collector.feed(
                    participant.identity, name, text, now=time.monotonic(),
                    span=(alt.start_time, alt.end_time), wall=wall, language=mic.language,
                )
            if not pusher.done():
                # The recogniser ended while the microphone is still on.
                raise RuntimeError("the speech-to-text stream ended")
        finally:
            pusher.cancel()
            await audio.aclose()
            await stream.aclose()

    def language_of(participant: rtc.RemoteParticipant) -> str:
        return language_for(participant.attributes.get(LANGUAGE_ATTRIBUTE))

    def start_listening(track: rtc.Track, publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant) -> None:
        if track.kind != rtc.TrackKind.KIND_AUDIO or not _is_person(participant):
            return
        # A screen share's sound is not someone talking to the assistant.
        if publication.source != rtc.TrackSource.SOURCE_MICROPHONE:
            return
        previous = listening.pop(publication.sid, None)
        if previous:
            previous.task.cancel()
        listening[publication.sid] = Listening(track, participant, language_of(participant))

    def stop_listening(track: rtc.Track, publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant) -> None:
        mic = listening.pop(publication.sid, None)
        if mic:
            mic.task.cancel()

    def attributes_changed(changed: dict, participant: rtc.Participant) -> None:
        # The client tells its language a moment after it connects, and a person can switch it: listen in the new one.
        if LANGUAGE_ATTRIBUTE not in changed:
            return
        for sid, mic in list(listening.items()):
            if mic.participant.identity == participant.identity and mic.language != language_of(mic.participant):
                mic.task.cancel()
                listening[sid] = Listening(mic.track, mic.participant, language_of(mic.participant))

    def on_left(participant: rtc.RemoteParticipant) -> None:
        # Nobody left to listen to: no point paying for speech-to-text in an empty room.
        people = [p.identity for p in ctx.room.remote_participants.values() if _is_person(p)]
        log.info("%s left, %d people remain", participant.identity, len(people))
        if not people:
            ctx.shutdown("the last person left")

    def yield_to_another_assistant(*_args) -> None:
        # Two people summoning at the same moment can bring two; the one with the later name goes,
        # so exactly one stays and no command is carried out twice.
        mine = me.identity
        if any(not _is_person(p) and p.identity < mine for p in ctx.room.remote_participants.values()):
            ctx.shutdown("another assistant is already here")

    yield_to_another_assistant()
    ctx.room.on("participant_connected", yield_to_another_assistant)
    ctx.room.on("track_subscribed", start_listening)
    ctx.room.on("track_unsubscribed", stop_listening)
    ctx.room.on("participant_disconnected", on_left)
    ctx.room.on("participant_attributes_changed", attributes_changed)
    for participant in ctx.room.remote_participants.values():
        for publication in participant.track_publications.values():
            if publication.track:
                start_listening(publication.track, publication, participant)

    busy = False
    last_speech = 0.0   # when any person's words (even half-finished ones) last came in
    started = last_used = time.monotonic()

    async def collect() -> None:
        nonlocal last_used
        while True:
            await asyncio.sleep(0.1)
            now = time.monotonic()
            for command in collector.due(now):
                commands.put_nowait(command)
                last_used = now
            # Never in the middle of something: a command being said, carried out, or a question waiting for its answer.
            engaged = busy or not commands.empty() or collector.pending() or collector.awaiting_answer(now) or state.value == "heard"
            reason = None if engaged else leave_reason(now, started, last_used)
            if reason:
                log.info("leaving: %s", reason)
                ctx.shutdown(reason)
                return
            # The name was heard in a half-finished sentence but no command came of it (it was said about the assistant, or heard wrongly).
            if state.value == "heard" and not busy and not collector.pending() and commands.empty() and now - max(state.since, last_speech) > 4.0:
                await state.set("listening")

    async def tell(command: Command, key: str) -> None:
        """A message from the assistant itself, in the language of the person who asked."""
        try:
            await api.mutation("assistant:reply", {"heard": command.heard, "commandId": uuid.uuid4().hex, "text": say(key, command.language)})
        except Exception:
            log.exception("could not tell the room")

    async def act() -> None:
        # One command at a time, in the order they were said.
        nonlocal busy, last_used
        while True:
            command = await commands.get()
            if time.monotonic() - command.at > STALE_S:
                log.warning("dropping a command that waited %.0f s", time.monotonic() - command.at)
                await tell(command, "late")
                continue
            busy = True
            await state.set("thinking")
            try:
                outcome = await asyncio.wait_for(brain.handle(command, transcript), timeout=COMMAND_TIMEOUT_S)
                if LOG_COMMANDS:
                    log.info("command (%s) %r -> asked=%s silent=%s", command.kind, command.heard, outcome.asked, outcome.silent)
                if outcome.asked:
                    # The assistant asked (or did not understand): the answer needs no name.
                    collector.expect_followup(command.speaker_id, time.monotonic())
            except asyncio.TimeoutError:
                log.error("a command took longer than %.0f s", COMMAND_TIMEOUT_S)
                await tell(command, "late")
            except Exception:
                log.exception("a command failed")
                await tell(command, "failed")
            finally:
                busy = False
                last_used = time.monotonic()
                await state.set("listening")

    background = [asyncio.create_task(collect()), asyncio.create_task(act())]

    async def cleanup() -> None:
        for task in [*background, *(mic.task for mic in listening.values())]:
            task.cancel()
        await api.aclose()
        await llm.close()

    ctx.add_shutdown_callback(cleanup)


if __name__ == "__main__":
    cli.run_app(server)
