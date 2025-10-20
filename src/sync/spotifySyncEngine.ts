import { App, Notice } from 'obsidian';
import { SpotifyApi } from '@spotify/web-api-ts-sdk';
import type { Album, Artist, Track } from '@spotify/web-api-ts-sdk';
import { ObsidianSpotifySettings } from '../settings';
import { SpotifyApiClient } from './spotifyApiClient';
import { FrontmatterManager } from './frontmatterManager';
import { FileManager } from './fileManager';
import { SpotifyDataHelpers } from './spotifyDataHelpers';
import { SyncOptions } from './types';

export class SpotifySyncEngine {
    private app: App;
    private spotifyApi: SpotifyApi;
    private settings: ObsidianSpotifySettings;

    private apiClient: SpotifyApiClient;
    private frontmatterManager: FrontmatterManager;
    private fileManager: FileManager;
    private dataHelpers: SpotifyDataHelpers;

    constructor(app: App, spotifyApi: SpotifyApi, settings: ObsidianSpotifySettings) {
        this.app = app;
        this.spotifyApi = spotifyApi;
        this.settings = settings;

        this.dataHelpers = new SpotifyDataHelpers(settings);
        this.fileManager = new FileManager(app, this.settings);
        this.apiClient = new SpotifyApiClient(spotifyApi, settings, this.dataHelpers, this.fileManager);
        this.frontmatterManager = new FrontmatterManager(
            app,
            settings,
            this.dataHelpers,
            this.fileManager
        );
    }

    async sync(options: SyncOptions): Promise<void> {
        try {
            options.silent || new Notice(`Starting ${options.isFullSync ? 'full' : 'recent'} Spotify sync...`);

            await this.fileManager.ensureDirectoryExists(this.fileManager.artistsPath);
            await this.fileManager.ensureDirectoryExists(this.fileManager.albumsPath);
            await this.fileManager.ensureDirectoryExists(this.fileManager.tracksPath);
            await this.fileManager.buildUriMappings();

            // Create notes in dependency order: artists <- albums <- tracks
            options.isFullSync
                ? await this.upsertAllArtists()
                : await this.upsertRecentArtists();
            options.isFullSync
                ? await this.upsertAllAlbums()
                : await this.upsertRecentAlbums();
            options.isFullSync
                ? await this.upsertAllTracks()
                : await this.upsertRecentTracks();

            options.silent || new Notice(`${options.isFullSync ? 'Full' : 'Recent'} Spotify sync completed successfully!`);
        } catch (error) {
            console.error('Spotify sync failed:', error);
            options.silent || new Notice('Spotify sync failed. Check console for details.');
        }
    }

    // ARTIST SYNC
    private async upsertRecentArtists(): Promise<void> {
        console.log('Upserting recent artist notes...');

        const followedArtists = await this.apiClient.getRecentFollowedArtists();
        await Promise.all(followedArtists.map(artist => this.upsertArtist(artist, true)));
    }

    private async upsertAllArtists(): Promise<void> {
        console.log('Upserting all artist notes...');

        const followedArtists = await this.apiClient.getAllFollowedArtists();

        const followedArtistUris = new Set(followedArtists.map(artist => artist.uri));
        const unsavedArtistIds = [...this.fileManager.artistUriToFile.entries()]
            .filter(([uri]) => !followedArtistUris.has(uri))
            .map(([uri, file]) => this.fileManager.extractSpotifyIdFromFile(file))
            .filter((id): id is string => id != null);

        const unsavedArtists = await this.apiClient.getArtistsById(unsavedArtistIds);

        await Promise.all(followedArtists.map(artist =>
            this.upsertArtist(artist, true)
        ));

        await Promise.all(unsavedArtists.map(artist =>
            this.upsertArtist(artist, false)
        ));
    }

    // ALBUM SYNC
    private async upsertRecentAlbums(): Promise<void> {
        console.log('Upserting recent album notes...');

        const albums = await this.apiClient.getSavedAlbums({ isFullSync: false });

        await Promise.all(albums.map(item =>
            this.upsertAlbum(item.album, true, item.added_at)
        ));
    }

