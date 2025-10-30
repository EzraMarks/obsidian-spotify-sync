import { MusicLibraryQueryOptions, MusicLibrarySource } from "../MusicLibrarySource";
import { SpotifyApi } from '@spotify/web-api-ts-sdk';
import type * as Spotify from '@spotify/web-api-ts-sdk';
import { SpotifyUtils } from './SpotifyUtils';
import { Album, Artist, Track, SimplifiedArtist, SimplifiedTrack, SimplifiedAlbum, MusicSources } from "src/sync/types";
import { moment } from 'obsidian';
import { ObsidianSpotifySettings } from "src/settings";


export class SpotifyLibrarySource extends MusicLibrarySource {
    private readonly API_PAGE_SIZE: Spotify.MaxInt<50> = 50;
    private readonly ARTISTS_BATCH_SIZE = 50;
    private readonly ALBUMS_BATCH_SIZE = 20;
    private readonly TRACKS_BATCH_SIZE = 50;
    private readonly RECENT_SYNC_LIMIT: Spotify.MaxInt<50> = 20;

    private readonly utils: SpotifyUtils;

    constructor(
        private spotifyApi: SpotifyApi,
        private settings: ObsidianSpotifySettings
    ) {
        super();
        this.utils = new SpotifyUtils(this.settings);
    }

    override async getSavedArtists(options: MusicLibraryQueryOptions): Promise<Artist[]> {
        // We always retrieve all artists, because Spotify does not support retrieving artists by date

        const spotifyArtists: Spotify.Artist[] = [];
        let after: string | undefined = undefined;

        while (true) {
            const response = await this.spotifyApi.currentUser.followedArtists(after, this.API_PAGE_SIZE);
            spotifyArtists.push(...response.artists.items);

            if (response.artists.items.length < this.API_PAGE_SIZE || !response.artists.next) break;

            if (response.artists.next) {
                const nextUrl = new URL(response.artists.next);
                after = nextUrl.searchParams.get('after') || undefined;
            }
            if (!after) break;
        }

        return spotifyArtists.map(item => ({
            title: item.name,
            image: this.utils.getBestImageUrl(item.images),
            ids: this.utils.getSpotifyIds(item),
            addedAt: undefined,
            sources: {
                spotify: item.href
            }
        }));
    }

    override async getSavedAlbums(options: MusicLibraryQueryOptions): Promise<Album[]> {
        const savedAlbumsAndSingles = options.recentOnly
            ? await this.getRecentSavedAlbums()
            : await this.getAllSavedAlbums();

        const savedAlbums = savedAlbumsAndSingles.filter(item => !this.utils.isSingle(item.album));

        return savedAlbums.map(item => this.toAlbum(item.album, moment(item.added_at)));
    }

    private async getRecentSavedAlbums(): Promise<Spotify.SavedAlbum[]> {
        const response = await this.spotifyApi.currentUser.albums.savedAlbums(this.RECENT_SYNC_LIMIT, 0);
        return response.items;
    }

    private async getAllSavedAlbums(): Promise<Spotify.SavedAlbum[]> {
        return await this.paginateSpotifyApi(
            (offset) => this.spotifyApi.currentUser.albums.savedAlbums(this.API_PAGE_SIZE, offset)
        );
    }

    override async getSavedTracks(options: MusicLibraryQueryOptions): Promise<Track[]> {
        const savedTracks = options.recentOnly
            ? await this.getRecentSavedTracks()
            : await this.getAllSavedTracks();

        return savedTracks.map(item => this.toTrack(item.track, moment(item.added_at)));
    }

    private async getRecentSavedTracks(): Promise<Spotify.SavedTrack[]> {
        const response = await this.spotifyApi.currentUser.tracks.savedTracks(this.RECENT_SYNC_LIMIT, 0);
        return response.items;
    }

    private async getAllSavedTracks(): Promise<Spotify.SavedTrack[]> {
        return this.paginateSpotifyApi(
            (offset) => this.spotifyApi.currentUser.tracks.savedTracks(this.API_PAGE_SIZE, offset)
        );
    }

    async getPlaylistTracks(playlistId: string, options: MusicLibraryQueryOptions): Promise<Track[]> {
        const playlistTracks = options.recentOnly
            ? await this.getRecentPlaylistTracks(playlistId)
            : await this.getAllPlaylistTracks(playlistId);

        return playlistTracks.map(item => this.toTrack(item.track, moment(item.added_at)));
    }

    private async getRecentPlaylistTracks(playlistId: string): Promise<Spotify.PlaylistedTrack<Spotify.Track>[]> {
        const response = await this.spotifyApi.playlists.getPlaylistItems(
            playlistId, 'US', undefined, this.RECENT_SYNC_LIMIT, 0
        );
        return response.items
    }

    private async getAllPlaylistTracks(playlistId: string): Promise<Spotify.PlaylistedTrack<Spotify.Track>[]> {
        return this.paginateSpotifyApi(
            (offset) => this.spotifyApi.playlists.getPlaylistItems(
                playlistId, 'US', undefined, this.API_PAGE_SIZE, offset
            )
        );
    }

    override async getAlbumsById(spotifyIds: string[]): Promise<Album[]> {
        const albums = await this.batchSpotifyApi(
            spotifyIds,
            this.ALBUMS_BATCH_SIZE,
            (ids) => this.spotifyApi.albums.get(ids)
        );

        return albums.map(item => this.toAlbum(item, undefined));
    }

    private toAlbum(item: Spotify.Album, addedAt: moment.Moment | undefined): Album {
        return {
            title: item.name,
            image: this.utils.getBestImageUrl(item.images),
            ids: this.utils.getSpotifyIds(item),
            artists: item.artists.map(artist => this.toSimplifiedArtist(artist)),
            tracks: item.tracks.items.map(track => this.toSimplifiedTrack(track)),
            addedAt,
            sources: {
                spotify: item.href
            }
        }
    }

    private toTrack(item: Spotify.Track, addedAt: moment.Moment | undefined): Track {
        const artists: SimplifiedArtist[] = item.artists.map(spotifyArtist => ({
            title: spotifyArtist.name,
            ids: this.utils.getSpotifyIds(spotifyArtist)
        }));

        const spotifyAlbum = item.album;
        const album: SimplifiedAlbum | null | undefined =
            spotifyAlbum.total_tracks === 1
                ? null // album is null for tracks that are singles
                : {
                    title: spotifyAlbum.name,
                    artists: spotifyAlbum.artists.map(artist => this.toSimplifiedArtist(artist)),
                    ids: this.utils.getSpotifyIds(spotifyAlbum)
                };

        return {
            title: item.name,
            image: this.utils.getBestImageUrl(item.album.images),
            ids: this.utils.getSpotifyIds(item.album),
            artists,
            album,
            addedAt,
            sources: {
                spotify: item.href
            }
        };
    }

    private toSimplifiedArtist(spotifyArtist: Spotify.SimplifiedArtist): SimplifiedArtist {
        return {
            title: spotifyArtist.name,
            ids: this.utils.getSpotifyIds(spotifyArtist)
        };
    }

    private toSimplifiedTrack(spotifyTrack: Spotify.SimplifiedTrack): SimplifiedTrack {
        return {
            title: spotifyTrack.name,
            ids: this.utils.getSpotifyIds(spotifyTrack)
        };
    }

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
