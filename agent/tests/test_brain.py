import asyncio
import json
from types import SimpleNamespace

from tavio_assistant.brain import Brain, Transcript
from tavio_assistant.convex_api import ConvexError
from tavio_assistant.wake import Command


class FakeApi:
    """Stands in for Convex: records each mutation, and can refuse one. The command id goes to its own list."""

    def __init__(self, refuse: dict[str, str] | None = None, context: dict | None = None, results: dict | None = None):
        self.calls: list[tuple[str, dict]] = []
        self.command_ids: list[str] = []
        self.refuse = refuse or {}
        self.context = context or {"board": [], "notesHtml": "", "notesLocked": False}
        self.results = results or {}

    async def mutation(self, name: str, args: dict):
        args = dict(args)
        self.command_ids.append(args.pop("commandId", None))
        self.calls.append((name, args))
        if name in self.refuse:
            raise ConvexError(self.refuse[name])
        return self.results.get(name, {"editId": "e1", "count": 1})

    async def query(self, name: str, args: dict):
        assert name == "assistant:context"
        return self.context


def tool_call(name: str, args: dict, call_id: str = "c1"):
    return SimpleNamespace(id=call_id, type="function", function=SimpleNamespace(name=name, arguments=json.dumps(args)))


def answer(*, tools=None, text=None):
    message = SimpleNamespace(content=text, tool_calls=tools or None)
    return SimpleNamespace(choices=[SimpleNamespace(message=message)])


