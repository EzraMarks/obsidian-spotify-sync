import { ObsidianSpotifySettings } from "src/settings";
import { MusicLibrarySource } from "./music-sources/MusicLibrarySource";
import { Album, Artist, MusicEntity, Track } from "./types";
import { App } from "obsidian";
import { LocalTrackManager } from "./LocalTrackManager";
import { MusicIdIndex } from "./MusicIdIndex";


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
        // TODO: Add additional enrichments (e.g. MusicBrainz)
        // and only query for enrichments when they are not already present
        return this.enrichEntitiesWithMusicLibrarySource(
            artists,
            (ids) => this.musicLibrarySource.getArtistsById(ids)
        );
    }

    /**
     * Queries multiple music metadata sources to populate as many metadata IDs as possible.
     */
    async enrichAlbums(albums: Album[]): Promise<Album[]> {
        // TODO: Add additional enrichments (e.g. MusicBrainz)
        // and only query for enrichments when they are not already present
        return this.enrichEntitiesWithMusicLibrarySource(
            albums,
            (ids) => this.musicLibrarySource.getAlbumsById(ids)
        );
    }

    async enrichTracks(tracks: Track[]): Promise<Track[]> {
        // TODO: Add additional enrichments (e.g. MusicBrainz)
        // and only query for enrichments when they are not already present
        return this.enrichEntitiesWithMusicLibrarySource(
            tracks,
            (ids) => this.musicLibrarySource.getTracksById(ids)
        );
    }

    private async enrichEntitiesWithMusicLibrarySource<T extends MusicEntity>(
        entities: T[],
        fetchEnrichedData: (ids: string[]) => Promise<T[]>
    ): Promise<T[]> {
        const ids = entities
            .map(item => this.musicLibrarySource.getPrimaryId(item.ids))
            .filter(id => id != null);

        if (ids.length === 0) {
            return entities;
        }

        const enrichedData = await fetchEnrichedData(ids);
        const enrichedDataIndex = MusicIdIndex.fromItems(enrichedData);

        return entities.map(item => {
            const enriched = enrichedDataIndex.get(item.ids);
            return enriched ? { ...item, ...enriched } : item;
        });
    }
}
