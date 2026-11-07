import type {Entry} from './business';

export type CorrectionAction = 'void-sale' | 'delete-purchase' | 'edit-purchase' | 'delete-return' | 'edit-return';

export type RecordChange =
  | {action: 'edit-purchase' | 'edit-return'; record: Entry}
  | {action: 'void-sale' | 'delete-purchase' | 'delete-return'; recordId: string};

export function applyRecordChange(entries: Entry[], change: RecordChange): Entry[] {
  if ('record' in change) {
    return entries.map(entry => entry.id === change.record.id ? change.record : entry);
  }
  return entries.filter(entry => entry.id !== change.recordId);
}
