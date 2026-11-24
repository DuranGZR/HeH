import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { useHehTheme, type ThemeMode } from "@/theme";

import { OVERFLOW_MENU_ITEMS, type OverflowMenuItem } from "../types";

export interface MoreMenuModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
}

const THEME_MODE_LABELS: Readonly<Record<ThemeMode, string>> = {
  system: "Sistem",
  light: "Açık",
  dark: "Koyu",
} as const;

/**
 * Minimalist accessible top-right `...` overflow sheet (`SCREEN-05`).
 * Exposes theme switching and honest scope status without ads or dead placeholder pages.
 */
export function MoreMenuModal({ visible, onClose }: MoreMenuModalProps) {
  const { palette, typography, spacing, radius, borderWidth, touchTarget, layout, icons, hitSlop } =
    useHehTheme();
  const { mode, setMode } = useHehTheme();
  const [selectedNotice, setSelectedNotice] = useState<string | null>(null);

  const handleItemPress = (item: OverflowMenuItem): void => {
    setSelectedNotice(`${item.label}: ${item.subtitle}`);
  };

  return (
    <Modal
      accessibilityViewIsModal
      animationType="none"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View style={styles.backdrop}>
        <Pressable
          accessibilityLabel="Menüyü kapat"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.dismissOverlay}
          testID="more-menu-backdrop"
        />
        <View
          accessibilityRole="menu"
          style={[
            styles.sheet,
            {
              maxWidth: layout.maxContentWidth,
              backgroundColor: palette.surfaceElevated,
              borderColor: palette.borderSubtle,
              borderTopWidth: borderWidth.hairline,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              paddingHorizontal: layout.horizontalPadding,
              paddingTop: spacing.md,
              paddingBottom: spacing.xl,
              gap: spacing.sm,
            },
          ]}
          testID="more-menu-sheet"
        >
          <View style={styles.header}>
            <Text
              maxFontSizeMultiplier={typography.screenTitle.maxFontSizeMultiplier}
              style={[typography.screenTitle, { color: palette.textPrimary }]}
            >
              Menü
            </Text>
            <Pressable
              accessibilityLabel="Menüyü kapat"
              accessibilityRole="button"
              hitSlop={hitSlop}
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
                {
                  minWidth: touchTarget.minimum,
                  minHeight: touchTarget.minimum,
                  borderRadius: radius.pill,
                  backgroundColor: pressed ? palette.surfacePressed : palette.surfaceMuted,
                },
              ]}
              testID="more-menu-close"
            >
              <Text
                accessible={false}
                style={[typography.bodyMedium, { color: palette.textPrimary }]}
              >
                {icons.specs.close.glyphFallback}
              </Text>
            </Pressable>
          </View>

          <View style={[styles.themeRow, { gap: spacing.xs }]}>
            <Text
              maxFontSizeMultiplier={typography.caption.maxFontSizeMultiplier}
              style={[typography.caption, { color: palette.textSecondary }]}
            >
              Tema
            </Text>
            <View style={[styles.themeChoices, { gap: spacing.xs }]}>
              {(["system", "light", "dark"] as const).map((candidateMode) => {
                const isActive = mode === candidateMode;
                return (
                  <Pressable
                    accessibilityLabel={`Tema: ${THEME_MODE_LABELS[candidateMode]}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                    key={candidateMode}
                    onPress={() => setMode(candidateMode)}
                    style={[
                      styles.themePill,
                      {
                        minHeight: touchTarget.iosMinimum,
                        borderRadius: radius.pill,
                        borderWidth: borderWidth.hairline,
                        borderColor: isActive ? palette.ctaBackground : palette.borderControl,
                        backgroundColor: isActive ? palette.ctaBackground : palette.surfaceMuted,
                        paddingHorizontal: spacing.sm,
                      },
                    ]}
                    testID={`theme-option-${candidateMode}`}
                  >
                    <Text
                      maxFontSizeMultiplier={typography.badge.maxFontSizeMultiplier}
                      style={[
                        typography.badge,
                        { color: isActive ? palette.ctaText : palette.textPrimary },
                      ]}
                    >
                      {THEME_MODE_LABELS[candidateMode]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={[styles.itemList, { gap: spacing.xs }]}>
            {OVERFLOW_MENU_ITEMS.map((item) => (
              <Pressable
                accessibilityHint={item.accessibilityHint}
                accessibilityLabel={item.label}
                accessibilityRole="menuitem"
                key={item.id}
                onPress={() => handleItemPress(item)}
                style={({ pressed }) => [
                  styles.menuRow,
                  {
                    minHeight: touchTarget.minimum,
                    borderRadius: radius.md,
                    borderWidth: borderWidth.hairline,
                    borderColor: palette.borderSubtle,
                    backgroundColor: pressed ? palette.surfacePressed : palette.surfaceMuted,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.xs,
                  },
                ]}
                testID={`more-item-${item.id}`}
              >
                <Text
                  maxFontSizeMultiplier={typography.bodyMedium.maxFontSizeMultiplier}
                  style={[typography.bodyMedium, { color: palette.textPrimary }]}
                >
                  {item.label}
                </Text>
                <Text
                  maxFontSizeMultiplier={typography.caption.maxFontSizeMultiplier}
                  style={[typography.caption, { color: palette.textSecondary }]}
                >
                  {item.subtitle}
                </Text>
              </Pressable>
            ))}
          </View>

          {selectedNotice ? (
            <View
              accessibilityLiveRegion="polite"
              style={{
                borderRadius: radius.sm,
                borderWidth: borderWidth.hairline,
                borderColor: palette.borderControl,
                padding: spacing.sm,
              }}
              testID="more-menu-notice"
            >
              <Text
                maxFontSizeMultiplier={typography.caption.maxFontSizeMultiplier}
                style={[typography.caption, { color: palette.textSecondary }]}
              >
                {selectedNotice}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.35)",
  },
  dismissOverlay: {
    flex: 1,
  },
  sheet: {
    width: "100%",
    alignSelf: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  closeButton: {
    alignItems: "center",
    justifyContent: "center",
  },
  themeRow: {
    gap: 6,
  },
  themeChoices: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  themePill: {
    alignItems: "center",
    justifyContent: "center",
  },
  itemList: {
    width: "100%",
  },
  menuRow: {
    justifyContent: "center",
    gap: 2,
  },
});
