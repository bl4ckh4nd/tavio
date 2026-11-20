"""From a spoken command to changes in the room: one model call with tools, a few rounds at most.

The model only chooses tools and fills plain-text fields. Where things go on the board and how the
notes are built is decided by the backend.
"""

from __future__ import annotations

import json
import logging
import re
import time
import uuid
from collections import deque
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo
from html.parser import HTMLParser
from typing import Any, Callable

from .convex_api import ConvexError
from .wake import Command, find_wake

log = logging.getLogger("tavio-assistant")

SYSTEM = """Du bist Vivo, der Assistent in einem Videocall. Menschen sprechen dich an, und du erledigst den Auftrag mit den Werkzeugen.
- Antworte in der Sprache, in der du angesprochen wurdest.
- Schreib kurz und so, wie es auf einen Zettel oder in ein Protokoll gehört, ohne Einleitung.
- Unten steht, was gerade auf dem Whiteboard und in den Notizen ist. Elemente nennst du mit ihrem Kürzel (e1, e2 …), deine Notizblöcke mit n1, n2 …
- Positionen rechnet der Server aus: sag nur, neben welchem Element (near, side) und wie angeordnet (layout).
- Ein Diagramm legst du in einem Schritt an: alle Elemente mit key (a, b, c …) und die Pfeile als links zwischen keys oder Kürzeln.
- Pfeile haben keine Beschriftung; leg dafür keine eigenen Textfelder an.
- Was du anlegst oder änderst, holen sich die Leute von selbst ins Bild. show_on_board nur, wenn jemand die Ansicht ändern will (zeigen, zoomen, alles sehen).
- Die Kürzel sind nur für dich: in Antworten nennst du Elemente beim Text, nie e1 oder n1.
- Für eine Zusammenfassung lies zuerst das Transkript (read_transcript), dann schreib sie in die Notizen.
- In den Notizen hängst du nur an oder entfernst deine eigenen Blöcke; den Text der Menschen änderst du nie.
- Erfinde nichts, was nicht gesagt wurde.
- Du bekommst den ganzen Satz, wie die Spracherkennung ihn geschrieben hat, mit dem Namen „Vivo“. Der Auftrag steht nach oder vor dem Namen. Die Erkennung macht Fehler (falsche Wörter, fehlende Satzzeichen): nimm die naheliegende Bedeutung.
- War es keine Anweisung an dich, ruf nur ignore auf: jemand spricht über Vivo („gestern hat Vivo das gut gemacht“), oder ein anderes Wort wurde als Vivo erkannt („Vivo kommt später“ meint eine Person). Steht der Name am Anfang oder Ende des Satzes und passt das Gesagte zu etwas, das du tun kannst, ist es ein Auftrag, auch wenn die Erkennung die Form verdreht hat („Vivo schreibt es auf“ heißt „schreib es auf“, „Vivo hängt Ideen an“ heißt „häng Ideen an“). Mitten im Satz ist es öfter nur Gerede. Nichts tun ist besser als raten.
- Führe nur aus, was angewiesen wurde. Was danach kommt und nicht dazu gehört (ein Satz an jemand anderen, der nächste Punkt), lässt du weg.
- „das“, „eben“, „daraus“ meinen, was kurz davor gesagt wurde; es steht unter „Zuletzt gesagt“.
- Unter „Letzte Aufträge“ steht, was du in diesem Call schon getan oder gefragt hast. Eine kurze Antwort auf deine Rückfrage ist der Rest des Auftrags.
- Du hörst erst, seit du im Call bist, und Zeilen mit „Vivo“ sind Aufträge an dich, kein Inhalt für eine Zusammenfassung.
- Fehlt etwas, such es zuerst unter „Zuletzt gesagt“, in den Notizen und auf dem Board (für Zusammenfassungen im Transkript). Nur wenn es dort nicht steht und du ohne es nichts tun kannst, stell eine kurze Rückfrage (reply); sonst handle.
- Passt kein Werkzeug, antworte in einem Satz mit reply."""

BERLIN = ZoneInfo("Europe/Berlin")
WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]

