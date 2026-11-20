"""The room's backend, reached over Convex's HTTP API with the grant the dispatch handed over."""

from __future__ import annotations

import httpx


class ConvexError(Exception):
    """The backend refused: no grant, locked notes, too many changes at once."""


class ConvexApi:
    def __init__(self, url: str, room_id: str, access_token: str, client: httpx.AsyncClient | None = None):
        self._url = url.rstrip("/")
        # Room and grant come from the dispatch, never from a model's tool arguments.
        self._scope = {"roomId": room_id, "accessToken": access_token}
        self._client = client or httpx.AsyncClient(timeout=10)

    async def mutation(self, name: str, args: dict):
        return await self._call("mutation", name, args)

    async def query(self, name: str, args: dict):
        return await self._call("query", name, args)

    async def _call(self, kind: str, name: str, args: dict):
        response = await self._client.post(
            f"{self._url}/api/{kind}",
            json={"path": name, "args": {**args, **self._scope}, "format": "json"},
        )
        body = response.json()
        if response.status_code != 200 or body.get("status") != "success":
            raise ConvexError(str(body.get("errorData") or body.get("errorMessage") or response.status_code))
        return body.get("value")

    async def aclose(self) -> None:
        await self._client.aclose()
