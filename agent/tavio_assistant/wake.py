"""Hearing "Vivo, ..." in what people say, and putting the command together.

Speech-to-text cuts speech at short pauses, so one command can arrive in pieces, and the wake word
can come alone with the command after a breath. Everything here is pure: time is passed in.

What this does not try to decide is whether a sentence with "Vivo" in it was meant for the assistant.
The name at the start or the end of a sentence is taken as being said to it. In the middle of a sentence
it may just be talk about it, so that also goes on, and the model, which gets the whole sentence, has a
tool for doing nothing (brain.py). Speech-to-text already spells the name right (a key term, speech.py),
so this does not guess at other spellings: that only wakes it for Vito, Viva and "wie wo".
"""

from __future__ import annotations

import difflib
import re
import unicodedata
from dataclasses import dataclass

# Whole words only, so "Video", "Vivaldi" or "Vivos" do not wake it; "Vivo's" and "Vivo-Handy" are talk about it.
# "Vi vo" and "Vi-vo" are how the name comes out when it is said slowly; the first letter is how it is misheard (Wiwo, Bivo).
WAKE = re.compile(r"(?<![\w'’])[vwb]i[\s-]?[vw]o(?![\w'’]|-\w)", re.IGNORECASE)

# Said before the name without making it less of an address: "Okay Vivo", "Äh, Vivo", "Also Vivo".
# Accents are stripped before looking (äh becomes ah).
FILLERS = frozenset({
    "hey", "hi", "hallo", "hello", "okay", "ok", "ja", "also", "und", "dann", "so", "na", "ach", "gut", "nun", "ey", "moin",
    "bitte", "danke", "ah", "ahm", "eh", "ehm", "em", "hm", "mh", "uh", "uhm", "um", "oh", "well", "and", "then", "yes", "please", "alright",
    "sorry", "entschuldigung", "halt", "mal", "noch", "jetzt", "nochmal", "kurz",
})

_SENTENCE_END = re.compile(r"(?<!\d)[.!?]+(?:\s+|$)")
_TRIM = " \t\n,.:;!?-"


def _plain(text: str) -> str:
    """Letters without accents, one for one, so positions still match the original text."""
    return "".join(unicodedata.normalize("NFD", c)[0] for c in text)


def _last_sentence(text: str) -> str:
    return _SENTENCE_END.split(text)[-1]


def _first_sentence(text: str) -> str:
    return _SENTENCE_END.split(text, maxsplit=1)[0]


def _without_fillers(text: str) -> str:
    """The text without the fillers at its start."""
    plain = _plain(text)
    pos = 0
    for match in re.finditer(r"[^\W\d_]+|[\s,.:;!?-]+", plain):
        if match.start() != pos:
            break
        word = match.group().lower()
        if word.strip(_TRIM) and word not in FILLERS:
            break
        pos = match.end()
    return text[pos:].strip(_TRIM)


@dataclass
class Wake:
    kind: str       # "start", "end" or "middle": where the name stands in its sentence
    command: str    # the words that make up the command, without the name; "" when the name came alone

    @property
    def strong(self) -> bool:
        """Said to the assistant, as far as the words can tell."""
        return self.kind != "middle"


def find_wake(text: str) -> Wake | None:
    match = WAKE.search(_plain(text))
    if not match:
        return None
    before, after = text[:match.start()], text[match.end():]
    lead = _last_sentence(before)
    if not _without_fillers(lead):
        return Wake("start", after.lstrip(_TRIM).rstrip())
    rest = after.lstrip(" \t,;:-")
    if not rest or rest[0] in ".!?":
        return Wake("end", _without_fillers(lead))
    return Wake("middle", f"{_without_fillers(lead)} {_first_sentence(after).lstrip(_TRIM)}".strip(_TRIM))


def find_command(text: str) -> str | None:
    """The words of the command, "" when the name came alone, None when it was not said."""
    wake = find_wake(text)
    return wake.command if wake else None


def hears_wake(text: str, final: bool = True) -> bool:
    """The name is there and looks like being said to the assistant.

    For a half-finished transcript only the name first counts: a name at the end of what has been said so far may be
    the middle of the sentence ("Gestern hat Vivo ..."), which only the rest of it shows.
    """
    wake = find_wake(text)
    return bool(wake and (wake.kind == "start" or (final and wake.strong)))


def _key(command: str) -> str:
    return re.sub(r"[^\w]+", " ", _plain(command).lower()).strip()


@dataclass
class Command:
    speaker: str
    heard: str
    command: str
    speaker_id: str = ""
    started_wall: float = 0.0   # when its first words arrived, on the clock the transcript uses
    ended_wall: float = 0.0     # and its last
    language: str = "de"
    kind: str = "start"         # how the name stood (start, end, middle); "follow": a reply without the name; "continue": the rest of the last command
    at: float = 0.0             # when it was ready, on the collector's clock


@dataclass
class _Open:
    name: str
    speaker_id: str
    kind: str
    heard: list[str]
    parts: list[str]
    last: float
    started: float
    wall: float
    language: str
    wall_end: float = 0.0
    end_s: float | None = None   # where the last piece of speech ended in the audio, for the real length of a pause
    joinable: bool = True

    def complete(self) -> bool:
        text = self.heard[-1].rstrip()
        return text.endswith((".", "!", "?")) and len(" ".join(self.parts).split()) >= 2