COLORS = ["yellow", "green", "blue", "pink", "violet", "red", "orange", "black"]
KINDS = ["sticky", "rectangle", "circle", "diamond", "text"]
LAYOUTS = ["row", "column", "grid"]
SIDES = ["right", "left", "below", "above"]
ZOOM = {"fit": "fit", "zoom_in": "in", "zoom_out": "out"}
REF = {"type": "string", "description": "Kürzel wie e3."}
REFS = {"type": "array", "items": REF}
LINKS = {"type": "array", "maxItems": 20, "description": "Pfeile von → zu, als key eines neuen Elements oder Kürzel.", "items": {
    "type": "object", "properties": {"from": {"type": "string"}, "to": {"type": "string"}}, "required": ["from", "to"],
}}


def _tool(name: str, description: str, properties: dict, required: list[str] | None = None) -> dict:
    return {"type": "function", "function": {"name": name, "description": description, "parameters": {
        "type": "object", "properties": properties, **({"required": required} if required else {}),
    }}}


TOOLS: list[dict[str, Any]] = [
    _tool("add_to_board", "Legt Zettel, Formen oder Text aufs Whiteboard, auf Wunsch mit Pfeilen dazwischen. Ein Gedanke pro Element.", {
        "items": {"type": "array", "maxItems": 12, "items": {"type": "object", "properties": {
            "key": {"type": "string", "description": "Kurzer Name für links, z. B. a, b."},
            "kind": {"type": "string", "enum": KINDS},
            "text": {"type": "string", "maxLength": 200},
            "color": {"type": "string", "enum": COLORS, "description": "Füllung bei Zetteln, sonst Linien- oder Schriftfarbe."},
        }, "required": ["kind"]}},
        "links": LINKS,
        "layout": {"type": "string", "enum": LAYOUTS},
        "near": {**REF, "description": "Neben dieses Element legen (Kürzel)."},
        "side": {"type": "string", "enum": SIDES},
    }, ["items"]),
    _tool("add_overview", "Legt eine Übersicht aufs Whiteboard (640×480), z. B. Stand, Zahlen, Tabelle, Zeitplan. Gebaut als json-render-Spec: "
          "{root: Schlüssel, elements: {Schlüssel: {type, props, children: [Schlüssel …]}}}. Teile und ihre props: "
          "Stack {direction?: column|row, gap?: sm|md|lg}, Grid {columns: 1–4}, Card {title?} (diese drei haben children); "
          "Heading {text, level?: 1–3}, Text {text, muted?}, List {items: [text], ordered?}, Checklist {items: [{text, done}]}, "
          "Table {columns: [text], rows: [[text]]}, Stat {label, value, note?}, Progress {label, value: 0–100}, Badge {text}, "
          "Timeline {items: [{when, title, text?}]}, Divider {}. Alle anderen haben children: [].", {
        "title": {"type": "string", "maxLength": 120},
        "spec": {"type": "object", "properties": {"root": {"type": "string"}, "elements": {"type": "object"}}, "required": ["root", "elements"]},
        "near": {**REF, "description": "Neben dieses Element legen (Kürzel)."},
        "side": {"type": "string", "enum": SIDES},
    }, ["title", "spec"]),
    _tool("connect", "Verbindet vorhandene Elemente mit Pfeilen.", {"links": LINKS}, ["links"]),
    _tool("change_on_board", "Ändert Text oder Farbe vorhandener Elemente.", {"changes": {"type": "array", "items": {"type": "object", "properties": {
        "ref": REF, "text": {"type": "string", "maxLength": 200}, "color": {"type": "string", "enum": COLORS},
    }, "required": ["ref"]}}}, ["changes"]),
    _tool("arrange_on_board", "Verschiebt Elemente als Block: ordnet sie an und/oder legt sie neben ein anderes Element. Pfeile wandern mit.", {
        "refs": REFS, "layout": {"type": "string", "enum": LAYOUTS}, "near": REF, "side": {"type": "string", "enum": SIDES},
    }, ["refs"]),
    _tool("delete_from_board", "Löscht Elemente vom Whiteboard.", {"refs": REFS}, ["refs"]),
    _tool("show_on_board", "Bewegt die Ansicht aller: fit zeigt die genannten Elemente oder ohne refs alles; zoom_in und zoom_out zoomen dorthin oder in der Mitte.", {
        "refs": REFS, "mode": {"type": "string", "enum": list(ZOOM)},
    }, ["mode"]),
    _tool("append_to_notes", "Hängt einen Abschnitt an die Besprechungsnotizen an.", {
        "heading": {"type": "string"},
        "paragraphs": {"type": "array", "items": {"type": "string"}},
        "bullets": {"type": "array", "items": {"type": "string"}},
    }),
    _tool("add_tasks", "Legt Aufgabenkarten aufs Whiteboard, mit wer und bis wann, wenn das gesagt wurde. Sie stehen am Ende im Rückblick des Calls.", {"tasks": {"type": "array", "maxItems": 12, "items": {
        "type": "object",
        "properties": {"text": {"type": "string", "maxLength": 200}, "owner": {"type": "string", "maxLength": 60},
                       "due": {"type": "string", "description": "Datum als JJJJ-MM-TT, aus dem heutigen Datum ausgerechnet."}},
        "required": ["text"],
    }}}, ["tasks"]),
    _tool("add_branches", "Hängt gesagte Ideen als Äste an eine Mindmap: unter einen Knoten (under) oder um ein neues Thema (topic). Sie ordnen sich selbst an.", {
        "under": REF, "topic": {"type": "string", "maxLength": 200},
        "branches": {"type": "array", "maxItems": 12, "items": {"type": "string", "maxLength": 200}},
    }, ["branches"]),
    _tool("remove_from_notes", "Entfernt deine eigenen Notizblöcke (n1 …).", {"refs": REFS}, ["refs"]),
    _tool("read_transcript", "Gibt zurück, was in den letzten Minuten gesagt wurde (höchstens 60).", {
        "minutes": {"type": "integer", "minimum": 1, "maximum": 60},
    }, ["minutes"]),
    _tool("undo_last", "Nimmt deinen letzten Auftrag zurück, am Whiteboard oder in den Notizen.", {}),
    _tool("ignore", "Nichts tun: Der Satz war nicht an dich gerichtet (es ging nur um dich, oder ein anderes Wort klang wie Vivo).", {}),
    _tool("reply", "Eine kurze Antwort an alle, wenn nichts zu ändern ist.", {"text": {"type": "string", "maxLength": 300}}, ["text"]),
]

