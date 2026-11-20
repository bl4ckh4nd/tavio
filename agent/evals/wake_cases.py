"""What people say to the assistant (and what they say that is not for it), for measuring wake word and command detection.

`say` is spoken as one stretch. `parts` is spoken with a real pause between the pieces (a wake word alone, then the
command). `expect` is the command the assistant should pick out; None means it must not wake at all.
Numbers are written out so that speech-to-text spelling does not decide the comparison.

Even indices are the development half, odd indices the held-out half: tuning the matcher is allowed to look at the
development half only, and the held-out half tells whether that generalised.
"""

from __future__ import annotations

POSITIVE: list[dict] = [
    # The wake word first.
    {"say": "Vivo, schreib aufs Whiteboard: Release am dritten Dezember.", "expect": "schreib aufs Whiteboard: Release am dritten Dezember", "kind": "start"},
    {"say": "Vivo, fass die letzten zehn Minuten in den Notizen zusammen.", "expect": "fass die letzten zehn Minuten in den Notizen zusammen", "kind": "start"},
    {"say": "Vivo, leg eine Aufgabe an: Jonas schickt die Zahlen bis Freitag.", "expect": "leg eine Aufgabe an: Jonas schickt die Zahlen bis Freitag", "kind": "start"},
    {"say": "Vivo, mach das rückgängig.", "expect": "mach das rückgängig", "kind": "start"},
    {"say": "Vivo, zeig mir das ganze Board.", "expect": "zeig mir das ganze Board", "kind": "start"},
    {"say": "Vivo, lösch den gelben Zettel.", "expect": "lösch den gelben Zettel", "kind": "start"},
    {"say": "Vivo, ordne die Zettel in einer Reihe an.", "expect": "ordne die Zettel in einer Reihe an", "kind": "start"},
    {"say": "Vivo, zeichne ein Diagramm mit Planung, Umsetzung und Test.", "expect": "zeichne ein Diagramm mit Planung, Umsetzung und Test", "kind": "start"},
    {"say": "Vivo, was haben wir bisher besprochen?", "expect": "was haben wir bisher besprochen", "kind": "start"},
    {"say": "Vivo bitte schreib das auf.", "expect": "bitte schreib das auf", "kind": "start"},
    {"say": "Vivo, mach daraus eine Aufgabe für Lena.", "expect": "mach daraus eine Aufgabe für Lena", "kind": "start"},
    {"say": "Vivo, häng drei Ideen an die Mindmap: Videos, Checklisten und eine Willkommensmail.", "expect": "häng drei Ideen an die Mindmap: Videos, Checklisten und eine Willkommensmail", "kind": "start"},
    {"say": "Vivo, zoom bitte etwas heraus.", "expect": "zoom bitte etwas heraus", "kind": "start"},
    {"say": "Vivo, nimm den letzten Zettel wieder weg.", "expect": "nimm den letzten Zettel wieder weg", "kind": "start"},
    # With a greeting or filler before it.
    {"say": "Hey Vivo, notier bitte die drei Punkte aus der Diskussion.", "expect": "notier bitte die drei Punkte aus der Diskussion", "kind": "greeting"},
    {"say": "Okay Vivo, mach eine Mindmap zum Thema Onboarding.", "expect": "mach eine Mindmap zum Thema Onboarding", "kind": "greeting"},
    {"say": "Hallo Vivo, kannst du bitte alles heranzoomen?", "expect": "kannst du bitte alles heranzoomen", "kind": "greeting"},
    {"say": "Äh, Vivo, schreib auf: Rückmeldung bis Montag.", "expect": "schreib auf: Rückmeldung bis Montag", "kind": "greeting"},
    {"say": "Also Vivo, leg bitte einen Zettel an: Budget klären.", "expect": "leg bitte einen Zettel an: Budget klären", "kind": "greeting"},
    {"say": "Dann Vivo, mach eine Aufgabe daraus.", "expect": "mach eine Aufgabe daraus", "kind": "greeting"},
    {"say": "Und Vivo, zoom bitte wieder heraus.", "expect": "zoom bitte wieder heraus", "kind": "greeting"},
    {"say": "Ja Vivo, das stimmt so, schreib es bitte in die Notizen.", "expect": "das stimmt so, schreib es bitte in die Notizen", "kind": "greeting"},
    # The wake word last: the command is what came before.
    {"say": "Schreib das bitte aufs Board, Vivo.", "expect": "Schreib das bitte aufs Board", "kind": "end"},
    {"say": "Notier das bitte, Vivo.", "expect": "Notier das bitte", "kind": "end"},
    {"say": "Fass die Besprechung zusammen, Vivo.", "expect": "Fass die Besprechung zusammen", "kind": "end"},
    {"say": "Mach das rückgängig, Vivo.", "expect": "Mach das rückgängig", "kind": "end"},
    {"say": "Kannst du das bitte mal aufschreiben, Vivo?", "expect": "Kannst du das bitte mal aufschreiben", "kind": "end"},
    {"say": "Leg dafür eine Aufgabe für Jonas an, Vivo.", "expect": "Leg dafür eine Aufgabe für Jonas an", "kind": "end"},
    # Addressed in the middle of the sentence.
    {"say": "Kannst du, Vivo, bitte die Zahlen notieren?", "expect": "Kannst du bitte die Zahlen notieren", "kind": "middle"},
    {"say": "Mach bitte, Vivo, einen Zettel mit dem Budget.", "expect": "Mach bitte einen Zettel mit dem Budget", "kind": "middle"},
    # The wake word alone, then the command after a breath.
    {"parts": ["Vivo.", "Schreib auf: Angebot an Müller schicken."], "expect": "Schreib auf: Angebot an Müller schicken", "kind": "split"},
    {"parts": ["Vivo,", "fass kurz zusammen, was wir beschlossen haben."], "expect": "fass kurz zusammen, was wir beschlossen haben", "kind": "split"},
    # One command with a pause in the middle.
    {"parts": ["Vivo, schreib aufs Whiteboard:", "Termin mit dem Kunden am Dienstag."], "expect": "schreib aufs Whiteboard: Termin mit dem Kunden am Dienstag", "kind": "pause"},
    {"parts": ["Vivo, leg eine Aufgabe an", "Anna bucht den Raum."], "expect": "leg eine Aufgabe an Anna bucht den Raum", "kind": "pause"},
    # English.
    {"say": "Vivo, add a sticky note: finish the budget.", "expect": "add a sticky note: finish the budget", "kind": "start", "lang": "en"},
    {"say": "Hey Vivo, summarize the last five minutes.", "expect": "summarize the last five minutes", "kind": "greeting", "lang": "en"},
    {"say": "Vivo, undo that.", "expect": "undo that", "kind": "start", "lang": "en"},
    {"say": "Put that on the board, Vivo.", "expect": "Put that on the board", "kind": "end", "lang": "en"},
    {"say": "Okay Vivo, create a task for Anna to send the invoice.", "expect": "create a task for Anna to send the invoice", "kind": "greeting", "lang": "en"},
    {"say": "Vivo, zoom out please.", "expect": "zoom out please", "kind": "start", "lang": "en"},
]

