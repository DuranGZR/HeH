import { HStack, Link, Text, VStack } from "@expo/ui/swift-ui";
import {
  background,
  containerBackground,
  cornerRadius,
  font,
  foregroundStyle,
  padding,
  widgetURL,
} from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";

export interface HehWidgetProps {
  subtitle?: string;
}

/**
 * Isolated declarative iOS widget layout for `expo-widgets` SDK 58.
 * IMPORTANT: `"widget";` compiles in isolation; never call module-scope JS imports inside.
 */
function HehQuickSearchLayout(props: HehWidgetProps, environment: WidgetEnvironment) {
  "widget";

  const isDark = environment.colorScheme === "dark";
  const bgColor = isDark ? "#000000" : "#FFFFFF";
  const primaryText = isDark ? "#FFFFFF" : "#000000";
  const pillBg = isDark ? "#1C1C1C" : "#F2F2F2";
  const isMedium = environment.widgetFamily === "systemMedium";

  if (!isMedium) {
    return (
      <VStack
        alignment="leading"
        spacing={8}
        modifiers={[
          padding({ all: 14 }),
          containerBackground(bgColor, "widget"),
          widgetURL("heh://search?mode=voice"),
        ]}
      >
        <Text modifiers={[font({ size: 22, weight: "bold" }), foregroundStyle(primaryText)]}>
          heh.
        </Text>
        <Text modifiers={[font({ size: 13, weight: "medium" }), foregroundStyle(primaryText)]}>
          {props.subtitle ?? "Sesli ara"}
        </Text>
      </VStack>
    );
  }

  return (
    <VStack
      alignment="leading"
      spacing={12}
      modifiers={[padding({ all: 14 }), containerBackground(bgColor, "widget")]}
    >
      <Text modifiers={[font({ size: 20, weight: "bold" }), foregroundStyle(primaryText)]}>
        heh.
      </Text>
      <HStack spacing={10}>
        <Link
          label="Sesli Ara"
          destination="heh://search?mode=voice"
          modifiers={[
            padding({ horizontal: 14, vertical: 12 }),
            background(pillBg),
            cornerRadius(12),
            foregroundStyle(primaryText),
          ]}
        />
        <Link
          label="Yazarak Ara"
          destination="heh://search?mode=text"
          modifiers={[
            padding({ horizontal: 14, vertical: 12 }),
            background(pillBg),
            cornerRadius(12),
            foregroundStyle(primaryText),
          ]}
        />
      </HStack>
    </VStack>
  );
}

export const hehQuickSearchWidget = createWidget<HehWidgetProps>(
  "HehQuickSearch",
  HehQuickSearchLayout,
  { subtitle: "Sesli ara" },
);