# What the assistant says on its own, in the language of the person who asked.
MESSAGES = {
    "not_understood": {
        "de": "Das habe ich nicht verstanden. Sagen Sie bitte noch einmal, was ich tun soll.",
        "en": "I did not understand that. Please say again what I should do.",
        "es": "No lo he entendido. Dime otra vez, por favor, qué debo hacer.",
        "fr": "Je n'ai pas compris. Dites-moi encore une fois ce que je dois faire.",
    },
    "failed": {
        "de": "Das hat gerade nicht geklappt. Sagen Sie es bitte noch einmal.",
        "en": "That did not work just now. Please say it again.",
        "es": "Eso no ha funcionado. Dímelo otra vez, por favor.",
        "fr": "Cela n'a pas fonctionné. Dites-le encore une fois, s'il vous plaît.",
    },
    "late": {
        "de": "Das hat zu lange gedauert. Sagen Sie es bitte noch einmal.",
        "en": "That took too long. Please say it again.",
        "es": "Ha tardado demasiado. Dímelo otra vez, por favor.",
        "fr": "Cela a pris trop de temps. Dites-le encore une fois, s'il vous plaît.",
    },
}


def say(key: str, language: str = "de") -> str:
    return MESSAGES[key].get(language) or MESSAGES[key]["de"]


NOT_UNDERSTOOD = MESSAGES["not_understood"]["de"]
POSITION = {
    "start": "Der Name stand am Anfang des Satzes.",
    "end": "Der Name stand am Ende des Satzes.",
    "middle": "Der Name stand mitten im Satz.",
    "follow": "Das ist die Antwort auf deine Rückfrage, ohne den Namen.",
    "continue": "Das hat die Person direkt nach ihrem letzten Auftrag weitergesprochen, ohne den Namen. Es gehört wahrscheinlich dazu: lies es zusammen mit dem letzten Auftrag.",
}
LANGUAGE_NAMES = {"de": "Deutsch", "en": "Englisch", "es": "Spanisch", "fr": "Französisch"}


