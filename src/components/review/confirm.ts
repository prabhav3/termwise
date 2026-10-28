import { Alert } from 'react-native';

/** Asks before throwing away an upload and everything read from it. */
export function confirmDiscardUpload(kind: 'syllabus' | 'toc', onConfirm: () => void): void {
  const what = kind === 'toc' ? 'table of contents' : 'syllabus';
  Alert.alert(`Discard this ${what}?`, 'The files and anything we read from them are deleted. Your courses stay as they are.', [
    { text: 'Keep it', style: 'cancel' },
    { text: 'Discard', style: 'destructive', onPress: onConfirm },
  ]);
}