class FakeLlm:
    """Plays back scripted answers and keeps what it was sent."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.requests: list[dict] = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    async def _create(self, **request):
        self.requests.append(json.loads(json.dumps(request, default=lambda o: o.__dict__)))
        return self.answers.pop(0)


def run(brain, command, transcript=None):
    asyncio.run(brain.handle(command, transcript or Transcript()))


CMD = Command(speaker="Lena", heard="Vivo, schreib aufs Whiteboard: Release am 3. Dezember", command="schreib aufs Whiteboard: Release am 3. Dezember")


def test_board_command_becomes_notes_on_the_board_with_what_was_heard():
    api = FakeApi()
    llm = FakeLlm(answer(tools=[tool_call("add_to_board", {"items": [{"kind": "sticky", "text": "Release am 3. Dezember"}]})]), answer(text="Erledigt."))
    run(Brain(llm, "m", api), CMD)
    assert api.calls == [("assistant:addToBoard", {"heard": CMD.heard, "items": [{"kind": "sticky", "text": "Release am 3. Dezember"}]})]


def test_tasks_become_task_cards_on_the_board_with_a_date_it_can_work_out():
    api = FakeApi()
    llm = FakeLlm(answer(tools=[tool_call("add_tasks", {"tasks": [{"text": "Zahlen schicken", "owner": "Jonas", "due": "2026-11-20"}, {"text": "Aufnahme testen", "due": "Freitag"}]})]), answer(text=""))
    friday_13th_noon = 1794567600  # 2026-11-13 12:00 in Europe/Berlin
    run(Brain(llm, "m", api, clock=lambda: friday_13th_noon), CMD)
    assert "Heute ist Freitag, 2026-11-13." in llm.requests[0]["messages"][0]["content"]
    # A date that is not a date is left out rather than guessed.
    assert api.calls == [("assistant:addTasksToBoard", {"heard": CMD.heard, "tasks": [
        {"text": "Zahlen schicken", "owner": "Jonas", "due": "2026-11-20"}, {"text": "Aufnahme testen"},
    ]})]


def test_a_summary_reads_the_transcript_first_and_only_the_asked_minutes():
    api = FakeApi()
    transcript = Transcript()
    transcript.add(at=0, speaker="Jonas", text="Alte Sache")
    transcript.add(at=900, speaker="Sara", text="Wir verschieben den Release")
    llm = FakeLlm(
        answer(tools=[tool_call("read_transcript", {"minutes": 10})]),
        answer(tools=[tool_call("append_to_notes", {"heading": "Zusammenfassung", "bullets": ["Release verschoben"]}, "c2")]),
        answer(text=""),
    )
    brain = Brain(llm, "m", api, clock=lambda: 1000)
    run(brain, CMD, transcript)
    tool_result = llm.requests[1]["messages"][-1]
    assert tool_result["role"] == "tool"
    assert "Sara: Wir verschieben den Release" in tool_result["content"]
    assert "Alte Sache" not in tool_result["content"]
    assert api.calls[0][0] == "assistant:appendToNotes"


def test_a_plain_answer_is_shown_as_a_reply():
    api = FakeApi()
    run(Brain(FakeLlm(answer(text="Dafür habe ich kein Werkzeug.")), "m", api), CMD)
    assert api.calls == [("assistant:reply", {"heard": CMD.heard, "text": "Dafür habe ich kein Werkzeug."})]


def test_a_refusal_from_the_room_is_passed_back_and_ends_as_a_reply():
    api = FakeApi(refuse={"assistant:appendToNotes": "The notes are locked"})
    llm = FakeLlm(answer(tools=[tool_call("append_to_notes", {"paragraphs": ["x"]})]), answer(text="Die Notizen sind gesperrt."))
    run(Brain(llm, "m", api), CMD)
    assert "The notes are locked" in llm.requests[1]["messages"][-1]["content"]
    assert api.calls[-1] == ("assistant:reply", {"heard": CMD.heard, "text": "Die Notizen sind gesperrt."})


def test_stops_after_a_few_rounds_even_if_the_model_keeps_calling_tools():
    api = FakeApi()
    llm = FakeLlm(*[answer(tools=[tool_call("read_transcript", {"minutes": 1}, f"c{i}")]) for i in range(10)])
    run(Brain(llm, "m", api), CMD)
    assert len(llm.requests) == Brain.MAX_ROUNDS
    assert api.calls[-1][0] == "assistant:reply"


def test_the_transcript_forgets_what_is_older_than_an_hour():
    transcript = Transcript(keep_s=3600)
    transcript.add(at=0, speaker="A", text="alt")
    transcript.add(at=4000, speaker="B", text="neu")
    assert transcript.since(0) == ["B: neu"]


BOARD = {
    "board": [
        {"id": "wb-legacy-1700000000000-0-aaaa", "type": "shape", "shapeType": "rectangle", "x": 100, "y": 100, "width": 220, "height": 120, "text": "Design", "fill": "transparent", "color": "#18181b"},
        {"id": "wb-legacy-1700000000000-1-bbbb", "type": "shape", "shapeType": "rectangle", "x": 400, "y": 100, "width": 200, "height": 140, "text": "Launch", "fill": "#fbe7b0", "color": "transparent", "author": "assistant"},
        {"id": "line-1", "type": "line", "x": 320, "y": 160, "width": 80, "height": 0, "color": "#18181b", "from": "wb-legacy-1700000000000-0-aaaa", "to": "wb-legacy-1700000000000-1-bbbb", "arrow": True},
        {"id": "pen-1", "type": "stroke", "x": 0, "y": 300, "width": 50, "height": 40, "color": "#dc2626"},
    ],
    "notesHtml": '<h2>Agenda</h2><p>Begrüßung<br>und Runde</p><ul data-assistant="blk-1"><li><p>Zahlen schicken</p></li></ul><p>Von Lena danach</p>',
    "notesLocked": False,
}


def test_sees_board_and_notes_in_the_first_request_with_short_handles():
    llm = FakeLlm(answer(text="Zwei Kästen und ein Pfeil."))
    run(Brain(llm, "m", FakeApi(context=BOARD)), CMD)
    sent = json.dumps(llm.requests[0]["messages"], ensure_ascii=False)
    assert "e1" in sent and "„Design“" in sent and "„Launch“" in sent
    assert "e3" in sent and "e1 → e2" in sent
    assert "Agenda" in sent and "[n1, von dir] - Zahlen schicken" in sent
    # Human text after its block is not marked as its own.
    assert "\\nVon Lena danach" in sent
    # The model never sees the long ids.
    assert "wb-legacy" not in sent


def test_sees_notes_with_their_writer_sections_and_stamps():
    board = {"board": [
        {"id": "s", "type": "shape", "shapeType": "section", "x": 0, "y": 0, "width": 900, "height": 600, "text": "Ideen", "fill": "#f4f1ec"},
        {"id": "n", "type": "shape", "shapeType": "note", "x": 40, "y": 40, "width": 200, "height": 200, "text": "Kunden fragen", "fill": "#d4edd9", "by": "Sara"},
        {"id": "st", "type": "stamp", "x": 220, "y": 20, "width": 44, "height": 44, "stamp": "heart", "on": "n", "by": "Jonas"},
        {"id": "t", "type": "shape", "shapeType": "task", "x": 300, "y": 40, "width": 280, "height": 150, "text": "Zahlen schicken", "owner": "Jonas", "due": "2026-11-20", "done": True},
    ], "notesHtml": "", "notesLocked": False}
    llm = FakeLlm(answer(text="Ok."))
    run(Brain(llm, "m", FakeApi(context=board)), CMD)
    sent = json.dumps(llm.requests[0]["messages"], ensure_ascii=False)
    assert "e1 Bereich „Ideen“" in sent
    assert "e2 sticky „Kunden fragen“ green von Sara" in sent
    assert "e3 Stempel heart auf e2 von Jonas" in sent
    assert "e4 Aufgabe „Zahlen schicken“ für Jonas bis 2026-11-20 erledigt" in sent


def test_handles_become_real_ids_and_new_elements_get_handles():
    api = FakeApi(context=BOARD, results={"assistant:addToBoard": {"editId": "x", "count": 2, "ids": {"a": "new-a", "b": "new-b"}}})
    llm = FakeLlm(
        answer(tools=[tool_call("add_to_board", {
            "items": [{"key": "a", "kind": "sticky", "text": "Test"}, {"key": "b", "kind": "diamond", "text": "Go?"}],
            "links": [{"from": "e1", "to": "a"}, {"from": "a", "to": "b"}], "near": "e2", "side": "below",
        })]),
        answer(tools=[tool_call("change_on_board", {"changes": [{"ref": "e5", "color": "green"}, {"ref": "e1", "text": "Design v2"}]}, "c2")]),
        answer(text=""),
    )
    run(Brain(llm, "m", api), CMD)
    name, args = api.calls[0]
    assert name == "assistant:addToBoard"
    assert args["near"] == "wb-legacy-1700000000000-1-bbbb"
    assert args["links"] == [{"from": "wb-legacy-1700000000000-0-aaaa", "to": "a"}, {"from": "a", "to": "b"}]
    assert "a = e5" in llm.requests[1]["messages"][-1]["content"]
    assert api.calls[1] == ("assistant:changeOnBoard", {"heard": CMD.heard, "changes": [{"id": "new-a", "color": "green"}, {"id": "wb-legacy-1700000000000-0-aaaa", "text": "Design v2"}]})


def test_an_unknown_handle_goes_back_to_the_model_instead_of_to_the_room():
    api = FakeApi(context=BOARD)
    llm = FakeLlm(answer(tools=[tool_call("delete_from_board", {"refs": ["e9"]})]), answer(text="Das finde ich nicht."))
    run(Brain(llm, "m", api), CMD)
    assert "e9" in llm.requests[1]["messages"][-1]["content"]
    assert api.calls == [("assistant:reply", {"heard": CMD.heard, "text": "Das finde ich nicht."})]


def test_every_call_of_one_command_carries_the_same_command_id():
    api = FakeApi(context=BOARD)
    llm = FakeLlm(
        answer(tools=[tool_call("arrange_on_board", {"refs": ["e1", "e2"], "layout": "column"}), tool_call("show_on_board", {"mode": "fit"}, "c2")]),
        answer(text=""),
    )
    run(Brain(llm, "m", api), CMD)
    assert [c[0] for c in api.calls] == ["assistant:arrangeOnBoard", "assistant:showOnBoard"]
    assert api.calls[0][1]["ids"] == ["wb-legacy-1700000000000-0-aaaa", "wb-legacy-1700000000000-1-bbbb"]
    assert api.calls[1][1] == {"heard": CMD.heard, "mode": "fit"}
    assert len(set(api.command_ids)) == 1 and api.command_ids[0]


def test_tools_for_joining_deleting_zooming_and_the_notes():
    api = FakeApi(context=BOARD)
    llm = FakeLlm(
        answer(tools=[
            tool_call("connect", {"links": [{"from": "e2", "to": "e1"}]}),
            tool_call("delete_from_board", {"refs": ["e4"]}, "c2"),
            tool_call("show_on_board", {"refs": ["e1"], "mode": "zoom_in"}, "c3"),
            tool_call("remove_from_notes", {"refs": ["n1"]}, "c4"),
        ]),
        answer(text=""),
    )
    run(Brain(llm, "m", api), CMD)
    assert api.calls == [
        ("assistant:connectOnBoard", {"heard": CMD.heard, "links": [{"from": "wb-legacy-1700000000000-1-bbbb", "to": "wb-legacy-1700000000000-0-aaaa"}]}),
        ("assistant:deleteFromBoard", {"heard": CMD.heard, "ids": ["pen-1"]}),
        ("assistant:showOnBoard", {"heard": CMD.heard, "ids": ["wb-legacy-1700000000000-0-aaaa"], "mode": "in"}),
        ("assistant:removeFromNotes", {"heard": CMD.heard, "blockIds": ["blk-1"]}),
    ]


def test_an_overview_goes_on_the_board_as_a_spec_and_is_seen_by_its_title():
    board = {"board": [{"id": "h", "type": "html", "x": 0, "y": 0, "width": 640, "height": 480, "title": "Stand der Teams"}], "notesHtml": "", "notesLocked": False}
    api = FakeApi(context=board, results={"assistant:addViewToBoard": {"editId": "x", "id": "new-h"}})
    spec = {"root": "a", "elements": {"a": {"type": "Heading", "props": {"text": "Ziele"}, "children": []}}}
    llm = FakeLlm(answer(tools=[tool_call("add_overview", {"title": "Ziele", "spec": spec, "near": "e1", "side": "below"})]), answer(text=""))
    run(Brain(llm, "m", api), CMD)
    assert "e1 Übersicht „Stand der Teams“" in json.dumps(llm.requests[0]["messages"], ensure_ascii=False)
    assert api.calls == [("assistant:addViewToBoard", {"heard": CMD.heard, "title": "Ziele", "spec": spec, "near": "h", "side": "below"})]
    assert "e2" in llm.requests[1]["messages"][-1]["content"]


def test_spoken_ideas_hang_on_a_mind_map_branch_it_can_see():
    board = {"board": [
        {"id": "root", "type": "shape", "shapeType": "mindmap", "x": 0, "y": 0, "width": 120, "height": 40, "text": "Launch", "color": "#18181b"},
        {"id": "press", "type": "shape", "shapeType": "mindmap", "x": 176, "y": 0, "width": 120, "height": 40, "text": "Presse", "color": "#2563eb", "parent": "root"},
        {"id": "tbl", "type": "shape", "shapeType": "table", "x": 0, "y": 300, "width": 280, "height": 80, "cells": [["Wer", "Was"], ["Jonas", "Zahlen"]]},
    ], "notesHtml": "", "notesLocked": False}
    api = FakeApi(context=board, results={"assistant:addBranchesToBoard": {"editId": "x", "ids": ["blog"]}})
    llm = FakeLlm(answer(tools=[tool_call("add_branches", {"under": "e2", "branches": ["Blog", " "]})]), answer(text=""))
    run(Brain(llm, "m", api), CMD)
    sent = json.dumps(llm.requests[0]["messages"], ensure_ascii=False)
    assert "e2 Ast „Presse“ an e1" in sent
    assert "e3 Tabelle 2×2 „Wer | Was / Jonas | Zahlen“" in sent
    assert api.calls == [("assistant:addBranchesToBoard", {"heard": CMD.heard, "under": "press", "branches": ["Blog"]})]
    assert "e4" in llm.requests[1]["messages"][-1]["content"]


# ---- what it is told, what it remembers, and what it does when it should do nothing or cannot ----

def run_outcome(brain, command, transcript=None):
    return asyncio.run(brain.handle(command, transcript or Transcript()))


def user_message(llm, n=0):
    return llm.requests[n]["messages"][1]["content"]


def test_it_is_given_the_whole_sentence_with_the_name_and_the_language():
    llm = FakeLlm(answer(tools=[tool_call("ignore", {})]), answer(text=""))
    cmd = Command(speaker="Lena", heard="Schreib das bitte auf, Vivo.", command="Schreib das bitte auf", language="en", kind="end")
    run(Brain(llm, "m", FakeApi()), cmd)
    assert user_message(llm).endswith("Lena sagte (spricht Englisch): „Schreib das bitte auf, Vivo.“\n\nDer Name stand am Ende des Satzes.")


def test_what_was_said_in_the_minute_before_is_given_but_not_the_command_itself_or_older_talk():
    transcript = Transcript(started=0)
    transcript.add(at=100, speaker="Jonas", text="Viel zu alt")
    transcript.add(at=950, speaker="Jonas", text="Wir brauchen die Zahlen bis Freitag.")
    transcript.add(at=1000, speaker="Lena", text="Vivo, schreib das auf.")
    llm = FakeLlm(answer(tools=[tool_call("ignore", {})]), answer(text=""))
    cmd = Command(speaker="Lena", heard="Vivo, schreib das auf.", command="schreib das auf.", started_wall=1000)
    run(Brain(llm, "m", FakeApi(), clock=lambda: 1001), cmd, transcript)
    said = user_message(llm)
    assert "Jonas: Wir brauchen die Zahlen bis Freitag." in said
    assert "Viel zu alt" not in said
    assert said.count("schreib das auf") == 1  # only in the sentence itself


def test_doing_nothing_is_silent_and_not_remembered():
    api = FakeApi()
    llm = FakeLlm(answer(tools=[tool_call("ignore", {})]), answer(text="Ich habe nichts getan."))
    brain = Brain(llm, "m", api)
    outcome = run_outcome(brain, Command(speaker="Lena", heard="Gestern hat Vivo das gut gemacht.", command="das gut gemacht"))
    assert api.calls == []
    assert outcome.silent and not outcome.asked
    assert brain.history.recent(brain.clock()) == []


def test_ignoring_is_also_silent_when_the_model_answers_with_text_right_away():
    api = FakeApi()
    llm = FakeLlm(answer(tools=[tool_call("ignore", {})]), answer(text="Verstanden, nichts zu tun."))
    run_outcome(Brain(llm, "m", api), CMD)
    assert api.calls == []


def test_a_command_that_changed_something_is_not_undone_by_a_stray_ignore():
    api = FakeApi()
    llm = FakeLlm(answer(tools=[tool_call("add_to_board", {"items": [{"kind": "sticky", "text": "x"}]}), tool_call("ignore", {}, "c2")]), answer(text=""))
    outcome = run_outcome(Brain(llm, "m", api), CMD)
    assert api.calls[0][0] == "assistant:addToBoard"
    assert not outcome.silent


def test_it_remembers_what_it_did_and_says_it_next_time_without_handles():
    board = {"board": [{"id": "wb-long-id-1", "type": "shape", "shapeType": "rectangle", "x": 0, "y": 0, "width": 200, "height": 100, "text": "Design", "fill": "#fbe7b0", "author": "assistant"}], "notesHtml": "", "notesLocked": False}
    api = FakeApi(context=board)
    llm = FakeLlm(
        answer(tools=[tool_call("add_to_board", {"items": [{"kind": "sticky", "text": "Budget klären"}], "near": "e1"})]), answer(text=""),
        answer(tools=[tool_call("ignore", {})]), answer(text=""),
    )
    now = [1000.0]
    brain = Brain(llm, "m", api, clock=lambda: now[0])
    run(brain, Command(speaker="Lena", heard="Vivo, leg einen Zettel an: Budget klären", command="leg einen Zettel an: Budget klären"))
    now[0] = 1030.0
    run(brain, Command(speaker="Lena", heard="Vivo, und noch einen", command="und noch einen"))
    said = user_message(llm, 2)
    assert "Letzte Aufträge" in said
    assert "vor 30 s, Lena: „leg einen Zettel an: Budget klären“ → legte aufs Board: Budget klären" in said
    assert "e1" not in said


def test_old_commands_are_forgotten():
    brain = Brain(FakeLlm(), "m", FakeApi())
    brain.history.add(at=0, speaker="Lena", command="alt", outcome="x")
    brain.history.add(at=900, speaker="Lena", command="neu", outcome="y")
    assert [t.command for t in brain.history.recent(1000)] == ["neu"]
    for i in range(10):
        brain.history.add(at=999, speaker="Lena", command=f"c{i}", outcome="z")
    assert len(brain.history.recent(1000)) == 5


def test_a_question_back_opens_the_window_for_the_answer():
    api = FakeApi()
    llm = FakeLlm(answer(tools=[tool_call("reply", {"text": "Was soll ich aufschreiben?"})]), answer(text=""))
    outcome = run_outcome(Brain(llm, "m", api), CMD)
    assert outcome.asked
    assert api.calls[0][0] == "assistant:reply"


def test_a_plain_statement_does_not_open_the_window():
    llm = FakeLlm(answer(tools=[tool_call("reply", {"text": "Es ist Freitag."})]), answer(text=""))
    assert not run_outcome(Brain(llm, "m", FakeApi()), CMD).asked


def test_not_understanding_is_said_in_the_language_asked_in_and_opens_the_window():
    api = FakeApi()
    outcome = run_outcome(Brain(FakeLlm(answer(text="")), "m", api), Command(speaker="Lena", heard="Vivo, bla", command="bla", language="en"))
    assert api.calls == [("assistant:reply", {"heard": "Vivo, bla", "text": "I did not understand that. Please say again what I should do."})]
    assert outcome.asked


def test_when_the_model_cannot_be_reached_the_room_is_told_instead_of_left_waiting():
    class Broken:
        chat = SimpleNamespace(completions=SimpleNamespace(create=None))

    async def boom(**_):
        raise TimeoutError("gateway")

    llm = Broken()
    llm.chat.completions.create = boom
    api = FakeApi()
    outcome = run_outcome(Brain(llm, "m", api), Command(speaker="Lena", heard="Vivo, fass zusammen", command="fass zusammen", language="de"))
    assert api.calls == [("assistant:reply", {"heard": "Vivo, fass zusammen", "text": "Das hat gerade nicht geklappt. Sagen Sie es bitte noch einmal."})]
    assert outcome.asked


def test_a_failure_after_the_room_changed_does_not_add_a_second_message():
    calls = {"n": 0}

    async def flaky(**_):
        calls["n"] += 1
        if calls["n"] == 1:
            return answer(tools=[tool_call("add_to_board", {"items": [{"kind": "sticky", "text": "x"}]})])
        raise TimeoutError("gateway")

    llm = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=flaky)))
    api = FakeApi()
    run(Brain(llm, "m", api), CMD)
    assert [name for name, _ in api.calls] == ["assistant:addToBoard"]


def test_the_transcript_says_when_it_does_not_reach_back_as_far_as_asked():
    transcript = Transcript(started=940)
    transcript.add(at=960, speaker="Sara", text="Wir verschieben den Release")
    llm = FakeLlm(answer(tools=[tool_call("read_transcript", {"minutes": 10})]), answer(text="Das war nur wenig."))
    run(Brain(llm, "m", FakeApi(), clock=lambda: 1000), CMD, transcript)
    content = llm.requests[1]["messages"][-1]["content"]
    assert content.startswith("(Ich höre erst seit etwa 1 Minuten mit; davor kenne ich nichts.)")
    assert "Sara: Wir verschieben den Release" in content


def test_an_empty_stretch_is_not_reported_as_a_quiet_one_when_it_was_not_heard():
    transcript = Transcript(started=990)
    llm = FakeLlm(answer(tools=[tool_call("read_transcript", {"minutes": 10})]), answer(text="Noch nichts gehört."))
    run(Brain(llm, "m", FakeApi(), clock=lambda: 1000), CMD, transcript)
    content = llm.requests[1]["messages"][-1]["content"]
    assert "Ich höre erst seit" in content and "Seit ich dabei bin, wurde nichts gesagt." in content


def test_the_transcript_without_a_gap_has_no_note():
    transcript = Transcript(started=0)
    transcript.add(at=900, speaker="Sara", text="Hallo")
    llm = FakeLlm(answer(tools=[tool_call("read_transcript", {"minutes": 10})]), answer(text=""))
    run(Brain(llm, "m", FakeApi(), clock=lambda: 1000), CMD, transcript)
    assert llm.requests[1]["messages"][-1]["content"] == "Sara: Hallo"


def test_earlier_orders_to_the_assistant_are_not_given_as_what_was_said_before():
    transcript = Transcript(started=0)
    transcript.add(at=960, speaker="Jonas", text="Wir brauchen die Zahlen bis Freitag.")
    transcript.add(at=980, speaker="Lena", text="Vivo, schreib aufs Whiteboard: Release am dritten Dezember.")
    llm = FakeLlm(answer(tools=[tool_call("ignore", {})]), answer(text=""))
    cmd = Command(speaker="Lena", heard="Vivo, schreib das auf.", command="schreib das auf.", started_wall=1000)
    run(Brain(llm, "m", FakeApi(), clock=lambda: 1001), cmd, transcript)
    said = user_message(llm)
    assert "Jonas: Wir brauchen die Zahlen bis Freitag." in said
    assert "Release" not in said


def test_what_was_part_of_an_earlier_command_is_not_given_as_what_was_said_before():
    # The second half of "Vivo, schreib aufs Whiteboard ... Release am Montag" has no name in it, but belongs to the command.
    transcript = Transcript(started=0)
    transcript.add(at=960, speaker="Jonas", text="Wir brauchen die Zahlen bis Freitag.")
    transcript.add(at=970, speaker="Lena", text="Vivo, schreib aufs Whiteboard.")
    transcript.add(at=972, speaker="Lena", text="Release am Montag.")
    llm = FakeLlm(
        answer(tools=[tool_call("add_to_board", {"items": [{"kind": "sticky", "text": "Release am Montag"}]})]), answer(text=""),
        answer(tools=[tool_call("ignore", {})]), answer(text=""),
    )
    brain = Brain(llm, "m", FakeApi(), clock=lambda: 975)
    run(brain, Command(speaker="Lena", heard="Vivo, schreib aufs Whiteboard. Release am Montag.", command="schreib aufs Whiteboard. Release am Montag.", started_wall=970, ended_wall=972), transcript)
    transcript.add(at=990, speaker="Lena", text="Vivo, schreib das auf.")
    run(brain, Command(speaker="Lena", heard="Vivo, schreib das auf.", command="schreib das auf.", started_wall=990, ended_wall=990), transcript)
    said = user_message(llm, 2)
    assert "Jonas: Wir brauchen die Zahlen bis Freitag." in said
    heard_before = said.split("Letzte Aufträge")[0]   # the part about what was said, before the part about what it did
    assert "Release" not in heard_before and "schreib aufs Whiteboard" not in heard_before
    assert "Letzte Aufträge" in said and "legte aufs Board: Release am Montag" in said


def test_a_line_break_someone_typed_does_not_lose_its_block():
    from tavio_assistant.brain import Room

    room = Room({"board": [], "notesHtml": '<p data-assistant="blk-1">Erste Zeile<br />Zweite Zeile</p><p>Danach</p>'})
    assert list(room.blocks.values()) == ["blk-1"]
