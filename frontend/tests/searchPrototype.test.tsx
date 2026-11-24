import { fireEvent, render, screen } from "@testing-library/react-native";

import HomeScreen from "../app/index";
import { TextSearchComposer } from "../src/features/search/components/TextSearchComposer";
import { MAX_SEARCH_QUERY_LENGTH, canSubmitSearchQuery } from "../src/features/search/types";
import { HehThemeProvider } from "../src/theme";

describe("D07 Home, Text Composer & Overflow Prototype", () => {
  it("validates blank and over-limit queries consistently with backend", () => {
    expect(canSubmitSearchQuery("")).toBe(false);
    expect(canSubmitSearchQuery("   \n\t  ")).toBe(false);
    expect(canSubmitSearchQuery("3000 altı siyah mont")).toBe(true);
    expect(canSubmitSearchQuery("a".repeat(MAX_SEARCH_QUERY_LENGTH))).toBe(true);
    expect(canSubmitSearchQuery("a".repeat(MAX_SEARCH_QUERY_LENGTH + 1))).toBe(false);
  });

  it("switches to inline text composer on home and keeps submit disabled on whitespace", async () => {
    await render(
      <HehThemeProvider initialMode="light" initialReduceMotion>
        <HomeScreen />
      </HehThemeProvider>,
    );

    expect(screen.getByTestId("home-voice-button")).toBeTruthy();
    expect(screen.queryByTestId("text-search-composer")).toBeNull();

    await fireEvent.press(screen.getByTestId("home-text-button"));

    expect(screen.getByTestId("text-search-composer")).toBeTruthy();
    const submitBtn = screen.getByTestId("text-search-submit");
    expect(submitBtn.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));

    await fireEvent.changeText(screen.getByTestId("text-search-input"), "   ");
    expect(screen.getByTestId("text-search-submit").props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );

    await fireEvent.changeText(screen.getByTestId("text-search-input"), "2000 üstü nike ayakkabı");
    expect(screen.getByTestId("text-search-submit").props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: false }),
    );

    await fireEvent.press(screen.getByTestId("text-search-clear"));
    expect(screen.getByTestId("text-search-input").props.value).toBe("");
  });

  it("opens and closes top-right MoreSheet menu with theme switcher and accessible items", async () => {
    await render(
      <HehThemeProvider initialMode="light" initialReduceMotion>
        <HomeScreen />
      </HehThemeProvider>,
    );

    expect(screen.queryByTestId("more-menu-sheet")).toBeNull();
    await fireEvent.press(screen.getByTestId("home-more-button"));

    expect(screen.getByTestId("more-menu-sheet")).toBeTruthy();
    expect(screen.getByTestId("more-item-history")).toBeTruthy();
    expect(screen.getByTestId("more-item-privacy")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("more-item-privacy"));
    expect(screen.getByTestId("more-menu-notice")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("theme-option-dark"));
    expect(screen.getByTestId("theme-option-dark").props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );

    await fireEvent.press(screen.getByTestId("more-menu-close"));
    expect(screen.queryByTestId("more-menu-sheet")).toBeNull();
  });

  it("renders inline error banner transparently inside TextSearchComposer", async () => {
    const onSubmit = jest.fn();
    await render(
      <HehThemeProvider initialMode="dark" initialReduceMotion>
        <TextSearchComposer
          errorMessage="Bağlantı yok. Tekrar dene."
          onChangeQuery={jest.fn()}
          onSubmit={onSubmit}
          query="kulaklık"
        />
      </HehThemeProvider>,
    );

    expect(screen.getByTestId("text-search-error")).toBeTruthy();
    expect(screen.getByText("Bağlantı yok. Tekrar dene.")).toBeTruthy();
  });
});
