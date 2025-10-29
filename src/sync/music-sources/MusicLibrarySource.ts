import { Album, Artist, Track } from "../types";

export interface MusicLibraryQueryOptions {
    recentOnly?: boolean
}

export abstract class MusicLibrarySource {
    abstract getSavedArtists(options: MusicLibraryQueryOptions): Promise<Artist[]>

    abstract getSavedAlbums(options: MusicLibraryQueryOptions): Promise<Album[]>

    abstract getSavedTracks(options: MusicLibraryQueryOptions): Promise<Track[]>

    abstract getAlbumsById(ids: string[]): Promise<Album[]>
}