@dataclass
class Outcome:
    """What a command led to. `asked`: the assistant needs an answer, so the next words of that person are for it, name or not."""
    asked: bool = False
    silent: bool = False


class Transcript:
    """What was said in this call since the assistant came, in memory only, for summaries. Never logged, never stored."""

    def __init__(self, keep_s: float = 3600, started: float | None = None):
        self.keep_s = keep_s
        self.started = time.time() if started is None else started
        self._lines: deque[tuple[float, str]] = deque()

    def add(self, at: float, speaker: str, text: str) -> None:
        self._lines.append((at, f"{speaker}: {text}"))
        while self._lines and self._lines[0][0] < at - self.keep_s:
            self._lines.popleft()

    def since(self, at: float) -> list[str]:
        return [line for when, line in self._lines if when >= at]

    def between(self, start: float, end: float, skip: Callable[[float], bool] | None = None) -> list[str]:
        return [line for when, line in self._lines if start <= when < end and not (skip and skip(when))]


@dataclass
class Turn:
    at: float
    speaker: str
    command: str
    outcome: str
    span: tuple[float, float] | None = None   # when it was spoken, on the transcript's clock


class History:
    """The last few commands of this call and what came of them, so that "and one more" and the answer to a question make sense."""

    def __init__(self, keep_s: float = 300, limit: int = 5):
        self.keep_s = keep_s
        self.limit = limit
        self._turns: deque[Turn] = deque(maxlen=20)

    def add(self, at: float, speaker: str, command: str, outcome: str, span: tuple[float, float] | None = None) -> None:
        self._turns.append(Turn(at, speaker, command, outcome, span))

    def spoken(self, at: float) -> bool:
        """Whether this moment of the transcript was a command to the assistant (all of it, not only the line with the name)."""
        return any(t.span and t.span[0] - 0.05 <= at <= t.span[1] + 0.05 for t in self._turns)

    def recent(self, now: float) -> list[Turn]:
        return [t for t in self._turns if now - t.at <= self.keep_s][-self.limit:]


def _clip(text: str, n: int = 100) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= n else text[:n] + "…"


def _json(raw: str) -> dict:
    try:
        return json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}


def _reply_text(args: dict, command: Command) -> str:
    return str(args.get("text", "")).strip() or say("not_understood", command.language)


def _did(name: str, args: dict) -> str:
    """One line about what a tool did, for the history. No handles (e1…): they change with every command."""
    if name == "add_to_board":
        return "legte aufs Board: " + _clip(", ".join(str(i.get("text") or i.get("kind")) for i in args.get("items", [])))
    if name == "add_overview":
        return f"legte die Übersicht „{_clip(args.get('title', ''), 60)}“ aufs Board"
    if name == "add_tasks":
        return "legte Aufgaben an: " + _clip(", ".join(f"{t.get('text')}" + (f" ({t['owner']})" if t.get("owner") else "") for t in args.get("tasks", [])))
    if name == "add_branches":
        return "hängte an die Mindmap: " + _clip(", ".join(args.get("branches", [])))
    if name == "append_to_notes":
        return "schrieb in die Notizen: " + _clip(args.get("heading") or "; ".join([*args.get("paragraphs", []), *args.get("bullets", [])]), 80)
    if name == "delete_from_board":
        return f"löschte {len(args.get('refs', []))} Elemente"
    labels = {"connect": "zog Pfeile", "change_on_board": "änderte Elemente", "arrange_on_board": "ordnete Elemente an", "show_on_board": "bewegte die Ansicht",
              "remove_from_notes": "nahm eigene Notizen heraus", "undo_last": "nahm den letzten Auftrag zurück"}
    return labels.get(name, name)


def _task(task: dict) -> dict:
    """A task card's fields; a due date that is not a date is left out rather than guessed."""
    out = {"text": str(task["text"]).strip()}
    if str(task.get("owner", "")).strip():
        out["owner"] = str(task["owner"]).strip()
    due = str(task.get("due", "")).strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", due):
        out["due"] = due
    return out


