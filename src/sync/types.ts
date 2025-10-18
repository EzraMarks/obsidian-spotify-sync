import type { SavedTrack } from '@spotify/web-api-ts-sdk';

export interface EnrichedTrack extends SavedTrack {
    // Array of playlist names where this track was sourced from
    sources: string[];
}

export type SyncOptions = { isFullSync: boolean, silent?: boolean };
