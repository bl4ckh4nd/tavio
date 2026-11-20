import { httpAction } from "./_generated/server"
import { internal } from "./_generated/api"
import { sniffImageType } from "./lib/chatMedia"

// The room access token travels as a bearer header, never as a cookie, so any origin may call this.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
}

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } })

export const chatUploadPreflight = httpAction(async () => new Response(null, { status: 204, headers: CORS_HEADERS }))

/**
 * POST /chat/upload?roomId=<id> with `Authorization: Bearer <room access token>` and the image as the body.
 * Stores the image bound to room and uploader; chat.send then takes the returned uploadId.
 * With `&for=board` the image is pasted onto a whiteboard and the answer carries its URL. It stays only once
 * a board of the room is saved with it (whiteboard.save); until then it is cleaned up like an unsent chat image.
 */
export const chatUpload = httpAction(async (ctx, request) => {
  const params = new URL(request.url).searchParams
  const roomId = params.get("roomId")
  const forBoard = params.get("for") === "board"
  const accessToken = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "")
  if (!roomId || !accessToken) return reply(400, { error: "Missing room or access token" })

  const blob = await request.blob()
  if (blob.size === 0) return reply(400, { error: "Empty upload" })
  // The first bytes decide the type; the claimed Content-Type and file name do not count.
  const contentType = sniffImageType(new Uint8Array(await blob.slice(0, 16).arrayBuffer()))
  if (!contentType) return reply(415, { error: "Only PNG, JPEG, GIF and WebP images can be shared" })

  let uploaderId: string
  try {
    ;({ uploaderId } = await ctx.runMutation(internal.chat.prepareUpload, { roomId, accessToken, size: blob.size }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/too large/i.test(message)) return reply(413, { error: message.match(/Image too large[^"\n]*/)?.[0] ?? "Image too large" })
    if (/RateLimited/i.test(message)) return reply(429, { error: "Too many images for now. Try again later." })
    return reply(403, { error: "Join this room to share images" })
  }

  const storageId = await ctx.storage.store(new Blob([blob], { type: contentType }))
  const uploadId = await ctx.runMutation(internal.chat.recordUpload, {
    roomId,
    uploaderId,
    storageId,
    contentType,
    size: blob.size,
  })
  if (forBoard) return reply(200, { uploadId, url: await ctx.storage.getUrl(storageId) })
  return reply(200, { uploadId })
})
