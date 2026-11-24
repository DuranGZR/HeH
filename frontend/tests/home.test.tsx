import { render, screen } from "@testing-library/react-native";
import * as ReactNative from "react-native";
import { StyleSheet } from "react-native";

import HomeScreen from "../app/index";
import { DARK_PALETTE, HehThemeProvider, LIGHT_PALETTE } from "../src/theme";

describe("HomeScreen", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders the heh. wordmark and tagline in light theme baseline", async () => {
    await render(
      <HehThemeProvider initialMode="light" initialReduceMotion={false}>
        <HomeScreen />
      </HehThemeProvider>,
    );

    const container = screen.getByTestId("home-screen");
    expect(StyleSheet.flatten(container.props.style).backgroundColor).toBe(
      LIGHT_PALETTE.background,
    );
    expect(screen.getByText("heh.")).toBeTruthy();
    expect(screen.getByText("Söyle, aradığını hemen bul.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sesli ara" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Yazarak ara" })).toBeTruthy();
  });

  it("renders monochrome dark tokens with accessible CTA sizing", async () => {
    await render(
      <HehThemeProvider initialMode="dark" initialReduceMotion>
        <HomeScreen />
      </HehThemeProvider>,
    );

    const container = screen.getByTestId("home-screen");
    expect(StyleSheet.flatten(container.props.style).backgroundColor).toBe(DARK_PALETTE.background);

    const voiceButton = screen.getByTestId("home-voice-button");
    const voiceStyle = StyleSheet.flatten(voiceButton.props.style);
    expect(voiceStyle.backgroundColor).toBe(DARK_PALETTE.ctaBackground);
    expect(voiceStyle.minHeight).toBe(48);
  });

  it("applies 20dp horizontal edge padding on compact 320x568 phone screens", async () => {
    jest.spyOn(ReactNative.Dimensions, "get").mockReturnValue({
      width: 320,
      height: 568,
      scale: 2,
      fontScale: 1,
    });

    await render(
      <HehThemeProvider initialMode="light" initialReduceMotion={false}>
        <HomeScreen />
      </HehThemeProvider>,
    );

    const frame = screen.getByTestId("home-frame");
    expect(StyleSheet.flatten(frame.props.style).paddingHorizontal).toBe(20);
  });

  it("blocks unmocked outbound fetch requests by default", async () => {
    await expect(globalThis.fetch("https://example.com")).rejects.toThrow(
      "Unmocked network fetch is forbidden in unit tests",
    );
  });
});
