import app from "./standings-worker.js";

function applyPublicReadCors(request, response) {
  const requestedMethod = String(request.headers.get("access-control-request-method") || "").toUpperCase();
  const publicRead = request.method === "GET" || (request.method === "OPTIONS" && requestedMethod === "GET");
  if (!publicRead) return response;

  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("x-localbleachers-api-cors", "public-get-v1");
  headers.delete("vary");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request, env, ctx) {
    const response = await app.fetch(request, env, ctx);
    return applyPublicReadCors(request, response);
  },
  async scheduled(controller, env, ctx) {
    return app.scheduled(controller, env, ctx);
  }
};
