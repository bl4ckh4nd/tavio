# Contributing to Tavio

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Before you start

- For a bug, open an issue with steps to reproduce.
- For a larger change or a new feature, open an issue first so we can agree on the approach before you spend time on it.
- Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Setting up

Follow the quick start in the [README](README.md). You need Node.js 24 and pnpm. For end-to-end tests against a local Convex and LiveKit stack, see [docs/E2E.md](docs/E2E.md).

## Making a change

- Keep a pull request to one topic and keep the diff small.
- Read [docs/DESIGN.md](docs/DESIGN.md) before changing anything visual. Use the tokens and shared components instead of new colours or one-off styles.
- New user-facing text goes through Lingui (`t` or `<Trans>`). Run `pnpm i18n` and translate the new strings in `src/locales/de`, `src/locales/es` and `src/locales/fr` if you can; otherwise say so in the pull request.
- Convex functions check access on the server. A new query or mutation that touches room data must go through the same access checks as its neighbours.
- Add a test for behaviour you change. Logic and Convex functions are tested with Vitest; behaviour only a browser shows belongs in Playwright.

Before you open the pull request:

```bash
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

If you changed the meeting assistant, also run `cd agent && .venv/bin/python -m pytest`. Its quality is measured with the evals in `agent/evals/` (real speech through Deepgram, the real model on spoken commands, a running worker against a LiveKit dev server; usage at the head of each file). Run them after changing `wake.py`, `speech.py` or the prompt in `brain.py`.

## Commits and pull requests

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org), e.g. `fix(lobby): keep the chosen microphone after a reload`.
- Describe the problem, what you changed, and how you tested it. For UI changes, add before and after screenshots.
- Add a line to the `Unreleased` section of [CHANGELOG.md](CHANGELOG.md) if users will notice the change.

## License

By contributing, you agree that your contribution is licensed under the [FSL-1.1-ALv2](LICENSE), like the rest of the project.
