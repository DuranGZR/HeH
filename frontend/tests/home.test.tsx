import { render, screen } from "@testing-library/react-native";

import HomeScreen from "../app/index";

describe("HomeScreen", () => {
  it("renders the heh. wordmark and tagline", async () => {
    await render(<HomeScreen />);

    expect(screen.getByTestId("home-screen")).toBeTruthy();
    expect(screen.getByText("heh.")).toBeTruthy();
    expect(screen.getByText("Söyle, aradığını hemen bul.")).toBeTruthy();
  });

  it("blocks unmocked outbound fetch requests by default", async () => {
    await expect(globalThis.fetch("https://example.com")).rejects.toThrow(
      "Unmocked network fetch is forbidden in unit tests",
    );
  });
});
