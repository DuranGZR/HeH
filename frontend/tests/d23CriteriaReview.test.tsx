import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { Pressable, Text } from "react-native";

import type { SearchIntentV2Output } from "../src/api";
import { CriteriaReview } from "../src/features/search/components/CriteriaReview";
import {
  buildCriteriaGroupViewModels,
  parseTurkishPriceDraft,
  removeCriterionFromIntent,
  removeOptionFromOrIntent,
  updatePriceCriterionInIntent,
} from "../src/features/search/criteriaAst";
import { MockSearchTransport } from "../src/features/search/demoFixtures";
import { useSearchFlow } from "../src/features/search/queryHooks";
import { HehThemeProvider } from "../src/theme";

function D23Harness({ initialQuery }: { readonly initialQuery: string }) {
  const flow = useSearchFlow({ transport: new MockSearchTransport() });
  return (
    <HehThemeProvider initialMode="light" initialReduceMotion>
      <Pressable
        onPress={() => {
          void flow.runParse(initialQuery);
        }}
        testID="run-d23-parse"
      >
        <Text>Parse</Text>
      </Pressable>
      {flow.resolution && flow.summaryText ? (
        <CriteriaReview
          canRestore={flow.canRestore}
          chips={flow.chips}
          ctaLabel={flow.ctaLabel}
          externalOpenError={flow.externalOpenError}
          groups={flow.criteriaGroups}
          isBusy={flow.phase === "parsing" || flow.phase === "resolving"}
          onPressOpenExternal={() => {
            void flow.openExternalResult();
          }}
          onRemoveCriterion={(id) => {
            void flow.removeCriterion(id);
          }}
          onRemoveOrOption={(criterionId, optionKey) => {
            void flow.removeOrOption(criterionId, optionKey);
          }}
          onRestoreLast={() => {
            void flow.restoreLastRemoved();
          }}
          onUpdatePriceRange={(criterionId, minAmount, maxAmount) => {
            void flow.updatePriceRange(criterionId, minAmount, maxAmount);
          }}
          resolution={flow.resolution}
          summaryText={flow.summaryText}
          warnings={flow.warnings}
        />
      ) : null}
      <Text testID="d23-url">{flow.resolution?.url ?? ""}</Text>
      <Text testID="d23-groups-json">{JSON.stringify(flow.intent?.logic_groups ?? [])}</Text>
    </HehThemeProvider>
  );
}

