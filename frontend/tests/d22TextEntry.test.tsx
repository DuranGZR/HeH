import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import React, { useState } from "react";
import { StyleSheet } from "react-native";

import SearchEntryScreen from "../app/search";
import { createHehQueryClient } from "../src/api";
import { MockSearchTransport } from "../src/features/search/demoFixtures";
import { TextEntry } from "../src/features/search/components/TextEntry";
import {
  EXAMPLE_SEARCH_PROMPTS,
  MAX_SEARCH_QUERY_LENGTH,
  validateSearchQuery,
} from "../src/features/search/types";
import { HehThemeProvider } from "../src/theme";

const mockReplace = jest.fn();
let mockParams: Record<string, string> = { mode: "text" };

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));

function ControlledTextEntryHarness({
  initialQuery = "",
  errorMessage = null,
  onSubmit = jest.fn(),
}: {
  readonly initialQuery?: string;
  readonly errorMessage?: string | null;
  readonly onSubmit?: (val: string) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  return (
    <HehThemeProvider initialMode="light" initialReduceMotion>
      <TextEntry
        errorMessage={errorMessage}
        onChangeQuery={setQuery}
        onSubmit={() => onSubmit(query)}
        query={query}
      />
    </HehThemeProvider>
  );
}

describe("D22 TextEntry Prompts, Keyboard Accessibility, Validation & Offline Text Preservation", () => {
  const createdClients: ReturnType<typeof createHehQueryClient>[] = [];

  beforeEach(() => {
    mockReplace.mockReset();
    mockParams = { mode: "text" };
  });

  afterEach(() => {
    for (const qc of createdClients) {
      qc.clear();
    }
    createdClients.length = 0;
    jest.restoreAllMocks();
  });

  it("validates blank, control-character, and >500-char inputs consistently", () => {
    expect(validateSearchQuery("")).toMatchObject({ valid: false, reason: "empty" });
    expect(validateSearchQuery("   \n\t ")).toMatchObject({ valid: false, reason: "empty" });
    expect(validateSearchQuery("mont\x07")).toMatchObject({
      valid: false,
      reason: "control_chars",
    });
    expect(validateSearchQuery("a".repeat(MAX_SEARCH_QUERY_LENGTH + 1))).toMatchObject({
      valid: false,
      reason: "too_long",
    });
    expect(validateSearchQuery("3000 altı siyah mont")).toMatchObject({
      valid: true,
      reason: null,
      errorMessage: null,
    });
  });

  it("fills composer from starter prompt chip, manages input focus, and exposes 48dp hit targets", async () => {
    const submitSpy = jest.fn();
    await render(<ControlledTextEntryHarness onSubmit={submitSpy} />);

    expect(screen.getByTestId("text-search-prompts")).toBeTruthy();
    const firstPrompt = screen.getByTestId("text-prompt-chip-0");
    expect(StyleSheet.flatten(firstPrompt.props.style).minHeight).toBe(48);
    expect(firstPrompt.props.accessibilityRole).toBe("button");
    expect(firstPrompt.props.accessibilityLabel).toBe(EXAMPLE_SEARCH_PROMPTS[0]);

    await fireEvent.press(firstPrompt);

    expect(screen.getByTestId("text-search-input").props.value).toBe(EXAMPLE_SEARCH_PROMPTS[0]);
    expect(screen.queryByTestId("text-search-prompts")).toBeNull();
    // Prompt selection fills query for editing rather than auto-submitting unexpectedly.
    expect(submitSpy).not.toHaveBeenCalled();

    const submitButton = screen.getByTestId("text-search-submit");
    expect(StyleSheet.flatten(submitButton.props.style).minHeight).toBe(48);
    await fireEvent.press(submitButton);
    expect(submitSpy).toHaveBeenCalledWith(EXAMPLE_SEARCH_PROMPTS[0]);
  });

  it("announces blank keyboard submission, tracks focus ring, clears cleanly, and shows 420+ counter", async () => {
    const submitSpy = jest.fn();
    await render(<ControlledTextEntryHarness initialQuery="   " onSubmit={submitSpy} />);

    const input = screen.getByTestId("text-search-input");
    expect(input.props.accessibilityLabel).toBe("Arama metni");
    expect(input.props.accessibilityHint).toContain("Türkçe");

    await fireEvent(input, "focus");
    expect(
      StyleSheet.flatten(screen.getByTestId("text-search-input-card").props.style).borderWidth,
    ).toBe(2);

    // Submitting blank via keyboard Enter reveals accessible inline guidance without calling submit.
    await fireEvent(input, "submitEditing");
    expect(submitSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-search-error")).toBeTruthy();
    expect(screen.getByText("Aramak için en az bir ürün veya ölçüt yaz.")).toBeTruthy();

    // Entering valid query automatically clears blank warning.
    await fireEvent.changeText(input, "siyah mont");
    expect(screen.queryByTestId("text-search-error")).toBeNull();

    // Approaching 500 chars shows accessible character counter.
    await fireEvent.changeText(input, "a".repeat(425));
    expect(screen.getByTestId("text-search-char-count").props.children).toBe("425/500");

    await fireEvent.press(screen.getByTestId("text-search-clear"));
    expect(screen.getByTestId("text-search-input").props.value).toBe("");
    expect(screen.queryByTestId("text-search-char-count")).toBeNull();
  });

  it("preserves user text offline on SearchEntryScreen and recovers cleanly on retry or edit", async () => {
    const offlineFetch = jest.fn(async () => {
      throw new TypeError("Network request failed");
    });
    globalThis.fetch = offlineFetch as unknown as typeof fetch;

    const queryClient = createHehQueryClient();
    createdClients.push(queryClient);

    await render(
      <QueryClientProvider client={queryClient}>
        <HehThemeProvider initialMode="light" initialReduceMotion>
          <SearchEntryScreen />
        </HehThemeProvider>
      </QueryClientProvider>,
    );

    const input = screen.getByTestId("text-search-input");
    await fireEvent.changeText(input, "3000 altı siyah erkek mont");
    await fireEvent.press(screen.getByTestId("text-search-submit"));

    // User text MUST remain intact in the field when offline error appears.
    expect(screen.getByTestId("text-search-error")).toBeTruthy();
    expect(screen.getByText("Bağlantı yok. Tekrar dene.")).toBeTruthy();
    expect(screen.getByTestId("text-search-input").props.value).toBe("3000 altı siyah erkek mont");

    // Edit action keeps query intact and clears stale offline error once user edits text.
    await fireEvent.press(screen.getByTestId("text-search-focus-edit"));
    expect(screen.getByTestId("text-search-input").props.value).toBe("3000 altı siyah erkek mont");

    // Network recovers -> tapping Tekrar Dene succeeds without re-typing.
    const livePayload = await new MockSearchTransport().parseSearch({
      text: "3000 altı siyah erkek mont",
    });
    const recoveredFetch = jest.fn(
      async () =>
        new Response(JSON.stringify(livePayload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    globalThis.fetch = recoveredFetch as unknown as typeof fetch;

    await fireEvent.press(screen.getByTestId("text-search-retry"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("criteria-review-panel")).toBeTruthy();

    // Editing query after an offline error clears stale error notice immediately while preserving text.
    globalThis.fetch = offlineFetch as unknown as typeof fetch;
    await fireEvent.changeText(screen.getByTestId("text-search-input"), "4000 altı lacivert mont");
    await fireEvent.press(screen.getByTestId("text-search-submit"));
    expect(screen.getByTestId("text-search-error")).toBeTruthy();

    await fireEvent.changeText(
      screen.getByTestId("text-search-input"),
      "4000 altı siyah erkek mont",
    );
    expect(screen.queryByTestId("text-search-error")).toBeNull();
    expect(screen.getByTestId("text-search-input").props.value).toBe("4000 altı siyah erkek mont");
  });
});
