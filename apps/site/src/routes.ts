export type Installers = Readonly<Record<string, string>>;

const securityHeaders = {
  "content-type": "text/x-shellscript; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export const respond = (installers: Installers, request: Request) => {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed\n", { status: 405 });
  const name = new URL(request.url).pathname.replace(/^\/+|\/+$/g, "");
  const installer = installers[name === "" ? "provision" : name];
  if (installer === undefined) return new Response("not found\n", { status: 404 });
  return new Response(request.method === "HEAD" ? null : installer, { headers: securityHeaders });
};
