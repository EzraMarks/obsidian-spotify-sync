import { Album, Artist, MusicEntity, MusicIds, MusicSources, Track } from "../types";

export interface MusicLibraryQueryOptions {
    recentOnly?: boolean
}

export abstract class MusicLibrarySource {
    abstract getSavedArtists(options: MusicLibraryQueryOptions): Promise<Artist[]>;

    abstract getSavedAlbums(options: MusicLibraryQueryOptions): Promise<Album[]>;

    abstract getSavedTracks(options: MusicLibraryQueryOptions): Promise<Track[]>;

    abstract getArtistsById(ids: string[]): Promise<Artist[]>;

    abstract getAlbumsById(ids: string[]): Promise<Album[]>;

    abstract getTracksById(ids: string[]): Promise<Track[]>;

    abstract getPrimaryId(ids: MusicIds): string | undefined;
}
