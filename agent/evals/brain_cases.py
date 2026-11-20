"""Spoken commands with the room around them, and what the assistant should do. For `brain_eval.py`.

Each case:
  say      the command as the collector hands it over (what the old brain was given)
  full     the whole sentence with the name, as the assistant now receives it (default: "Vivo, " + say)
  speaker  who said it (default Lena)
  heard    seconds-ago lines of what was said before the command: [(seconds ago, "Name: text"), ...]
  history  earlier commands in this call: [(seconds ago, speaker, command, what Vivo did or answered), ...]
  board / notes   what is in the room (see ROOM)
  any      the room-changing calls of which at least one must happen (Convex mutation names)
  silent   nothing at all may happen: the sentence was not an instruction to the assistant
  has      words that must appear in what it did ("a|b": either one); avoid: words that must not
"""

from __future__ import annotations

def _sticky(id_: str, text: str, fill: str, x: int, y: int) -> dict:
    return {"id": id_, "type": "shape", "shapeType": "rectangle", "x": x, "y": y, "width": 200, "height": 140, "text": text, "fill": fill, "color": "transparent", "author": "assistant"}


STICKIES = [_sticky("wb-aaaa", "Design", "#fbe7b0", 100, 100), _sticky("wb-bbbb", "Launch", "#d6e6fb", 400, 100), _sticky("wb-cccc", "Test", "#d4edd9", 700, 100)]
MINDMAP = [
    {"id": "mm-root", "type": "shape", "shapeType": "mindmap", "x": 300, "y": 300, "width": 180, "height": 70, "text": "Onboarding"},
    {"id": "mm-1", "type": "shape", "shapeType": "mindmap", "x": 560, "y": 260, "width": 160, "height": 60, "text": "Checklisten", "parent": "mm-root"},
]
NOTES = '<h2>Agenda</h2><p>Begrüßung und Runde</p><ul data-assistant="blk-1"><li><p>Zahlen schicken</p></li></ul><p>Von Lena danach</p>'

ROOM = {
    "empty": {"board": [], "notesHtml": "", "notesLocked": False},
    "stickies": {"board": STICKIES, "notesHtml": "", "notesLocked": False},
    "mindmap": {"board": MINDMAP, "notesHtml": "", "notesLocked": False},
    "notes": {"board": [], "notesHtml": NOTES, "notesLocked": False},
}

TRANSCRIPT = [
    (540, "Sara: Wir haben jetzt Version zwei fertig."),
    (400, "Jonas: Der Kunde möchte den Release auf den ersten Dezember vorziehen."),
    (300, "Sara: Das schaffen wir nur, wenn Anna das Testing übernimmt."),
    (200, "Anna: Ja, das kann ich machen, aber nur bis zum dritten Dezember."),
    (100, "Jonas: Dann klären wir das Budget noch mit dem Controlling."),
]

