
import { ObsidianSpotifySettings } from "src/settings";
import { MusicLibrarySource } from "./music-sources/MusicLibrarySource";
import { Album, Artist, Track } from "./types";
import { App } from "obsidian";
import { LocalTrackManager } from "./LocalTrackManager";


export class MusicMetadataEnricher {
    private readonly localTrackManager: LocalTrackManager;

    constructor(
        private app: App,
        private settings: ObsidianSpotifySettings,
        private musicLibrarySource: MusicLibrarySource,
    ) {
        this.localTrackManager = new LocalTrackManager(
            this.app,
            this.settings
        );
    }

    async enrichArtists(artists: Artist[]): Promise<Artist[]> {
        // TODO
        return artists;
    }

    /**
     * Queries multiple music metadata sources to populate as many metadata IDs as possible.
     */
    async enrichAlbums(albums: Album[]): Promise<Album[]> {
        // TODO
        return albums;
    }

    async enrichTracks(tracks: Track[]): Promise<Track[]> {
        // TODO
        return tracks;
    }
}
