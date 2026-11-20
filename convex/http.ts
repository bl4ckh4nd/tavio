import { httpRouter, ROUTABLE_HTTP_METHODS } from "convex/server";
import { authComponent, createAuth } from "./auth";
import { stripeWebhook } from "./billingHttp";
import { livekitEgressWebhook } from "./recordingHttp";
import { chatUpload, chatUploadPreflight } from "./chatHttp";
import { restApi } from "./restApi";

const http = httpRouter();

// CORS: use cors:true so registerRoutes delegates origin checks to
// betterAuth({ trustedOrigins }) in auth.ts — which includes the production
// SITE_URL plus localhost:3333/5173 for non-production (E2E / local dev).
authComponent.registerRoutes(http, createAuth, { cors: true });
http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: stripeWebhook,
});
http.route({
  path: "/livekit/egress",
  method: "POST",
  handler: livekitEgressWebhook,
});
http.route({
  path: "/chat/upload",
  method: "POST",
  handler: chatUpload,
});
http.route({
  path: "/chat/upload",
  method: "OPTIONS",
  handler: chatUploadPreflight,
});

// REST API for servers with a workspace API key. No CORS: keys must not reach a browser.
for (const method of ROUTABLE_HTTP_METHODS) {
  http.route({ pathPrefix: "/v1/", method, handler: restApi });
}

export default http;
