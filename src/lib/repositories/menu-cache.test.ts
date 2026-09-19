import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getMenu = vi.fn();
vi.mock("./menu", () => ({ getMenu: (channel: string | null) => getMenu(channel) }));

import { clearMenuCache, getAllProductsCached, getMenuCached, getProductCached, MENU_CACHE_TTL_MS } from "./menu-cache";

const menu = [{ slug: "burgers", name: "Burgers", products: [{ slug: "og", name: "OG" }] }];

beforeEach(() => {
  clearMenuCache();
  getMenu.mockReset();
  getMenu.mockResolvedValue(menu);
});

describe("getMenuCached", () => {
  it("reads the database once inside the window", async () => {
    await getMenuCached("ONLINE", 1_000);
    await getMenuCached("ONLINE", 1_000 + MENU_CACHE_TTL_MS - 1);
    expect(getMenu).toHaveBeenCalledTimes(1);
  });

  it("reads again once the window has passed (30-60 s)", async () => {
    await getMenuCached("ONLINE", 1_000);
    await getMenuCached("ONLINE", 1_000 + MENU_CACHE_TTL_MS);
    expect(getMenu).toHaveBeenCalledTimes(2);
    expect(MENU_CACHE_TTL_MS).toBeGreaterThanOrEqual(30_000);
    expect(MENU_CACHE_TTL_MS).toBeLessThanOrEqual(60_000);
  });

  it("keeps channels apart", async () => {
    await getMenuCached("ONLINE", 1);
    await getMenuCached(null, 1);
    expect(getMenu).toHaveBeenCalledTimes(2);
  });

  it("is cleared by a menu edit", async () => {
    await getMenuCached("ONLINE", 1);
    clearMenuCache();
    await getMenuCached("ONLINE", 2);
    expect(getMenu).toHaveBeenCalledTimes(2);
  });

  it("does not keep a failed read", async () => {
    getMenu.mockRejectedValueOnce(new Error("db down"));
    await expect(getMenuCached("ONLINE", 1)).rejects.toThrow("db down");
    await Promise.resolve();
    await expect(getMenuCached("ONLINE", 2)).resolves.toEqual(menu);
  });

  it("finds a product and flattens from the same copy", async () => {
    expect((await getProductCached("og", "ONLINE"))?.name).toBe("OG");
    expect(await getProductCached("nope", "ONLINE")).toBeNull();
    expect(await getAllProductsCached("ONLINE")).toHaveLength(1);
    expect(getMenu).toHaveBeenCalledTimes(1);
  });
});
