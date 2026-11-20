import { cronJobs } from "convex/server"
import { internal } from "./_generated/api"

const crons = cronJobs()

// Chat images that were uploaded but never sent.
crons.hourly("delete unsent chat uploads", { minuteUTC: 17 }, internal.chat.cleanupOrphanUploads, {})

// A session ends once its room stayed empty for ten minutes; nobody is there to end it by hand.
crons.interval("close idle room sessions", { minutes: 5 }, internal.roomSessions.closeIdle, {})

// What the assistant heard is kept only while its change can still be undone.
crons.hourly("delete old assistant edits", { minuteUTC: 41 }, internal.assistant.deleteOldEdits, {})

export default crons
