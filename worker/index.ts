type AssetFetcher = {
  fetch: (request: Request) => Promise<Response>;
};

type Env = {
  ASSETS: AssetFetcher;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Camera and microphone only work on a secure origin.
    const url = new URL(request.url);
    if (url.protocol === 'http:') {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};
