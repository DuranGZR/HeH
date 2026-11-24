import {
  buildWidgetSearchUri,
  normalizeSearchModeParam,
  parseWidgetDeepLink,
} from "../src/services/widgets/deepLink";

describe("widget deep-link contract", () => {
  it("builds valid voice and text search URIs", () => {
    expect(buildWidgetSearchUri("voice")).toBe("heh://search?mode=voice");
    expect(buildWidgetSearchUri("text")).toBe("heh://search?mode=text");
  });

  it("parses valid voice and text widget deep links", () => {
    expect(parseWidgetDeepLink("heh://search?mode=voice")).toEqual({
      destination: "search",
      mode: "voice",
      requiresPermissionCheck: true,
    });

    expect(parseWidgetDeepLink("heh:///search?mode=text")).toEqual({
      destination: "search",
      mode: "text",
      requiresPermissionCheck: false,
    });
  });

  it("safely rejects invalid schemes, unknown routes, and bad modes", () => {
    expect(parseWidgetDeepLink("")).toEqual({ destination: "home", reason: "empty" });
    expect(parseWidgetDeepLink(null)).toEqual({ destination: "home", reason: "empty" });
    expect(parseWidgetDeepLink("https://evil.example.com/search?mode=voice")).toEqual({
      destination: "home",
      reason: "invalid_scheme",
    });
    expect(parseWidgetDeepLink("heh://settings?mode=voice")).toEqual({
      destination: "home",
      reason: "unknown_route",
    });
    expect(parseWidgetDeepLink("heh://search?mode=record_hidden")).toEqual({
      destination: "home",
      reason: "invalid_mode",
    });
  });

  it("normalizes router mode query parameters safely", () => {
    expect(normalizeSearchModeParam("voice")).toBe("voice");
    expect(normalizeSearchModeParam(["voice", "text"])).toBe("voice");
    expect(normalizeSearchModeParam("text")).toBe("text");
    expect(normalizeSearchModeParam(undefined)).toBe("text");
    expect(normalizeSearchModeParam("unexpected")).toBe("text");
  });
});
