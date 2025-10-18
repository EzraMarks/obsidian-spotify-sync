import { SpotifyApi } from '@spotify/web-api-ts-sdk';
import type { Album, Artist, MaxInt, Track, PlaylistedTrack, SavedAlbum, SavedTrack } from '@spotify/web-api-ts-sdk';
import { ObsidianSpotifySettings } from '../settings';
import { SpotifyDataHelpers } from './spotifyDataHelpers';
import { FileManager } from './fileManager';
import { EnrichedTrack, SyncOptions } from './types';

export class SpotifyApiClient {
    private readonly API_PAGE_SIZE: MaxInt<50> = 50;
    private readonly ARTISTS_BATCH_SIZE = 50;
    private readonly ALBUMS_BATCH_SIZE = 20;
    private readonly TRACKS_BATCH_SIZE = 50;
    private readonly RECENT_SYNC_LIMIT: MaxInt<50> = 20;

    constructor(
        private spotifyApi: SpotifyApi,
        private settings: ObsidianSpotifySettings,
        private dataHelpers: SpotifyDataHelpers,
        private fileManager: FileManager
    ) { }

    // ARTISTS
    async getRecentFollowedArtists(): Promise<Artist[]> {
        const response = await this.spotifyApi.currentUser.followedArtists(undefined, this.RECENT_SYNC_LIMIT);
        return response.artists.items.filter(artist => !this.fileManager.getArtistUriToFile().has(artist.uri));
    }

    async getAllFollowedArtists(): Promise<Artist[]> {
        const artists: Artist[] = [];
        let after: string | undefined = undefined;

        while (true) {
            const response = await this.spotifyApi.currentUser.followedArtists(after, this.API_PAGE_SIZE);
            artists.push(...response.artists.items);

            if (response.artists.items.length < this.API_PAGE_SIZE || !response.artists.next) break;

            if (response.artists.next) {
                const nextUrl = new URL(response.artists.next);
                after = nextUrl.searchParams.get('after') || undefined;
            }
            if (!after) break;
        }
        return artists;
    }

    async getArtistsById(artistIds: string[]): Promise<Artist[]> {
        return this.batchSpotifyApi(
            artistIds,
            this.ARTISTS_BATCH_SIZE,
            (ids) => this.spotifyApi.artists.get(ids)
        );
    }

    // ALBUMS
    async getSavedAlbums(options: SyncOptions): Promise<SavedAlbum[]> {
        const savedAlbumsAndSingles = options.isFullSync
            ? await this.getAllSavedAlbums()
            : await this.getRecentSavedAlbums();

        const savedAlbums = savedAlbumsAndSingles.filter(item => !this.dataHelpers.isSingle(item.album));
        return savedAlbums;
    }

    private async getRecentSavedAlbums(): Promise<SavedAlbum[]> {
        const response = await this.spotifyApi.currentUser.albums.savedAlbums(this.RECENT_SYNC_LIMIT, 0);
        return response.items.filter(item => !this.fileManager.getAlbumUriToFile().has(item.album.uri));
    }

    private async getAllSavedAlbums(): Promise<SavedAlbum[]> {
        return await this.paginateSpotifyApi(
            (offset) => this.spotifyApi.currentUser.albums.savedAlbums(this.API_PAGE_SIZE, offset)
        );
    }

    async getAlbumsById(albumIds: string[]): Promise<Album[]> {
        return this.batchSpotifyApi(
            albumIds,
            this.ALBUMS_BATCH_SIZE,
            (ids) => this.spotifyApi.albums.get(ids)
        );
    }

    // TRACKS
    async getSavedTracks(options: SyncOptions): Promise<EnrichedTrack[]> {
        const enrichedTracks = new Map<string, EnrichedTrack>();
        const mergeTrack = this.createTrackMerger(enrichedTracks);

        await this.collectLikedSongs(options, mergeTrack);
        await this.collectPlaylistTracks(options, mergeTrack);

        return Array.from(enrichedTracks.values());
    }

    async getTracksById(trackIds: string[]): Promise<Track[]> {
        return this.batchSpotifyApi(
            trackIds,
            this.TRACKS_BATCH_SIZE,
            (ids) => this.spotifyApi.tracks.get(ids)
        );
    }