class UnknownRef(Exception):
    pass


INK_NAMES = {"#fbe7b0": "yellow", "#d4edd9": "green", "#d6e6fb": "blue", "#f9d9d9": "pink", "#e6dcf7": "violet",
             "#18181b": "black", "#dc2626": "red", "#ea580c": "orange", "#16a34a": "green", "#2563eb": "blue", "#7c3aed": "violet"}
MAX_ELEMENTS = 200
MAX_NOTES = 3000


def _color(value: str | None) -> str:
    if not value or value == "transparent":
        return ""
    return INK_NAMES.get(value.lower(), value)


# Tags without content; written as <br /> they also arrive as an end tag, which closes nothing.
_VOID = ("area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr")


class _Outline(HTMLParser):
    """The notes as short lines. Vivo's own blocks (data-assistant) are marked so it can take them back."""

    def __init__(self):
        super().__init__()
        self.lines: list[tuple[str | None, str]] = []
        self._block: list[str | None] = []
        self._prefix = ""
        self._text = ""

    def handle_starttag(self, tag, attrs):
        if tag in _VOID:
            self._text += " "
            return
        block = dict(attrs).get("data-assistant")
        self._block.append(block or (self._block[-1] if self._block else None))
        if tag in ("h1", "h2", "h3", "h4"):
            self._prefix = "#" * int(tag[1]) + " "
        elif tag == "li":
            self._prefix = "- "

    def handle_endtag(self, tag):
        if tag in _VOID:
            return
        if tag in ("p", "h1", "h2", "h3", "h4", "li") and self._text.strip():
            self.lines.append((self._block[-1] if self._block else None, self._prefix + self._text.strip()))
            self._text = ""
            if tag != "p" or not self._prefix.startswith("- "):
                self._prefix = ""
        if tag == "li":
            self._prefix = ""
        if self._block:
            self._block.pop()

    def handle_data(self, data):
        self._text += data


class Room:
    """What is on the board and in the notes, under short handles the model can say back."""

    def __init__(self, context: dict):
        self.ids: dict[str, str] = {}
        self.refs: dict[str, str] = {}
        self.blocks: dict[str, str] = {}
        board = context.get("board") or []
        for el in board:
            self.name(el["id"])
        lines = [self._describe(el) for el in board[:MAX_ELEMENTS]]
        if len(board) > MAX_ELEMENTS:
            lines.append(f"… und {len(board) - MAX_ELEMENTS} weitere")
        self.summary = "Whiteboard:\n" + ("\n".join(lines) if lines else "leer")
        self.summary += "\n\nNotizen" + (" (gesperrt, nichts änderbar)" if context.get("notesLocked") else "") + ":\n" + self._notes(context.get("notesHtml") or "")

    def name(self, element_id: str) -> str:
        if element_id not in self.refs:
            ref = f"e{len(self.ids) + 1}"
            self.ids[ref] = element_id
            self.refs[element_id] = ref
        return self.refs[element_id]

    def _describe(self, el: dict) -> str:
        at = f"bei {el['x']},{el['y']} {el['width']}×{el['height']}"
        ref = self.refs[el["id"]]
        kind = el.get("shapeType") or el["type"]
        if el["type"] == "line":
            ends = f"{self.refs.get(el.get('from', ''), '?')} → {self.refs.get(el.get('to', ''), '?')}" if el.get("from") or el.get("to") else at
            parts = [ref, "Pfeil" if el.get("arrow") else "Linie", ends, _color(el.get("color"))]
        elif el["type"] in ("stroke", "image"):
            parts = [ref, "Zeichnung" if el["type"] == "stroke" else "Bild", _color(el.get("color")), at]
        elif el["type"] == "html":
            parts = [ref, "Übersicht", f"„{el['title']}“" if el.get("title") else "", at]
        elif el["type"] == "stamp":
            on = f"auf {self.refs.get(el['on'], '?')}" if el.get("on") else at
            parts = [ref, "Stempel", el.get("stamp", ""), on, f"von {el['by']}" if el.get("by") else ""]
        elif kind == "task":
            parts = [ref, "Aufgabe", f"„{el['text']}“" if el.get("text") else "", f"für {el['owner']}" if el.get("owner") else "",
                     f"bis {el['due']}" if el.get("due") else "", "erledigt" if el.get("done") else "offen", at]
        elif kind == "mindmap":
            text = f"„{el['text']}“" if el.get("text") else ""
            parts = [ref, f"Ast {text} an {self.refs.get(el['parent'], '?')}" if el.get("parent") else f"Mindmap {text}", at]
        elif kind == "table":
            cells = el.get("cells") or [[""]]
            rows = " / ".join(" | ".join(row) for row in cells)
            parts = [ref, f"Tabelle {len(cells)}×{len(cells[0])}", f"„{rows[:300]}“", at]
        elif kind == "section":
            parts = [ref, "Bereich", f"„{el['text']}“" if el.get("text") else "", at]
        else:
            fill = _color(el.get("fill"))
            sticky = kind == "note" or (kind == "rectangle" and fill and el.get("author") == "assistant")
            parts = [ref, "sticky" if sticky else kind, f"„{el['text']}“" if el.get("text") else "",
                     fill or _color(el.get("color")), f"von {el['by']}" if el.get("by") else "", at]
        if el.get("groupId"):
            parts.append(f"Gruppe {el['groupId'][-4:]}")
        return " ".join(p for p in parts if p)

    def _notes(self, html: str) -> str:
        outline = _Outline()
        outline.feed(html)
        lines: list[str] = []
        refs = {}
        for block, text in outline.lines:
            if block and block not in refs:
                refs[block] = f"n{len(refs) + 1}"
                self.blocks[refs[block]] = block
            # Each of its own lines carries the handle, so where its block ends is plain.
            lines.append(f"[{refs[block]}, von dir] {text}" if block else text)
        out = "\n".join(lines) or "leer"
        return out if len(out) <= MAX_NOTES else out[:MAX_NOTES] + " …"

    def id(self, ref: str) -> str:
        if ref in self.ids:
            return self.ids[ref]
        raise UnknownRef(ref)

    def block(self, ref: str) -> str:
        if ref in self.blocks:
            return self.blocks[ref]
        raise UnknownRef(ref)


