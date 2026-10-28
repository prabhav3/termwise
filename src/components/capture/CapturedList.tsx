import { Image, StyleSheet, View } from 'react-native';

import { Card, Icon, IconButton, NBText, type SymbolName } from '@/components/ui';
import { formatBytes, type CaptureFileKind, type CapturedFile } from '@/lib/uploads';
import { useTheme } from '@/theme';

const KIND_TEXT: Record<CaptureFileKind, string> = { pdf: 'PDF', docx: 'Word', text: 'Text', image: 'Photo' };
const KIND_ICON: Record<CaptureFileKind, { name: SymbolName; fallback: string }> = {
  pdf: { name: 'doc.richtext', fallback: 'P' },
  docx: { name: 'doc.text', fallback: 'W' },
  text: { name: 'text.alignleft', fallback: 'T' },
  image: { name: 'photo', fallback: '▣' },
};

export interface CapturedListProps {
  files: CapturedFile[];
  onMove: (key: string, delta: -1 | 1) => void;
  onRemove: (key: string) => void;
}

/** The pages and documents queued for upload, in the order they will be read. */
export function CapturedList({ files, onMove, onRemove }: CapturedListProps) {
  const { colors, borders, spacing } = useTheme();
  const total = files.reduce((sum, file) => sum + file.size, 0);
  return (
    <Card padded={false} shadow="sm">
      <View style={[styles.header, { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm }]}>
        <NBText variant="label" color="muted">
          {`${files.length} ${files.length === 1 ? 'file' : 'files'} · ${formatBytes(total)}`}
        </NBText>
        <NBText variant="tiny" color="muted">
          Read top to bottom
        </NBText>
      </View>
      {files.map((file, index) => {
        const position = `${index + 1} of ${files.length}`;
        return (
          <View
            key={file.key}
            style={[
              styles.row,
              {
                gap: spacing.md,
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.sm,
                borderTopWidth: borders.hairline,
                borderTopColor: colors.border,
              },
            ]}
          >
            {file.kind === 'image' ? (
              <Image
                source={{ uri: file.uri }}
                accessibilityIgnoresInvertColors
                accessible={false}
                style={[styles.thumb, { borderColor: colors.border, borderWidth: borders.hairline }]}
              />
            ) : (
              <View
                style={[
                  styles.thumb,
                  styles.docThumb,
                  { borderColor: colors.border, borderWidth: borders.hairline, backgroundColor: colors.surfaceAlt },
                ]}
              >
                <Icon name={KIND_ICON[file.kind].name} fallback={KIND_ICON[file.kind].fallback} size={20} />
              </View>
            )}
            <View accessible accessibilityLabel={`${file.name}, ${KIND_TEXT[file.kind]}, ${formatBytes(file.size)}, ${position}`} style={styles.text}>
              <NBText variant="bodyBold" numberOfLines={1} dense>
                {file.name}
              </NBText>
              <NBText variant="small" color="muted" dense>
                {`${KIND_TEXT[file.kind]} · ${formatBytes(file.size)}`}
              </NBText>
            </View>
            {files.length > 1 ? (
              <View style={[styles.actions, { gap: spacing.xs }]}>
                <IconButton
                  icon="arrow.up"
                  fallback="↑"
                  label={`Move ${file.name} up`}
                  variant="ghost"
                  size={36}
                  disabled={index === 0}
                  onPress={() => onMove(file.key, -1)}
                />
                <IconButton
                  icon="arrow.down"
                  fallback="↓"
                  label={`Move ${file.name} down`}
                  variant="ghost"
                  size={36}
                  disabled={index === files.length - 1}
                  onPress={() => onMove(file.key, 1)}
                />
              </View>
            ) : null}
            <IconButton icon="xmark" fallback="✕" label={`Remove ${file.name}`} variant="ghost" size={36} onPress={() => onRemove(file.key)} />
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 64 },
  thumb: { width: 40, height: 52, borderRadius: 0 },
  docThumb: { alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row' },
});
