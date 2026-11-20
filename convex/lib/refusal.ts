import { ConvexError } from "convex/values"

/** Why a request was turned down. The REST API maps the code to a status; people read the message. */
export type RefusalCode = "invalid_request" | "conflict" | "plan_limit" | "not_found" | "unauthorized"

export const refuse = (code: RefusalCode, message: string) => new ConvexError({ code, message })