    private async getRecentLikedSongs(): Promise<SavedTrack[]> {
        const response = await this.spotifyApi.currentUser.tracks.savedTracks(this.RECENT_SYNC_LIMIT, 0);
        return response.items.filter(item => !this.fileManager.getTrackUriToFile().has(item.track.uri));
    }

    private async getAllLikedSongs(): Promise<SavedTrack[]> {
        return this.paginateSpotifyApi(
            (offset) => this.spotifyApi.currentUser.tracks.savedTracks(this.API_PAGE_SIZE, offset)
        );
    }

    private async getRecentPlaylistedTracks(playlistId: string): Promise<PlaylistedTrack[]> {
        const response = await this.spotifyApi.playlists.getPlaylistItems(
            playlistId, 'US', undefined, this.RECENT_SYNC_LIMIT, 0
        );
        return response.items.filter(item => !this.fileManager.getTrackUriToFile().has(item.track.uri));
    }

    private async getAllPlaylistedTracks(playlistId: string): Promise<PlaylistedTrack[]> {
        return this.paginateSpotifyApi(
            (offset) => this.spotifyApi.playlists.getPlaylistItems(
                playlistId, 'US', undefined, this.API_PAGE_SIZE, offset
            )
        );
    }

    private createTrackMerger(enrichedTracks: Map<string, EnrichedTrack>) {
        return (savedTrack: SavedTrack, playlistName: string) => {
            const existing = enrichedTracks.get(savedTrack.track.uri);
            if (existing) {
                if (!existing.sources.includes(playlistName)) {
                    existing.sources.push(playlistName);
                }
                if (savedTrack.added_at < existing.added_at) {
                    existing.added_at = savedTrack.added_at;
                }
            } else {
                enrichedTracks.set(savedTrack.track.uri, {
                    ...savedTrack,
                    sources: [playlistName]
                });
            }
        };
    }

    private async collectLikedSongs(
        options: SyncOptions,
        mergeTrack: (savedTrack: SavedTrack, playlistName: string) => void
    ): Promise<void> {
        try {
            const savedTracks = options.isFullSync
                ? await this.getAllLikedSongs()
                : await this.getRecentLikedSongs();
            savedTracks.forEach(track => mergeTrack(track, 'Liked Songs'));
            console.log(`Found ${savedTracks.length} tracks from Liked Songs`);
        } catch (error) {
            console.error('Failed to get liked tracks:', error);
        }
    }

    private async collectPlaylistTracks(
        options: SyncOptions,
        mergeTrack: (savedTrack: SavedTrack, playlistName: string) => void
    ): Promise<void> {
        if (!this.settings.playlist_ids?.length) return;

        for (const playlistId of this.settings.playlist_ids) {
            if (!playlistId.trim()) continue;
            try {
                const playlistedTracks = options.isFullSync
                    ? await this.getAllPlaylistedTracks(playlistId)
                    : await this.getRecentPlaylistedTracks(playlistId);
                const playlistName = this.dataHelpers.getPlaylistDisplayName(playlistId);
                playlistedTracks
                    .filter(this.dataHelpers.isPlaylistedTrack)
                    .forEach(item => mergeTrack(item, playlistName));
                console.log(`Found ${playlistedTracks.length} tracks from playlist ${playlistName}`);
            } catch (error) {
                console.error(`Failed to get tracks from playlist ${playlistId}:`, error);
            }
        }
    }

    // HELPERS
    private async paginateSpotifyApi<T>(
        fetchPage: (offset: number) => Promise<{ items: T[] }>
    ): Promise<T[]> {
        const allItems: T[] = [];
        let offset = 0;
        while (true) {
            const response = await fetchPage(offset);
            allItems.push(...response.items);
            if (response.items.length < this.API_PAGE_SIZE) break;
            offset += this.API_PAGE_SIZE;
        }
        return allItems;
    }

    private async batchSpotifyApi<InputT, OutputT>(
        items: InputT[],
        batchSize: number,
        fetchBatch: (batch: InputT[]) => Promise<OutputT[]>
    ): Promise<OutputT[]> {
        const allResults: OutputT[] = [];

        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            const results = await fetchBatch(batch);
            allResults.push(...results);
        }

        return allResults;
    }
}