NEGATIVE: list[dict] = [
    # Words that sound close.
    {"say": "Wir sollten das Video von gestern noch anschauen.", "kind": "near"},
    {"say": "Vivaldi läuft heute im Radio.", "kind": "near"},
    {"say": "Wie wo war das noch gleich?", "kind": "near"},
    {"say": "Vito kommt heute etwas später.", "kind": "near"},
    {"say": "Die Vivi übernimmt das morgen.", "kind": "near"},
    {"say": "Das ist eine FIFO-Queue im Backend.", "kind": "near"},
    {"say": "Hoch lebe die Viva la Vida Tour.", "kind": "near"},
    {"say": "Wo ist denn das Protokoll von letzter Woche?", "kind": "near"},
    {"say": "Weißt du, wo das Dokument liegt?", "kind": "near"},
    # The name said about the assistant, not to it.
    {"say": "Ich habe Vivo gestern ausprobiert, das war ganz nützlich.", "kind": "mention"},
    {"say": "Gestern hat Vivo das richtig gut gemacht.", "kind": "mention"},
    {"say": "Findest du, dass Vivo die Zusammenfassungen gut hinbekommt?", "kind": "mention"},
    {"say": "Die Vivo Smartphones sind in Indien sehr beliebt.", "kind": "mention"},
    {"say": "Letzte Woche hat uns Vivo drei Aufgaben angelegt.", "kind": "mention"},
    # Ordinary meeting talk that sounds like commands.
    {"say": "Wir müssen die Zahlen bis Freitag schicken.", "kind": "talk"},
    {"say": "Kannst du bitte den Bildschirm teilen?", "kind": "talk"},
    {"say": "Ich schreibe das gleich in die Notizen.", "kind": "talk"},
    {"say": "Lass uns kurz zusammenfassen, was wir bisher haben.", "kind": "talk"},
    {"say": "Das Whiteboard ist leider gerade zu klein.", "kind": "talk"},
    {"say": "Ich glaube, die Mindmap wäre hier besser.", "kind": "talk"},
    {"say": "Hört ihr mich gut?", "kind": "talk"},
    {"say": "Jonas, kannst du das Budget zusammenfassen?", "kind": "talk"},
    {"say": "Okay, dann lass uns beginnen.", "kind": "talk"},
    {"say": "Mach bitte kurz das Fenster zu, es zieht.", "kind": "talk"},
    {"say": "Ich fand das Angebot von Müller eigentlich ganz gut.", "kind": "talk"},
    {"say": "Dann machen wir am Dienstag mit dem Kunden weiter.", "kind": "talk"},
    {"say": "Hallo zusammen, schön dass ihr alle da seid.", "kind": "talk"},
    {"say": "Wer schreibt heute das Protokoll?", "kind": "talk"},
    {"say": "Did you watch the video I sent?", "kind": "talk", "lang": "en"},
    {"say": "We should put that on the roadmap.", "kind": "talk", "lang": "en"},
    {"say": "The colors on the slide are very vivid.", "kind": "talk", "lang": "en"},
    {"say": "Can you share your screen, please?", "kind": "talk", "lang": "en"},
]


def cases() -> list[dict]:
    """Every case with an id and its half (dev or held-out)."""
    out = []
    for group, items in (("pos", POSITIVE), ("neg", NEGATIVE)):
        for i, item in enumerate(items):
            out.append({"id": f"{group}{i:02d}", "positive": group == "pos", "split": "dev" if i % 2 == 0 else "held", "lang": "de", **item})
    return out