    private async upsertAllAlbums(): Promise<void> {
        console.log('Upserting all album notes...');

        const savedAlbums = await this.apiClient.getSavedAlbums({ isFullSync: true });

        const savedAlbumUris = new Set(savedAlbums.map(item => item.album.uri));
        const unsavedAlbumIds = [...this.fileManager.albumUriToFile.entries()]
            .filter(([uri]) => !savedAlbumUris.has(uri))
            .map(([uri, file]) => this.fileManager.extractSpotifyIdFromFile(file))
            .filter((id): id is string => id != null);

        const unsavedAlbums = await this.apiClient.getAlbumsById(unsavedAlbumIds);

        await Promise.all(savedAlbums.map(item =>
            this.upsertAlbum(item.album, true, item.added_at)
        ));

        await Promise.all(unsavedAlbums.map(album =>
            this.upsertAlbum(album, false)
        ));
    }

    // TRACK SYNC
    private async upsertRecentTracks(): Promise<void> {
        console.log('Upserting recent track notes...');

        const savedTracks = await this.apiClient.getSavedTracks({ isFullSync: false });
        await Promise.all(savedTracks.map(item =>
            this.upsertTrack(item.track, item.sources, true, item.added_at)
        ));
    }

    private async upsertAllTracks(): Promise<void> {
        console.log('Upserting all track notes...');

        const savedTracks = await this.apiClient.getSavedTracks({ isFullSync: true });

        const savedTrackUris = new Set(savedTracks.map(item => item.track.uri));
        const unsavedTrackIds = [...this.fileManager.trackUriToFile.entries()]
            .filter(([uri]) => !savedTrackUris.has(uri))
            .map(([uri, file]) => this.fileManager.extractSpotifyIdFromFile(file))
            .filter((id): id is string => id != null);

        const unsavedTracks = await this.apiClient.getTracksById(unsavedTrackIds);

        await Promise.all(savedTracks.map(item =>
            this.upsertTrack(item.track, item.sources, true, item.added_at)
        ));

        await Promise.all(unsavedTracks.map(track =>
            this.upsertTrack(track, [], false)
        ));
    }

    // UPSERT HELPERS
    private async upsertTrack(
        track: Track,
        sources: string[],
        isInSpotifyLibrary: boolean,
        addedAt?: string
    ): Promise<void> {
        const fileName = this.dataHelpers.generateTrackFileName(track);
        const file = await this.fileManager.getOrCreateNote(
            track.uri,
            fileName,
            this.fileManager.tracksPath,
            this.fileManager.trackUriToFile
        );
        if (file) {
            const localTrackFile = await this.fileManager.localTrackManager.findTrackFile(track.uri);

            await this.frontmatterManager.updateItemFrontmatter(
                file,
                track,
                isInSpotifyLibrary,
                addedAt,
                sources,
                localTrackFile
            );

            this.fileManager.trackUriToFile.set(track.uri, file);
        }
    }

    private async upsertAlbum(
        album: Album,
        isInSpotifyLibrary: boolean,
        addedAt?: string,
    ): Promise<void> {
        const primaryArtist = album.artists[0]?.name || 'Unknown Artist';
        const fileName = this.dataHelpers.buildSafeFileName(album.name, primaryArtist);
        const file = await this.fileManager.getOrCreateNote(
            album.uri,
            fileName,
            this.fileManager.albumsPath,
            this.fileManager.albumUriToFile
        );
        if (file) {
            await this.frontmatterManager.updateItemFrontmatter(file, album, isInSpotifyLibrary, addedAt);
            this.fileManager.albumUriToFile.set(album.uri, file);
        }
    }

    private async upsertArtist(
        artist: Artist,
        isInSpotifyLibrary: boolean
    ): Promise<void> {
        const fileName = this.dataHelpers.buildSafeFileName(artist.name);
        const file = await this.fileManager.getOrCreateNote(
            artist.uri,
            fileName,
            this.fileManager.artistsPath,
            this.fileManager.artistUriToFile
        );
        if (file) {
            await this.frontmatterManager.updateItemFrontmatter(file, artist, isInSpotifyLibrary);
            this.fileManager.artistUriToFile.set(artist.uri, file);
        }
    }
}
