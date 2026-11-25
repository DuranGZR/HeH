import { act, fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";

import { Listening } from "../src/features/search/components/Listening";
import { VoiceEntry } from "../src/features/search/components/VoiceEntry";
import { MockSpeechProvider } from "../src/services/speech/mockSpeechProvider";
import { createInitialSpeechState } from "../src/services/speech/stateMachine";
import { HehThemeProvider } from "../src/theme";

describe("D29 Listening Component, Partial vs Final Separation & Editable Transcript", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("distinguishes ephemeral partial transcript from finalized editable transcript cleanly", async () => {
    jest.useFakeTimers();
    const provider = new MockSpeechProvider({
      partialTranscripts: ["cey bi el", "cey bi el blutut"],
      finalTranscript: "cey bi el blutut kulaklık",
      partialIntervalMs: 25,
    });
    const transcriptReadySpy = jest.fn();

    await render(
      <HehThemeProvider initialMode="light" initialReduceMotion>
        <VoiceEntry
          onSwitchToText={jest.fn()}
          onTranscriptReady={transcriptReadySpy}
          speechProvider={provider}
        />
      </HehThemeProvider>,
    );

    await fireEvent.press(screen.getByTestId("voice-mic-toggle"));
    await act(async () => {
      jest.advanceTimersByTime(1);
    });

    // Partial phase: live temporary card shown; editable input NOT rendered and parse NOT called early
    expect(screen.getByTestId("voice-partial-badge")).toBeTruthy();
    expect(screen.getByText("Anlık (geçici)")).toBeTruthy();
    expect(screen.queryByTestId("voice-final-transcript-box")).toBeNull();
    expect(screen.queryByTestId("voice-transcript-input")).toBeNull();
    expect(transcriptReadySpy).toHaveBeenCalledTimes(0);

    await act(async () => {
      jest.advanceTimersByTime(30);
    });
    expect(screen.getByTestId("voice-partial-transcript").props.children).toBe("cey bi el");
    expect(transcriptReadySpy).toHaveBeenCalledTimes(0);

    // Finalize STT -> calls onTranscriptReady once AND mounts editable final transcript box
    await act(async () => {
      jest.advanceTimersByTime(60);
    });
    expect(transcriptReadySpy).toHaveBeenCalledTimes(1);
    expect(transcriptReadySpy).toHaveBeenCalledWith("cey bi el blutut kulaklık");
    expect(screen.queryByTestId("voice-partial-badge")).toBeNull();
    expect(screen.getByTestId("voice-final-badge").props.children).toBe(
      "Son Transkript (Düzenlenebilir)",
    );
    expect(screen.getByTestId("voice-transcript-input").props.value).toBe(
      "cey bi el blutut kulaklık",
    );

    // User fixes ASR phonetic slip manually in transcript box -> submits edited text cleanly
    await fireEvent.changeText(
      screen.getByTestId("voice-transcript-input"),
      "JBL bluetooth kulaklık 3000 altı",
    );
    await fireEvent.press(screen.getByTestId("voice-transcript-submit"));
    expect(transcriptReadySpy).toHaveBeenCalledTimes(2);
    expect(transcriptReadySpy).toHaveBeenLastCalledWith("JBL bluetooth kulaklık 3000 altı");

    // Re-listen clears prior finalized state and starts fresh voice session
    await fireEvent.press(screen.getByTestId("voice-relisten-button"));
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("voice-listening-card")).toBeTruthy();
  });

  it("blocks invalid blank edited transcript submission cleanly inside Listening", async () => {
    const onSubmitEdited = jest.fn();
    const state = {
      ...createInitialSpeechState(),
      status: "transcribed" as const,
      permission: "granted" as const,
      partialTranscript: "siyah erkek mont",
      finalTranscript: "siyah erkek mont",
    };

    await render(
      <HehThemeProvider initialMode="dark" initialReduceMotion>
        <Listening
          onCancelListening={jest.fn()}
          onRetryVoice={jest.fn()}
          onStopListening={jest.fn()}
          onSubmitEditedTranscript={onSubmitEdited}
          state={state}
        />
      </HehThemeProvider>,
    );

    await fireEvent.changeText(screen.getByTestId("voice-transcript-input"), "   ");
    expect(screen.getByTestId("voice-transcript-validation-error")).toBeTruthy();
    expect(screen.getByTestId("voice-transcript-submit").props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    await fireEvent.press(screen.getByTestId("voice-transcript-submit"));
    expect(onSubmitEdited).not.toHaveBeenCalled();
  });
});