CASES: list[dict] = [
    # Plain commands.
    {"id": "board-text", "group": "simple", "say": "schreib aufs Whiteboard: Release am dritten Dezember", "any": ["assistant:addToBoard"], "has": ["release"]},
    {"id": "task", "group": "simple", "say": "leg eine Aufgabe an: Jonas schickt die Zahlen bis Freitag", "any": ["assistant:addTasksToBoard"], "has": ["jonas", "zahlen"]},
    {"id": "undo", "group": "simple", "say": "mach das rückgängig", "any": ["assistant:undoLast"]},
    {"id": "show-all", "group": "simple", "say": "zeig mir das ganze Board", "room": "stickies", "any": ["assistant:showOnBoard"]},
    {"id": "zoom-out", "group": "simple", "say": "zoom bitte etwas heraus", "room": "stickies", "any": ["assistant:showOnBoard"]},
    {"id": "delete-yellow", "group": "simple", "say": "lösch den gelben Zettel", "room": "stickies", "any": ["assistant:deleteFromBoard"], "has": ["wb-aaaa"], "avoid": ["wb-bbbb", "wb-cccc"]},
    {"id": "arrange-row", "group": "simple", "say": "ordne die Zettel in einer Reihe an", "room": "stickies", "any": ["assistant:arrangeOnBoard"], "has": ["row"]},
    {"id": "diagram", "group": "simple", "say": "zeichne ein Diagramm mit Planung, Umsetzung und Test", "any": ["assistant:addToBoard"], "has": ["planung", "umsetzung", "test", "links"]},
    {"id": "mindmap", "group": "simple", "say": "häng drei Ideen an die Mindmap: Videos, Checklisten und eine Willkommensmail", "room": "mindmap", "any": ["assistant:addBranchesToBoard"], "has": ["videos", "willkommensmail"]},
    {"id": "notes", "group": "simple", "say": "schreib in die Notizen: Entscheidung, wir starten im Januar", "any": ["assistant:appendToNotes"], "has": ["januar"]},
    {"id": "recolor", "group": "simple", "say": "mach den Zettel Launch grün", "room": "stickies", "any": ["assistant:changeOnBoard"], "has": ["wb-bbbb", "green"]},
    {"id": "connect", "group": "simple", "say": "verbinde Design mit Launch", "room": "stickies", "any": ["assistant:connectOnBoard"], "has": ["wb-aaaa", "wb-bbbb"]},
    {"id": "overview", "group": "simple", "say": "mach eine Übersicht mit Stand, Zahlen und Zeitplan aus dem, was wir gesagt haben", "heard": TRANSCRIPT, "any": ["assistant:addViewToBoard"]},
    {"id": "remove-notes", "group": "simple", "say": "nimm deinen Eintrag aus den Notizen wieder raus", "room": "notes", "any": ["assistant:removeFromNotes"], "has": ["blk-1"]},
    {"id": "question", "group": "simple", "say": "erzähl mir einen Witz über Meetings", "any": ["assistant:reply"]},
    {"id": "summary", "group": "simple", "say": "fass die letzten zehn Minuten in den Notizen zusammen", "heard": TRANSCRIPT, "any": ["assistant:appendToNotes"], "has": ["release", "anna"]},
    # English.
    {"id": "en-sticky", "group": "english", "say": "add a sticky note: finish the budget", "any": ["assistant:addToBoard"], "has": ["budget"]},
    {"id": "en-undo", "group": "english", "say": "undo that", "any": ["assistant:undoLast"]},
    {"id": "en-task", "group": "english", "say": "create a task for Anna to send the invoice by Friday", "any": ["assistant:addTasksToBoard"], "has": ["anna", "invoice"]},
    {"id": "en-summary", "group": "english", "say": "summarize the last five minutes into the notes", "heard": TRANSCRIPT, "any": ["assistant:appendToNotes"], "has": ["anna"]},
    # "this", "that": what was just said.
    {"id": "that-board", "group": "deictic", "say": "schreib das auf", "heard": [(8, "Jonas: Wir brauchen bis Freitag die Zahlen vom Controlling.")], "any": ["assistant:addToBoard", "assistant:appendToNotes", "assistant:addTasksToBoard"], "has": ["controlling"]},
    {"id": "that-task", "group": "deictic", "say": "mach daraus eine Aufgabe für Lena", "heard": [(10, "Sara: Jemand muss noch den Raum für Dienstag buchen.")], "any": ["assistant:addTasksToBoard"], "has": ["raum", "lena"]},
    {"id": "that-notes", "group": "deictic", "say": "notier das in den Notizen", "heard": [(6, "Anna: Wir haben uns auf den ersten Januar als Starttermin geeinigt.")], "any": ["assistant:appendToNotes"], "has": ["januar"]},
    {"id": "that-me", "group": "deictic", "say": "trag das als Aufgabe für mich ein", "speaker": "Lena", "heard": [(12, "Jonas: Lena, schick bitte morgen das Angebot an Müller.")], "any": ["assistant:addTasksToBoard"], "has": ["angebot", "lena"]},
    {"id": "that-decision", "group": "deictic", "say": "halt die Entscheidung fest", "heard": TRANSCRIPT[-3:], "any": ["assistant:appendToNotes", "assistant:addToBoard"], "has": ["dritten|3. dezember|3.12"]},
    # What was said and done earlier in the call.
    {"id": "one-more", "group": "history", "say": "und noch einen: Raum buchen", "history": [(30, "Lena", "leg einen Zettel an: Budget klären", "legte 1 Zettel aufs Board")], "any": ["assistant:addToBoard"], "has": ["raum"], "avoid": ["budget"]},
    {"id": "answer-to-question", "group": "history", "say": "Release auf Montag verschieben", "history": [(6, "Lena", "schreib das auf", "Antwort: Was soll ich aufschreiben?")], "any": ["assistant:addToBoard", "assistant:appendToNotes", "assistant:addTasksToBoard"], "has": ["release", "montag"]},
    {"id": "which-one", "group": "history", "say": "den gelben", "room": "stickies", "history": [(7, "Lena", "lösch den Zettel", "Antwort: Meinst du den gelben, den blauen oder den grünen Zettel?")], "any": ["assistant:deleteFromBoard"], "has": ["wb-aaaa"], "avoid": ["wb-bbbb", "wb-cccc"]},
    {"id": "again-for", "group": "history", "say": "mach das Gleiche für Sara", "history": [(25, "Lena", "leg eine Aufgabe an: Zahlen schicken, Jonas, bis Freitag", "legte 1 Aufgabe aufs Board")], "any": ["assistant:addTasksToBoard"], "has": ["sara", "zahlen"]},
    # The command was followed by ordinary talk.
    {"id": "chatter", "group": "chatter", "say": "notier die Zahlen. Okay und dann kommen wir zum nächsten Punkt, der Planung.", "heard": [(9, "Jonas: Der Umsatz lag im dritten Quartal bei zwölf Millionen Euro.")], "any": ["assistant:addToBoard", "assistant:appendToNotes"], "has": ["zwölf|12"], "avoid": ["planung"]},
    {"id": "chatter-2", "group": "chatter", "say": "leg einen Zettel an: Budget klären. Anna, hast du eigentlich schon die Folien?", "any": ["assistant:addToBoard"], "has": ["budget"], "avoid": ["folien"]},
    # The name was said about the assistant, or speech-to-text wrote it for another word: nothing at all may happen.
    # `full` is the whole sentence as the assistant now receives it; `say` is only what the old matcher cut out.
    {"id": "not-for-me-1", "group": "silent", "say": "hat das richtig gut gemacht.", "full": "Gestern hat Vivo das richtig gut gemacht.", "silent": True},
    {"id": "not-for-me-2", "group": "silent", "say": "kommt heute etwas später.", "full": "Vivo kommt heute etwas später.", "silent": True},
    {"id": "not-for-me-3", "group": "silent", "say": "gestern ausprobiert, das war ganz nützlich.", "full": "Ich habe Vivo gestern ausprobiert, das war ganz nützlich.", "silent": True},
    {"id": "not-for-me-4", "group": "silent", "say": "Smartphones sind in Indien sehr beliebt.", "full": "Die Vivo Smartphones sind in Indien sehr beliebt.", "silent": True},
    {"id": "not-for-me-5", "group": "silent", "say": "die Zusammenfassungen gut hinbekommt?", "full": "Findest du, dass Vivo die Zusammenfassungen gut hinbekommt?", "silent": True},
    {"id": "not-for-me-6", "group": "silent", "say": "3 Aufgaben angelegt.", "full": "Letzte Woche hat uns Vivo 3 Aufgaben angelegt.", "silent": True},
    {"id": "not-for-me-7", "group": "silent", "say": "war das noch gleich?", "full": "Vivo war das noch gleich?", "silent": True},
    {"id": "not-for-me-8", "group": "silent", "say": "übernimmt das Morgen.", "full": "Die Vivo übernimmt das Morgen.", "silent": True},
    {"id": "not-for-me-9", "group": "silent", "say": "wird auch von Jonas genutzt.", "full": "Vivo wird auch von Jonas genutzt.", "silent": True},
    # Where the name stands in the sentence.
    {"id": "end-board", "group": "position", "say": "Schreib das bitte aufs Board", "full": "Schreib das bitte aufs Board, Vivo.", "heard": [(8, "Anna: Wir starten am ersten Januar.")], "any": ["assistant:addToBoard"], "has": ["januar"]},
    {"id": "end-undo", "group": "position", "say": "Mach das rückgängig", "full": "Mach das rückgängig, Vivo.", "any": ["assistant:undoLast"]},
    {"id": "middle-task", "group": "position", "say": "Kannst du bitte eine Aufgabe für Jonas anlegen: Zahlen schicken", "full": "Kannst du, Vivo, bitte eine Aufgabe für Jonas anlegen: Zahlen schicken.", "any": ["assistant:addTasksToBoard"], "has": ["jonas", "zahlen"]},
    {"id": "greeting-notes", "group": "position", "say": "schreib in die Notizen: Rückmeldung bis Montag", "full": "Äh, Vivo, schreib in die Notizen: Rückmeldung bis Montag.", "any": ["assistant:appendToNotes"], "has": ["montag"]},
    # Speech-to-text got the command a little wrong.
    {"id": "asr-1", "group": "asr", "say": "Fast die letzten 10 Minuten in den Notizen zusammen.", "heard": TRANSCRIPT, "any": ["assistant:appendToNotes"], "has": ["release"]},
    {"id": "asr-2", "group": "asr", "say": "Legt wieder einen Zettel an: Budget klären.", "any": ["assistant:addToBoard"], "has": ["budget"]},
    {"id": "asr-3", "group": "asr", "say": "hängt 3 Ideen an die Mindnapt: Video, Checklisten und eine Mail.", "room": "mindmap", "any": ["assistant:addBranchesToBoard"], "has": ["checklisten"]},
    # Speech-to-text wrote the verb as if the assistant were doing it, which it did in the real runs ("Vivo hängt 3 Ideen an die Mindmap").
    {"id": "asr-4", "group": "asr", "say": "schreibt es auf.", "full": "Vivo schreibt es auf.", "heard": [(8, "Anna: Wir starten am ersten Januar.")], "any": ["assistant:addToBoard", "assistant:appendToNotes"], "has": ["januar"]},
    {"id": "asr-5", "group": "asr", "say": "legt eine Aufgabe an: Zahlen schicken.", "full": "Vivo legt eine Aufgabe an: Zahlen schicken.", "any": ["assistant:addTasksToBoard"], "has": ["zahlen"]},
    # The rest of a command that the recogniser delivered after the first half had already gone on.
    {"id": "continued", "group": "history", "say": "Release am dritten Dezember.", "full": "Release am dritten Dezember.", "kind": "continue",
     "history": [(5, "Lena", "schreib aufs Whiteboard.", "Antwort: Was soll ich aufs Whiteboard schreiben?")], "any": ["assistant:addToBoard"], "has": ["release"]},
]
