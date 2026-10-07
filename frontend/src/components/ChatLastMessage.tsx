import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/src/context/ThemeContext";
import { fonts } from "@/src/theme";
import { Ionicons } from "@/src/ui/icons";
import { MicGlyph } from "@/src/ui/MicGlyph";
import { UploadedActionIcon } from "@/src/ui/UploadedActionIcon";
import type { ChatMessagePreview } from "@/src/utils/api";

/** Only typed media previews lose their old leading emoji. User text stays intact. */
export function inboxPreview(message: ChatMessagePreview | null) {
  const text = message?.text || "";
  switch (message?.type) {
    case "voice":
      return { icon: "voice", text: text.replace(/^🔊\s*/u, "") || "Voice message" } as const;
    case "call":
      return { icon: "call", text: text.replace(/^📞\s*/u, "") ||
        (message.call_status === "missed" ? "Missed call" : "Call") } as const;
    case "room":
      return { icon: "room", text: "Voiceroom" } as const;
    case "image":
      return { icon: "image", text: text.replace(/^📷\s*/u, "") || "Photo" } as const;
    case "sticker":
      return { icon: "sticker", text: text.replace(/^😊\s*/u, "") || "Stickers" } as const;
    case "gift":
      return { icon: "gift", text: text || "Gift" } as const;
    default:
      return { icon: null, text: text || "Say hello 👋" };
  }
}

/** One glyph per message kind, all drawn in the same outline style/weight. */
function PreviewIcon({ icon, color, testID }: {
  icon: NonNullable<ReturnType<typeof inboxPreview>["icon"]>;
  color: string;
  testID: string;
}) {
  switch (icon) {
    case "call":
      return <UploadedActionIcon artwork="call" size={16} color={color} testID={testID} />;
    case "voice":
    case "room":
      return <MicGlyph size={16} color={color} testID={testID} />;
    case "image":
      return <Ionicons name="image-outline" size={16} color={color} testID={testID} />;
    case "sticker":
      return <Ionicons name="happy-outline" size={16} color={color} testID={testID} />;
    case "gift":
      return <Ionicons name="gift-outline" size={16} color={color} testID={testID} />;
    default:
      return null;
  }
}

export function ChatLastMessage({ message, conversationId }: {
  message: ChatMessagePreview | null;
  conversationId: string;
}) {
  const { colors } = useTheme();
  const preview = inboxPreview(message);
  const iconId = `chat-preview-${preview.icon}-icon-${conversationId}`;
  return (
    <View style={styles.row} testID={`chat-preview-${conversationId}`}>
      {preview.icon ? (
        <PreviewIcon icon={preview.icon} color={colors.onSurfaceSecondary} testID={iconId} />
      ) : null}
      <Text testID={`chat-preview-text-${conversationId}`} numberOfLines={1}
        ellipsizeMode="tail" style={[styles.text, { color: colors.onSurfaceSecondary }]}>
        {preview.text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 5 },
  text: { flex: 1, minWidth: 0, fontFamily: fonts.text, fontSize: 14 },
});