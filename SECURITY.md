# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately through GitHub: on the repository's **Security** tab, choose **Report a vulnerability**.

Include what is affected, how to reproduce it, and what an attacker could do with it. You will get an answer within a week. Once a fix is released, the advisory is published, with credit to you if you want it.

## Supported versions

Only the latest release gets security fixes.

## Scope

In scope: this repository's web app, Convex functions, HTTP endpoints and the meeting assistant worker in `agent/`.

Out of scope: problems in LiveKit, Convex, Better Auth or other dependencies themselves (report those upstream), and deployments that do not follow the documented setup, such as the Docker trial with its sample secrets exposed to the internet.