describe("D23 AST-Group CriteriaReview & Non-Leaking Edits", () => {
  it("preserves OR (any_of) and NOT groups without flattening and avoids leak on deletion", () => {
    const intent: SearchIntentV2Output = {
      schema_version: "2.0.0",
      raw_query: "Sony veya JBL veya Bose nike olmasın kulaklık",
      normalized_query: "sony veya jbl veya bose nike olmasın kulaklık",
      locale: "tr-TR",
      input_source: "text",
      category_key: "bluetooth_kulaklik",
      criteria: [
        {
          id: "cat-1",
          field: "category",
          operator: "eq",
          value: "bluetooth_kulaklik",
          display_label: "Bluetooth Kulaklık",
        },
        {
          id: "brand-or-1",
          field: "brand",
          operator: "in",
          value: ["sony", "jbl", "bose"],
          display_label: "Sony veya JBL veya Bose",
        },
        {
          id: "brand-not-1",
          field: "brand",
          operator: "not_in",
          value: ["nike"],
          display_label: "Nike olmasın",
        },
      ],
      logic_groups: [
        { operator: "all_of", criterion_ids: ["cat-1", "brand-or-1"] },
        { operator: "any_of", criterion_ids: ["brand-or-1"] },
        { operator: "not", criterion_ids: ["brand-not-1"] },
      ],
    };

    // Removing 1 option from a 3-brand OR group MUST keep remaining 2 as operator="in" inside any_of!
    const shrunkOnce = removeOptionFromOrIntent(intent, "brand-or-1", "bose");
    const shrunkBrandNode = shrunkOnce.criteria?.find((c) => c.id === "brand-or-1");
    expect(shrunkBrandNode?.operator).toBe("in");
    expect(shrunkBrandNode?.value).toEqual(["sony", "jbl"]);
    expect(shrunkBrandNode?.display_label).toBe("Sony veya JBL");
    expect(shrunkOnce.logic_groups?.some((g) => g.operator === "any_of")).toBe(true);

    // Removing 1 more option leaves singleton "sony" -> converts cleanly to operator="eq" and drops any_of.
    const shrunkTwice = removeOptionFromOrIntent(shrunkOnce, "brand-or-1", "jbl");
    const singleBrandNode = shrunkTwice.criteria?.find((c) => c.id === "brand-or-1");
    expect(singleBrandNode?.operator).toBe("eq");
    expect(singleBrandNode?.value).toBe("sony");
    expect(shrunkTwice.logic_groups?.some((g) => g.operator === "any_of")).toBe(false);
    expect(shrunkTwice.logic_groups?.some((g) => g.operator === "not")).toBe(true);

    // Removing NOT criterion drops it completely from both criteria and logic_groups.
    const removedNot = removeCriterionFromIntent(shrunkTwice, "brand-not-1");
    expect(removedNot.criteria?.some((c) => c.id === "brand-not-1")).toBe(false);
    expect(removedNot.logic_groups?.some((g) => g.operator === "not")).toBe(false);
  });

  it("renders separate AND, OR (VEYA), and NOT (HARİÇ) sections and removes OR sub-items cleanly", async () => {
    const transport = new MockSearchTransport();
    const resolveSpy = jest.spyOn(transport, "resolveSearch");

    function SpyHarness() {
      const flow = useSearchFlow({ transport });
      return (
        <HehThemeProvider initialMode="light" initialReduceMotion>
          <Pressable
            onPress={() => {
              void flow.runParse("Sony veya JBL 3000 altı nike olmasın kulaklık");
            }}
            testID="run-d23-parse"
          >
            <Text>Parse</Text>
          </Pressable>
          {flow.resolution && flow.summaryText ? (
            <CriteriaReview
              canRestore={flow.canRestore}
              chips={flow.chips}
              ctaLabel={flow.ctaLabel}
              externalOpenError={flow.externalOpenError}
              groups={flow.criteriaGroups}
              isBusy={flow.phase === "parsing" || flow.phase === "resolving"}
              onPressOpenExternal={() => {
                void flow.openExternalResult();
              }}
              onRemoveCriterion={(id) => {
                void flow.removeCriterion(id);
              }}
              onRemoveOrOption={(criterionId, optionKey) => {
                void flow.removeOrOption(criterionId, optionKey);
              }}
              onRestoreLast={() => {
                void flow.restoreLastRemoved();
              }}
              resolution={flow.resolution}
              summaryText={flow.summaryText}
              warnings={flow.warnings}
            />
          ) : null}
          <Text testID="d23-url">{flow.resolution?.url ?? ""}</Text>
        </HehThemeProvider>
      );
    }

    await render(<SpyHarness />);
    await fireEvent.press(screen.getByTestId("run-d23-parse"));

    expect(screen.getByTestId("criteria-group-all-of")).toBeTruthy();
    expect(screen.getByTestId("criteria-group-any-of-group-any-1")).toBeTruthy();
    expect(screen.getByTestId("criteria-group-not")).toBeTruthy();
    expect(screen.getByTestId("criterion-not-tag-brand-not-1")).toBeTruthy();
    expect(screen.getByTestId("criterion-or-tag-brand-or-1")).toBeTruthy();
    expect(screen.getByTestId("d23-url").props.children).toContain("wb=795%2C102285");

    // Removing ONLY "jbl" from "Sony veya JBL" keeps Sony (795) and never leaks 102285/jbl!
    await fireEvent.press(screen.getByTestId("remove-or-option-brand-or-1-jbl"));
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    const urlAfterJblRemove = String(screen.getByTestId("d23-url").props.children);
    expect(urlAfterJblRemove).toContain("wb=795");
    expect(urlAfterJblRemove).not.toContain("102285");
    expect(urlAfterJblRemove.toLowerCase()).not.toContain("jbl");
  });

  it("supports inline price range editing -> /resolve and clean 0-criteria empty state with undo", async () => {
    expect(parseTurkishPriceDraft("1.500,50")).toBe("1500.50");
    expect(parseTurkishPriceDraft("abc")).toBeNull();

    await render(<D23Harness initialQuery="3000 altı erkek mont" />);
    await fireEvent.press(screen.getByTestId("run-d23-parse"));

    await fireEvent.press(screen.getByTestId("edit-price-price-1"));
    expect(screen.getByTestId("price-editor-price-1")).toBeTruthy();

    // Invalid range min > max stays blocked client-side before sending /resolve.
    await fireEvent.changeText(screen.getByTestId("price-min-input-price-1"), "4000");
    await fireEvent.changeText(screen.getByTestId("price-max-input-price-1"), "2000");
    await fireEvent.press(screen.getByTestId("price-apply-price-1"));
    expect(screen.getByTestId("price-draft-error-price-1")).toBeTruthy();

    // Valid range triggers edit-only /resolve and updates prc=1500-2500.
    await fireEvent.changeText(screen.getByTestId("price-min-input-price-1"), "1500");
    await fireEvent.changeText(screen.getByTestId("price-max-input-price-1"), "2500");
    await fireEvent.press(screen.getByTestId("price-apply-price-1"));
    expect(screen.getByTestId("d23-url").props.children).toContain("prc=1500-2500");

    // Deleting every remaining chip transitions cleanly to empty-state + undo (without broken redirect).
    await fireEvent.press(screen.getByTestId("remove-criterion-cat-1"));
    await fireEvent.press(screen.getByTestId("remove-criterion-price-1"));
    expect(screen.getByTestId("criteria-empty-state")).toBeTruthy();
    expect(screen.getByTestId("open-trendyol-cta").props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );

    // Restoring last criterion brings back valid price URL cleanly.
    await fireEvent.press(screen.getByTestId("restore-criterion-button"));
    expect(screen.queryByTestId("criteria-empty-state")).toBeNull();
    expect(screen.getByTestId("d23-url").props.children).toContain("prc=1500-2500");
  });

  it("handles updatePriceCriterionInIntent and buildCriteriaGroupViewModels edge cases cleanly", () => {
    const emptyRes = buildCriteriaGroupViewModels([], null);
    expect(emptyRes).toEqual([]);

    const missingTarget = updatePriceCriterionInIntent(
      {
        raw_query: "mont",
        normalized_query: "mont",
        criteria: [],
        logic_groups: [],
      },
      "missing",
      "100",
      "500",
    );
    expect(missingTarget).toBeNull();
  });
});
