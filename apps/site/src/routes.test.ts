import { describe, expect, it } from "vitest";
import { respond } from "./routes.ts";

const installers = { provision: "generic", rida: "profile" };
const get = (path: string, method = "GET") => respond(installers, new Request(`https://provision.example${path}`, { method }));

describe("installer routes", () => {
  it("serves the generic installer at the root", async () => {
    const response = get("/");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("generic");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("serves a profile's installer at its name", async () => {
    expect(await get("/rida").text()).toBe("profile");
    expect(await get("/rida/").text()).toBe("profile");
  });

  it("answers 404 for anything else", () => {
    expect(get("/nobody").status).toBe(404);
    expect(get("/rida/extra").status).toBe(404);
  });

  it("refuses writes", () => {
    expect(get("/", "POST").status).toBe(405);
  });
});