class CommandCollector:
    def __init__(
        self,
        quiet_open_s: float = 1.5,
        quiet_done_s: float = 1.2,
        follow_s: float = 8.0,
        join_open_s: float = 3.0,
        join_done_s: float = 1.2,
        dedupe_s: float = 5.0,
        continue_s: float = 30.0,
    ):
        # How long it stays quiet before the command goes on, when the last words did not end a sentence and when they did.
        self.quiet_open_s = quiet_open_s
        self.quiet_done_s = quiet_done_s
        # How long after the name alone the command may still come.
        self.follow_s = follow_s
        # The longest pause after which the next words still belong to the command, by the same two cases.
        self.join_open_s = join_open_s
        self.join_done_s = join_done_s
        self.dedupe_s = dedupe_s
        # How long after a command went on, words that follow it straight on in the audio still count as part of it. Long, because the
        # recogniser's second half can come while the model is still working on the first.
        self.continue_s = continue_s
        self._open: dict[str, _Open] = {}
        self._followup: dict[str, float] = {}
        # Where each person's last command ended (in the audio) and whether it was a finished sentence, and when it went on.
        self._sent: dict[str, tuple[float | None, bool, float]] = {}
        self._recent: list[tuple[str, float, str]] = []

    def expect_followup(self, speaker_id: str, now: float, window_s: float = 15.0) -> None:
        """After the assistant asked something, the next words of that person count without the name."""
        self._followup[speaker_id] = now + window_s

    def pending(self) -> bool:
        return bool(self._open)

    def awaiting_answer(self, now: float) -> bool:
        """The assistant asked someone something and their answer may still come."""
        return any(deadline > now for deadline in self._followup.values())

    def _joins(self, current: _Open, now: float, span: tuple[float, float] | None) -> bool:
        pause = now - current.last
        if span and current.end_s is not None and span[0] >= current.end_s:
            pause = span[0] - current.end_s
        if not current.parts:
            return pause <= self.follow_s
        return pause <= (self.join_done_s if current.complete() else self.join_open_s)

    def feed(self, speaker_id: str, name: str, text: str, now: float, *, span: tuple[float, float] | None = None, wall: float = 0.0, language: str = "de") -> None:
        text = text.strip()
        if not text:
            return
        end_s = span[1] if span else None
        wake = find_wake(text)
        if wake:
            self._followup.pop(speaker_id, None)
            self._open[speaker_id] = _Open(
                name=name, speaker_id=speaker_id, kind=wake.kind, heard=[text], parts=[wake.command] if wake.command else [],
                last=now, started=now, wall=wall, wall_end=wall, language=language, end_s=end_s,
                # A sentence that ends in the name is complete; what follows is not part of it.
                joinable=not (wake.kind == "end" and wake.command),
            )
            return
        current = self._open.get(speaker_id)
        if current:
            if current.joinable and self._joins(current, now, span):
                current.heard.append(text)
                current.parts.append(text)
                current.last = now
                current.end_s = end_s
                current.wall_end = wall
            return
        sent = self._sent.get(speaker_id)
        if sent and span and sent[0] is not None and 0 <= span[0] - sent[0] <= (self.join_done_s if sent[1] else self.join_open_s) and now - sent[2] <= self.continue_s:
            # The next words followed straight on from the command that has just gone on (they only arrived after it did).
            del self._sent[speaker_id]
            self._open[speaker_id] = _Open(
                name=name, speaker_id=speaker_id, kind="continue", heard=[text], parts=[text],
                last=now, started=now, wall=wall, wall_end=wall, language=language, end_s=end_s,
            )
            return
        deadline = self._followup.get(speaker_id)
        if deadline is not None and now <= deadline:
            del self._followup[speaker_id]
            self._open[speaker_id] = _Open(
                name=name, speaker_id=speaker_id, kind="follow", heard=[text], parts=[text],
                last=now, started=now, wall=wall, wall_end=wall, language=language, end_s=end_s,
            )

    def activity(self, speaker_id: str, now: float, span: tuple[float, float] | None = None) -> None:
        """Speech is still going on (a half-finished transcript arrived): a command that this speech would belong to is not over yet."""
        current = self._open.get(speaker_id)
        if current and current.parts and current.joinable and self._joins(current, now, span):
            current.last = now

    def _is_echo(self, speaker_id: str, key: str, now: float) -> bool:
        """The same command heard through someone else's microphone a moment ago."""
        self._recent = [r for r in self._recent if now - r[1] < self.dedupe_s]
        return any(who != speaker_id and difflib.SequenceMatcher(None, key, other).ratio() >= 0.85 for other, _, who in self._recent)

    def due(self, now: float) -> list[Command]:
        ready: list[Command] = []
        for speaker_id, current in list(self._open.items()):
            if not current.parts:
                if now - current.started > self.follow_s:
                    del self._open[speaker_id]
                continue
            if now - current.last < (self.quiet_done_s if current.complete() else self.quiet_open_s):
                continue
            del self._open[speaker_id]
            command = " ".join(current.parts).strip()
            key = _key(command)
            if self._is_echo(speaker_id, key, now):
                continue
            self._recent.append((key, now, speaker_id))
            self._sent[speaker_id] = (current.end_s, current.complete(), now)
            ready.append(Command(
                speaker=current.name, heard=" ".join(current.heard), command=command, speaker_id=speaker_id,
                started_wall=current.wall, ended_wall=current.wall_end, language=current.language, kind=current.kind, at=now,
            ))
        return ready
