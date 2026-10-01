import { describe, expect, it } from "vitest";
import { unwrapPlayUrl } from "@/lib/proxyTarget";

describe("catalogue targets for the standard proxy", () => {
  it.each([
    ["/iframe.html?url=/!!/https://games.example/game/index.html", "https://games.example/game/index.html"],
    ["/f/g/hs/games.example/play/?level=2#menu", "https://games.example/play/?level=2#menu"],
    ["/n/m/ht/games.example/index.html", "http://games.example/index.html"],
  ])("recovers the original publisher URL from %s", (input, expected) => {
    expect(unwrapPlayUrl(input)).toBe(expected);
  });

  it("keeps native games local while completing their index path", () => {
    expect(unwrapPlayUrl("/iframe.html?url=/storage/ag/originals/tag/"))
      .toBe("/storage/ag/originals/tag/index.html");
  });

  it("leaves an ordinary remote URL intact", () => {
    expect(unwrapPlayUrl("https://www.crazygames.com/game/basket-random"))
      .toBe("https://www.crazygames.com/game/basket-random");
  });
});