class Brain:
    MAX_ROUNDS = 6
    # What was said in the minute before a command is given along with it.
    HEARD_BEFORE_S = 60
    HEARD_BEFORE_LINES = 15

    def __init__(self, llm, model: str, api, clock: Callable[[], float] = time.time):
        self.llm = llm
        self.model = model
        self.api = api
        self.clock = clock
        self.history = History()

    def _today(self) -> str:
        day = datetime.fromtimestamp(self.clock(), BERLIN)
        return f"Heute ist {WEEKDAYS[day.weekday()]}, {day.date().isoformat()}."

    def _ask(self, command: Command, transcript: Transcript) -> str:
        """What the model is told about this command: what was said just before, what it did lately, and the sentence itself."""
        parts: list[str] = []
        if command.started_wall:
            # Earlier commands to the assistant are under "Letzte Aufträge" with what came of them; here they would read as
            # something to write down again ("schreib das auf" must not mean the order before).
            lines = transcript.between(command.started_wall - self.HEARD_BEFORE_S, command.started_wall, skip=self.history.spoken)
            before = [line for line in lines if not find_wake(line.split(": ", 1)[-1])][-self.HEARD_BEFORE_LINES:]
            if before:
                parts.append("Zuletzt gesagt (vor dem Auftrag):\n" + "\n".join(before))
        now = self.clock()
        turns = self.history.recent(now)
        if turns:
            parts.append("Letzte Aufträge in diesem Call:\n" + "\n".join(
                f"- vor {max(0, round(now - t.at))} s, {t.speaker}: „{_clip(t.command, 120)}“ → {t.outcome}" for t in turns))
        language = LANGUAGE_NAMES.get(command.language)
        spoken = f"{command.speaker} sagte" + (f" (spricht {language})" if language else "")
        parts.append(f"{spoken}: „{command.heard or command.command}“")
        where = POSITION.get(command.kind)
        if where:
            parts.append(where)
        return "\n\n".join(parts)

    async def handle(self, command: Command, transcript: Transcript) -> Outcome:
        language = command.language
        try:
            room = Room(await self.api.query("assistant:context", {}))
        except ConvexError as error:
            log.info("could not read the room: %s", error)
            room = Room({})
        command_id = uuid.uuid4().hex
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": SYSTEM + "\n\n" + self._today() + "\n\n" + room.summary},
            {"role": "user", "content": self._ask(command, transcript)},
        ]
        done: list[str] = []
        changed = ignored = False
        asked = False

        async def answer(text: str, asking: bool) -> Outcome:
            nonlocal asked
            asked = asking
            try:
                await self._send(command, command_id, "assistant:reply", {"text": text})
            except Exception:
                log.exception("could not tell the room")
            done.append(f"Antwort: {_clip(text)}")
            return Outcome(asked=asking)

        try:
            for _ in range(self.MAX_ROUNDS):
                response = await self.llm.chat.completions.create(model=self.model, messages=messages, tools=TOOLS)
                message = response.choices[0].message
                calls = message.tool_calls or []
                if not calls:
                    text = (message.content or "").strip()
                    if ignored and not changed:
                        return Outcome(silent=True)
                    if changed:
                        break
                    outcome = await answer(text or say("not_understood", language), asking=not text or text.endswith("?"))
                    self._remember(command, done)
                    return outcome
                messages.append({
                    "role": "assistant",
                    "content": message.content or "",
                    "tool_calls": [{"id": c.id, "type": "function", "function": {"name": c.function.name, "arguments": c.function.arguments}} for c in calls],
                })
                for call in calls:
                    if call.function.name == "ignore":
                        ignored = True
                        messages.append({"role": "tool", "tool_call_id": call.id, "content": "Erledigt."})
                        continue
                    result, did_change = await self._run(call.function.name, call.function.arguments, command, command_id, room, transcript, done)
                    changed = changed or did_change
                    if call.function.name == "reply" and did_change:
                        asked = asked or _reply_text(_json(call.function.arguments), command).endswith("?")
                    messages.append({"role": "tool", "tool_call_id": call.id, "content": result})
            else:
                if not changed and not ignored:
                    outcome = await answer(say("not_understood", language), asking=True)
                    self._remember(command, done)
                    return outcome
        except Exception:
            # The model did not answer (timeout, rate limit): say so, instead of leaving the room waiting for a reaction.
            log.exception("a command failed")
            if not changed:
                outcome = await answer(say("failed", language), asking=True)
                self._remember(command, done)
                return outcome
        if ignored and not changed:
            return Outcome(silent=True)
        self._remember(command, done)
        return Outcome(asked=asked)

    def _remember(self, command: Command, done: list[str]) -> None:
        span = (command.started_wall, command.ended_wall or command.started_wall) if command.started_wall else None
        self.history.add(at=self.clock(), speaker=command.speaker, command=command.command or command.heard, outcome="; ".join(done) or "nichts", span=span)

    async def _send(self, command: Command, command_id: str, name: str, args: dict):
        return await self.api.mutation(name, {"heard": command.heard, "commandId": command_id, **args})

    async def _run(self, name: str, raw: str, command: Command, command_id: str, room: Room, transcript: Transcript, done: list[str]) -> tuple[str, bool]:
        """Runs one tool and notes in `done` what it did. Returns what the model gets back, and whether the room changed."""
        result, changed = await self._execute(name, raw, command, command_id, room, transcript)
        if changed:
            try:
                args = json.loads(raw or "{}")
            except json.JSONDecodeError:
                args = {}
            done.append(f"Antwort: {_clip(_reply_text(args, command))}" if name == "reply" else _did(name, args))
        return result, changed

    async def _execute(self, name: str, raw: str, command: Command, command_id: str, room: Room, transcript: Transcript) -> tuple[str, bool]:
        try:
            args = json.loads(raw or "{}")
        except json.JSONDecodeError:
            return "Fehler: Die Argumente waren kein JSON.", False

        def place() -> dict:
            out: dict[str, Any] = {}
            if args.get("layout") in LAYOUTS:
                out["layout"] = args["layout"]
            if args.get("near"):
                out["near"] = room.id(args["near"])
                if args.get("side") in SIDES:
                    out["side"] = args["side"]
            return out

        def links(keys: set[str]) -> list[dict]:
            end = lambda v: v if v in keys else room.id(v)
            return [{"from": end(l["from"]), "to": end(l["to"])} for l in args.get("links", [])]

        send = lambda mutation, payload: self._send(command, command_id, mutation, payload)
        try:
            if name == "add_to_board":
                items = [{k: i[k] for k in ("key", "kind", "text", "color") if i.get(k)} for i in args.get("items", [])]
                keys = {i["key"] for i in items if "key" in i}
                payload = {"items": items, **place()}
                if args.get("links"):
                    payload["links"] = links(keys)
                result = await send("assistant:addToBoard", payload)
                new = (result or {}).get("ids") or {}
                return ("Erledigt. Neu: " + ", ".join(f"{k} = {room.name(v)}" for k, v in new.items())) if new else "Erledigt.", True
            elif name == "add_overview":
                result = await send("assistant:addViewToBoard", {"title": str(args.get("title", "")), "spec": args.get("spec") or {}, **place()})
                new = (result or {}).get("id")
                return (f"Erledigt. Neu: {room.name(new)}" if new else "Erledigt."), True
            elif name == "connect":
                await send("assistant:connectOnBoard", {"links": links(set())})
            elif name == "change_on_board":
                changes = [{"id": room.id(c["ref"]), **{k: c[k] for k in ("text", "color") if c.get(k)}} for c in args.get("changes", [])]
                await send("assistant:changeOnBoard", {"changes": changes})
            elif name == "arrange_on_board":
                await send("assistant:arrangeOnBoard", {"ids": [room.id(r) for r in args.get("refs", [])], **place()})
            elif name == "delete_from_board":
                await send("assistant:deleteFromBoard", {"ids": [room.id(r) for r in args.get("refs", [])]})
            elif name == "show_on_board":
                refs = args.get("refs") or []
                await send("assistant:showOnBoard", {**({"ids": [room.id(r) for r in refs]} if refs else {}), "mode": ZOOM.get(args.get("mode"), "fit")})
            elif name == "append_to_notes":
                parts = {k: args[k] for k in ("heading", "paragraphs", "bullets") if args.get(k)}
                await send("assistant:appendToNotes", parts)
            elif name == "add_tasks":
                tasks = [_task(t) for t in args.get("tasks", []) if str(t.get("text", "")).strip()]
                await send("assistant:addTasksToBoard", {"tasks": tasks})
            elif name == "add_branches":
                payload = {"under": room.id(args["under"])} if args.get("under") else {"topic": str(args.get("topic", "")).strip()}
                payload["branches"] = [str(b).strip() for b in args.get("branches", []) if str(b).strip()]
                result = await send("assistant:addBranchesToBoard", payload)
                new = (result or {}).get("ids") or []
                return ("Erledigt. Neu: " + ", ".join(room.name(i) for i in new)) if new else "Erledigt.", True
            elif name == "remove_from_notes":
                await send("assistant:removeFromNotes", {"blockIds": [room.block(r) for r in args.get("refs", [])]})
            elif name == "read_transcript":
                minutes = max(1, min(60, int(args.get("minutes", 10))))
                since = self.clock() - minutes * 60
                lines = transcript.since(since)
                # The transcript starts when the assistant came; it must not pass for the whole call.
                note = ""
                if transcript.started > since:
                    present = max(0, round((self.clock() - transcript.started) / 60))
                    note = f"(Ich höre erst seit etwa {present} Minuten mit; davor kenne ich nichts.)\n"
                return note + ("\n".join(lines) or "Seit ich dabei bin, wurde nichts gesagt."), False
            elif name == "undo_last":
                await send("assistant:undoLast", {})
            elif name == "reply":
                await send("assistant:reply", {"text": _reply_text(args, command)})
            else:
                return f"Fehler: Werkzeug {name} gibt es nicht.", False
        except UnknownRef as error:
            return f"Fehler: {error} gibt es nicht. Nimm ein Kürzel aus der Übersicht.", False
        except ConvexError as error:
            # The reason goes back to the model, which tells the room in a reply.
            log.info("room refused %s: %s", name, error)
            return f"Fehler: {error}", False
        return "Erledigt.", True
