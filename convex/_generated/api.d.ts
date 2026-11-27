/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as analytics from "../analytics.js";
import type * as apiKeys from "../apiKeys.js";
import type * as assistant from "../assistant.js";
import type * as assistantDispatch from "../assistantDispatch.js";
import type * as auth from "../auth.js";
import type * as authMaintenance from "../authMaintenance.js";
import type * as billing from "../billing.js";
import type * as billingActions from "../billingActions.js";
import type * as billingHttp from "../billingHttp.js";
import type * as boards from "../boards.js";
import type * as breakoutActions from "../breakoutActions.js";
import type * as breakouts from "../breakouts.js";
import type * as chat from "../chat.js";
import type * as chatHttp from "../chatHttp.js";
import type * as comments from "../comments.js";
import type * as crons from "../crons.js";
import type * as deviceHandoffs from "../deviceHandoffs.js";
import type * as deviceHandoffsDb from "../deviceHandoffsDb.js";
import type * as e2e from "../e2e.js";
import type * as http from "../http.js";
import type * as lib_assistantEdits from "../lib/assistantEdits.js";
import type * as lib_boardLayout from "../lib/boardLayout.js";
import type * as lib_breakoutCredentials from "../lib/breakoutCredentials.js";
import type * as lib_breakouts from "../lib/breakouts.js";
import type * as lib_chatMedia from "../lib/chatMedia.js";
import type * as lib_envValidation from "../lib/envValidation.js";
import type * as lib_logoDiscovery from "../lib/logoDiscovery.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_refusal from "../lib/refusal.js";
import type * as lib_roomAccess from "../lib/roomAccess.js";
import type * as lib_roomIdentity from "../lib/roomIdentity.js";
import type * as lib_sanitization from "../lib/sanitization.js";
import type * as lib_sessions from "../lib/sessions.js";
import type * as lib_validation from "../lib/validation.js";
import type * as livekit from "../livekit.js";
import type * as meetingActions from "../meetingActions.js";
import type * as meetingDoc from "../meetingDoc.js";
import type * as memberships from "../memberships.js";
import type * as orgMembers from "../orgMembers.js";
import type * as organizations from "../organizations.js";
import type * as presence from "../presence.js";
import type * as recordingActions from "../recordingActions.js";
import type * as recordingHttp from "../recordingHttp.js";
import type * as recordings from "../recordings.js";
import type * as restApi from "../restApi.js";
import type * as roomBrandingActions from "../roomBrandingActions.js";
import type * as roomSessions from "../roomSessions.js";
import type * as rooms from "../rooms.js";
import type * as timer from "../timer.js";
import type * as uploads from "../uploads.js";
import type * as users from "../users.js";
import type * as voting from "../voting.js";
import type * as whiteboard from "../whiteboard.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  analytics: typeof analytics;
  apiKeys: typeof apiKeys;
  assistant: typeof assistant;
  assistantDispatch: typeof assistantDispatch;
  auth: typeof auth;
  authMaintenance: typeof authMaintenance;
  billing: typeof billing;
  billingActions: typeof billingActions;
  billingHttp: typeof billingHttp;
  boards: typeof boards;
  breakoutActions: typeof breakoutActions;
  breakouts: typeof breakouts;
  chat: typeof chat;
  chatHttp: typeof chatHttp;
  comments: typeof comments;
  crons: typeof crons;
  deviceHandoffs: typeof deviceHandoffs;
  deviceHandoffsDb: typeof deviceHandoffsDb;
  e2e: typeof e2e;
  http: typeof http;
  "lib/assistantEdits": typeof lib_assistantEdits;
  "lib/boardLayout": typeof lib_boardLayout;
  "lib/breakoutCredentials": typeof lib_breakoutCredentials;
  "lib/breakouts": typeof lib_breakouts;
  "lib/chatMedia": typeof lib_chatMedia;
  "lib/envValidation": typeof lib_envValidation;
  "lib/logoDiscovery": typeof lib_logoDiscovery;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/refusal": typeof lib_refusal;
  "lib/roomAccess": typeof lib_roomAccess;
  "lib/roomIdentity": typeof lib_roomIdentity;
  "lib/sanitization": typeof lib_sanitization;
  "lib/sessions": typeof lib_sessions;
  "lib/validation": typeof lib_validation;
  livekit: typeof livekit;
  meetingActions: typeof meetingActions;
  meetingDoc: typeof meetingDoc;
  memberships: typeof memberships;
  orgMembers: typeof orgMembers;
  organizations: typeof organizations;
  presence: typeof presence;
  recordingActions: typeof recordingActions;
  recordingHttp: typeof recordingHttp;
  recordings: typeof recordings;
  restApi: typeof restApi;
  roomBrandingActions: typeof roomBrandingActions;
  roomSessions: typeof roomSessions;
  rooms: typeof rooms;
  timer: typeof timer;
  uploads: typeof uploads;
  users: typeof users;
  voting: typeof voting;
  whiteboard: typeof whiteboard;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
};
