import { App, TFile, TFolder, Notice, normalizePath, parseYaml, moment } from 'obsidian';
import { SpotifyApi } from '@spotify/web-api-ts-sdk';
import type { Album, Artist, MaxInt, SimplifiedArtist, Track, PlaylistedTrack, SavedAlbum, SavedTrack, SimplifiedAlbum } from '@spotify/web-api-ts-sdk';
import { ObsidianSpotifySettings } from './settings';

interface EnrichedTrack extends SavedTrack {
    // Array of playlist names where this track was sourced from
    sources: string[];
}

export type SyncOptions = { isFullSync: boolean, silent?: boolean };

export class SpotifySyncEngine {
    private app: App;
    private spotifyApi: SpotifyApi;
    private settings: ObsidianSpotifySettings;

    // Path configuration
    private readonly ARTISTS_PATH: string;
    private readonly ALBUMS_PATH: string;
    private readonly TRACKS_PATH: string;

    // API limits and batch sizes
    private readonly API_PAGE_SIZE: MaxInt<50> = 50;
    private readonly ARTISTS_BATCH_SIZE = 50;
    private readonly ALBUMS_BATCH_SIZE = 20;
    private readonly TRACKS_BATCH_SIZE = 50;
    private readonly RECENT_SYNC_LIMIT: MaxInt<50> = 20;

    // Spotify URI to file mappings for efficient lookups
    private trackUriToFile = new Map<string, TFile>();
    private albumUriToFile = new Map<string, TFile>();
    private artistUriToFile = new Map<string, TFile>();

    constructor(app: App, spotifyApi: SpotifyApi, settings: ObsidianSpotifySettings) {
        this.app = app;
        this.spotifyApi = spotifyApi;
        this.settings = settings;
        this.ARTISTS_PATH = `${settings.music_catalog_base_path}/${settings.artists_path}`;
        this.ALBUMS_PATH = `${settings.music_catalog_base_path}/${settings.albums_path}`;
        this.TRACKS_PATH = `${settings.music_catalog_base_path}/${settings.tracks_path}`;
    }

    async sync(options: SyncOptions): Promise<void> {
        try {
            options.silent || new Notice(`Starting ${options.isFullSync ? 'full' : 'recent'} Spotify sync...`);

            await this.ensureDirectoryExists(this.ARTISTS_PATH);
            await this.ensureDirectoryExists(this.ALBUMS_PATH);
            await this.ensureDirectoryExists(this.TRACKS_PATH);
            await this.buildUriMappings();

            // Create notes in dependency order: artists <- albums <- tracks
            options.isFullSync
                ? await this.upsertAllArtists()
                : await this.upsertRecentArtists();
            await this.buildMappingForFolder(this.ARTISTS_PATH, this.artistUriToFile);

            options.isFullSync
                ? await this.upsertAllAlbums()
                : await this.upsertRecentAlbums();
            await this.buildMappingForFolder(this.ALBUMS_PATH, this.albumUriToFile);

            options.isFullSync
                ? await this.upsertAllTracks()
                : await this.upsertRecentTracks();
            await this.buildMappingForFolder(this.TRACKS_PATH, this.trackUriToFile);

            options.silent || new Notice(`${options.isFullSync ? 'Full' : 'Recent'} Spotify sync completed successfully!`);
        } catch (error) {
            console.error('Spotify sync failed:', error);
            options.silent || new Notice('Spotify sync failed. Check console for details.');
        }
    }

    // ARTIST SYNC
    private async upsertRecentArtists(): Promise<void> {
        console.log('Upserting recent artist notes...');

        const followedArtists = await this.getRecentFollowedArtists();
        await Promise.all(followedArtists.map(artist => this.upsertArtist(artist, true)));
    }

    private async upsertAllArtists(): Promise<void> {
        console.log('Upserting all artist notes...');

        const followedArtists = await this.getAllFollowedArtists();

        const followedArtistUris = new Set(followedArtists.map(artist => artist.uri));
        const unsavedArtistUris = [...this.artistUriToFile.keys()]
            .filter(uri => !followedArtistUris.has(uri));
        const unsavedArtists = await this.getArtistsByUri(unsavedArtistUris);

        await Promise.all(followedArtists.map(artist =>
            this.upsertArtist(artist, true)
        ));

        await Promise.all(unsavedArtists.map(artist =>
            this.upsertArtist(artist, false)
        ));
    }

    private async getRecentFollowedArtists(): Promise<Artist[]> {
        const response = await this.spotifyApi.currentUser.followedArtists(undefined, this.RECENT_SYNC_LIMIT);
        return response.artists.items.filter(artist => !this.artistUriToFile.has(artist.uri));
    }

    // ALBUM SYNC
    private async upsertRecentAlbums(): Promise<void> {
        console.log('Upserting recent album notes...');

        const savedAlbums = await this.getRecentSavedAlbums();
        await Promise.all(savedAlbums.map(item =>
            this.upsertAlbum(item.album, true, item.added_at)
        ));
    }

    private async upsertAllAlbums(): Promise<void> {
        console.log('Upserting all album notes...');

        const savedAlbums = await this.getAllSavedAlbums();

        const savedAlbumUris = new Set(savedAlbums.map(item => item.album.uri));
        const unsavedAlbumUris = [...this.albumUriToFile.keys()]
            .filter(uri => !savedAlbumUris.has(uri));
        const unsavedAlbums = await this.getAlbumsByUri(unsavedAlbumUris);

        await Promise.all(savedAlbums.map(item =>
            this.upsertAlbum(item.album, true, item.added_at)
        ));

        await Promise.all(unsavedAlbums.map(album =>
            this.upsertAlbum(album, false)
        ));
    }

    private async getRecentSavedAlbums(): Promise<SavedAlbum[]> {
        const response = await this.spotifyApi.currentUser.albums.savedAlbums(this.RECENT_SYNC_LIMIT, 0);
        const newSavedAlbumsOrSingles = response.items.filter(item => !this.albumUriToFile.has(item.album.uri));
        return newSavedAlbumsOrSingles.filter(item => !this.isSingle(item.album));
    }

    // TRACK SYNC
    private async upsertRecentTracks(): Promise<void> {
        console.log('Upserting recent track notes...');

        const savedTracks = await this.getSavedTracks({ isFullSync: false });
        await Promise.all(savedTracks.map(item =>
            this.upsertTrack(item.track, item.sources, true, item.added_at)
        ));
    }

    private async upsertAllTracks(): Promise<void> {
        console.log('Upserting all track notes...');

        const savedTracks = await this.getSavedTracks({ isFullSync: true });

        const savedTrackUris = new Set(savedTracks.map(item => item.track.uri));
        const unsavedTrackUris = [...this.trackUriToFile.keys()]
            .filter(uri => !savedTrackUris.has(uri));
        const unsavedTracks = await this.getTracksByUri(unsavedTrackUris);

        await Promise.all(savedTracks.map(item =>
            this.upsertTrack(item.track, item.sources, true, item.added_at)
        ));

        await Promise.all(unsavedTracks.map(track =>
            this.upsertTrack(track, [], false)
        ));
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

    private async getTracksByUri(trackUris: string[]): Promise<Track[]> {
        return this.batchSpotifyApi(
            trackUris,
            this.TRACKS_BATCH_SIZE,
            (albumUris) => this.spotifyApi.tracks.get(trackUris)
        );
    }

    private async getSavedTracks(options: SyncOptions): Promise<EnrichedTrack[]> {
        const enrichedTracks = new Map<string, EnrichedTrack>();
        const mergeTrack = this.createTrackMerger(enrichedTracks);

        await this.collectLikedSongs(options, mergeTrack);
        await this.collectPlaylistTracks(options, mergeTrack);

        return Array.from(enrichedTracks.values());
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
                const playlistName = this.getPlaylistDisplayName(playlistId);
                playlistedTracks
                    .filter(this.isPlaylistedTrack)
                    .forEach(item => mergeTrack(item, playlistName));
                console.log(`Found ${playlistedTracks.length} tracks from playlist ${playlistName}`);
            } catch (error) {
                console.error(`Failed to get tracks from playlist ${playlistId}:`, error);
            }
        }
    }

    private async getRecentLikedSongs(): Promise<SavedTrack[]> {
        const response = await this.spotifyApi.currentUser.tracks.savedTracks(this.RECENT_SYNC_LIMIT, 0);
        return response.items.filter(item => !this.trackUriToFile.has(item.track.uri));
    }

    private async getRecentPlaylistedTracks(playlistId: string): Promise<PlaylistedTrack[]> {
        const response = await this.spotifyApi.playlists.getPlaylistItems(
            playlistId, 'US', undefined, this.RECENT_SYNC_LIMIT, 0
        );
        return response.items.filter(item => !this.trackUriToFile.has(item.track.uri));
    }

    // FRONTMATTER UPDATES
    private async updateItemFrontmatter(
        file: TFile,
        spotifyEntity: Track | Album | Artist,
        isInSpotifyLibrary: boolean,
        addedAt?: string,
        sources?: string[]
    ): Promise<void> {
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
            const isNew = !frontmatter.created;

            const newCreatedDate = addedAt
                ? moment(addedAt).format('YYYY-MM-DD')
                : moment().format('YYYY-MM-DD');
            if (!frontmatter.created || newCreatedDate < frontmatter.created) {
                frontmatter.created = newCreatedDate;
            }

            frontmatter.modified = moment(addedAt).format('YYYY-MM-DD');

            frontmatter.title = spotifyEntity.name;

            if (this.isTrack(spotifyEntity)) {
                const isNotSingle = !this.isSingle(spotifyEntity.album);
                if (isNotSingle) {
                    const albumFile = this.albumUriToFile.get(spotifyEntity.album.uri);
                    frontmatter.album = albumFile
                        ? this.app.fileManager.generateMarkdownLink(albumFile, this.ALBUMS_PATH, undefined, spotifyEntity.album.name)
                        : spotifyEntity.album.name;
                }
            }

            if (this.isTrack(spotifyEntity) || this.isAlbum(spotifyEntity)) {
                frontmatter.artists = spotifyEntity.artists.map(artist => {
                    const artistFile = this.artistUriToFile.get(artist.uri);
                    return artistFile
                        ? this.app.fileManager.generateMarkdownLink(artistFile, this.ARTISTS_PATH, undefined, artist.name)
                        : artist.name;
                });
            }

            frontmatter.cover = this.getBestImageUrl(
                this.isTrack(spotifyEntity) ? spotifyEntity.album.images : spotifyEntity.images
            );

            if (this.isAlbum(spotifyEntity)) {
                frontmatter.tracks = this.generateAlbumTracksArray(spotifyEntity);
            }

            frontmatter.spotify_library = isInSpotifyLibrary;
            if (this.isTrack(spotifyEntity) && sources) {
                frontmatter.spotify_playlists = sources;
            }

            // TODO
            frontmatter.spotify_id = spotifyEntity.id;
            frontmatter.spotify_url = spotifyEntity.external_urls.spotify;

            if (!frontmatter.aliases) {
                frontmatter.aliases = [spotifyEntity.name];
            }

            // Apply default frontmatter only for new files
            if (isNew) {
                const defaultFrontmatter = this.getDefaultFrontmatter(spotifyEntity);
                Object.assign(frontmatter, defaultFrontmatter);
            }
        });
    }

    private getDefaultFrontmatter(spotifyEntity: Track | Album | Artist): Record<string, any> {
        if (this.isTrack(spotifyEntity)) {
            return this.parseDefaultFrontmatter(this.settings.default_track_frontmatter);
        } else if (this.isAlbum(spotifyEntity)) {
            return this.parseDefaultFrontmatter(this.settings.default_album_frontmatter);
        } else {
            return this.parseDefaultFrontmatter(this.settings.default_artist_frontmatter);
        }
    }

    private parseDefaultFrontmatter(frontmatterText: string): Record<string, any> {
        if (!frontmatterText || frontmatterText.trim() === '') {
            return {};
        }

        try {
            return parseYaml(frontmatterText) || {};
        } catch (error) {
            console.warn('Failed to parse default frontmatter YAML:', error);
            console.warn('Frontmatter text:', frontmatterText);
            return {};
        }
    }

    // URI MAPPING SYSTEM
    private async buildUriMappings(): Promise<void> {
        console.log('Building Spotify URI to file mappings...');

        await this.buildMappingForFolder(this.TRACKS_PATH, this.trackUriToFile);
        await this.buildMappingForFolder(this.ALBUMS_PATH, this.albumUriToFile);
        await this.buildMappingForFolder(this.ARTISTS_PATH, this.artistUriToFile);

        console.log(`Built mappings: ${this.trackUriToFile.size} tracks, ${this.albumUriToFile.size} albums, ${this.artistUriToFile.size} artists`);
    }

    private async buildMappingForFolder(folderPath: string, mapping: Map<string, TFile>): Promise<void> {
        mapping.clear();
        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!(folder instanceof TFolder)) return;

        for (const file of folder.children) {
            if (file instanceof TFile && file.extension === 'md') {
                const spotifyUri = await this.extractSpotifyUriFromFile(file);
                if (spotifyUri) {
                    mapping.set(spotifyUri, file);
                }
            }
        }
    }

    private async extractSpotifyUriFromFile(file: TFile): Promise<string | null> {
        try {
            const metadata = this.app.metadataCache.getFileCache(file);
            // TODO
            return metadata?.frontmatter?.spotify_id || null;
        } catch (error) {
            console.warn(`Failed to read metadata from file ${file.path}:`, error);
            return null;
        }
    }

    // SPOTIFY API PAGINATION HELPERS
    private async getAllLikedSongs(): Promise<SavedTrack[]> {
        return this.paginateSpotifyApi(
            (offset) => this.spotifyApi.currentUser.tracks.savedTracks(this.API_PAGE_SIZE, offset)
        );
    }

    private async getAllPlaylistedTracks(playlistId: string): Promise<PlaylistedTrack[]> {
        return this.paginateSpotifyApi(
            (offset) => this.spotifyApi.playlists.getPlaylistItems(
                playlistId, 'US', undefined, this.API_PAGE_SIZE, offset
            )
        );
    }

    private async getAllSavedAlbums(): Promise<SavedAlbum[]> {
        const savedAlbumsAndSingles = await this.paginateSpotifyApi(
            (offset) => this.spotifyApi.currentUser.albums.savedAlbums(this.API_PAGE_SIZE, offset)
        );

        return savedAlbumsAndSingles
            .filter(item => !this.isSingle(item.album));
    }

    private async getAlbumsByUri(albumUris: string[]): Promise<Album[]> {
        return this.batchSpotifyApi(
            albumUris,
            this.ALBUMS_BATCH_SIZE,
            (albumUris) => this.spotifyApi.albums.get(albumUris)
        );
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

    private async getAllFollowedArtists(): Promise<Artist[]> {
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


    private async getArtistsByUri(artistUris: string[]): Promise<Artist[]> {
        return this.batchSpotifyApi(
            artistUris,
            this.ARTISTS_BATCH_SIZE,
            (artistUris) => this.spotifyApi.artists.get(artistUris)
        );
    }

    // TYPE GUARDS
    private isTrack(item: Track | Album | Artist): item is Track {
        return item.type === 'track';
    }

    private isAlbum(item: Track | Album | Artist): item is Album {
        return item.type === 'album';
    }

    private isPlaylistedTrack(item: PlaylistedTrack): item is PlaylistedTrack<Track> {
        return item.track.type === 'track';
    }

    // FILE AND DATA HELPERS
    private generateTrackFileName(track: Track): string {
        const primaryArtist = track.artists[0]?.name || 'Unknown Artist';
        const isSingle = this.isSingle(track.album);
        return isSingle
            ? this.sanitizeFileName(`${track.name} - ${primaryArtist}`)
            : this.sanitizeFileName(`${track.name} - ${track.album.name} - ${primaryArtist}`);
    }

    private getPlaylistDisplayName(playlistId: string): string {
        return this.settings.playlist_names[playlistId] || playlistId;
    }

    private async upsertTrack(
        track: Track,
        sources: string[],
        isInSpotifyLibrary: boolean,
        addedAt?: string
    ): Promise<void> {
        const fileName = this.generateTrackFileName(track);
        const file = await this.getOrCreateNote(track.uri, fileName, this.TRACKS_PATH, this.trackUriToFile);
        if (file) await this.updateItemFrontmatter(file, track, isInSpotifyLibrary, addedAt, sources);
    }

    private async upsertAlbum(
        album: Album,
        isInSpotifyLibrary: boolean,
        addedAt?: string,
    ): Promise<void> {
        const primaryArtist = album.artists[0]?.name || 'Unknown Artist';
        const fileName = this.sanitizeFileName(`${album.name} - ${primaryArtist}`);
        const file = await this.getOrCreateNote(album.uri, fileName, this.ALBUMS_PATH, this.albumUriToFile);
        if (file) await this.updateItemFrontmatter(file, album, isInSpotifyLibrary, addedAt);
    }

    private async upsertArtist(
        artist: Artist,
        isInSpotifyLibrary: boolean
    ): Promise<void> {
        const fileName = this.sanitizeFileName(artist.name);
        const file = await this.getOrCreateNote(artist.uri, fileName, this.ARTISTS_PATH, this.artistUriToFile);
        if (file) await this.updateItemFrontmatter(file, artist, isInSpotifyLibrary);
    }

    private getBestImageUrl(images: { url: string; width: number; height: number }[], targetSize: number = 300): string {
        if (!images?.length) return '';
        return images.reduce((best, current) => {
            const bestDistance = Math.abs(best.width - targetSize);
            const currentDistance = Math.abs(current.width - targetSize);
            return currentDistance < bestDistance ? current : best;
        }).url;
    }

    private generateAlbumTracksArray(album: Album): string[] {
        return album.tracks.items.map(track => track.name);
    }

    private async markRemovedItemsAsNotInLibrary(uriToFile: Map<string, TFile>, urisInLibrary: string[]): Promise<void> {
        const urisInLibrarySet = new Set(urisInLibrary);
        await Promise.all(
            [...uriToFile.entries()]
                .filter(([uri]) => !urisInLibrarySet.has(uri))
                .map(([, file]) => this.app.fileManager.processFrontMatter(file, (frontmatter) => {
                    frontmatter.spotify_library = false;
                    frontmatter.spotify_playlists = undefined;
                }))
        );
    }

    private sanitizeFileName(name: string): string {
        return name
            .replace(/[<>:"/\\|?*]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private async getOrCreateNote(
        spotifyId: string,
        fileName: string,
        folderPath: string,
        uriToFileMap: Map<string, TFile>
    ): Promise<TFile | null> {
        let file = uriToFileMap.get(spotifyUri);
        if (!file) {
            const filePath = normalizePath(`${folderPath}/${fileName}.md`);
            const existingFile = this.app.vault.getAbstractFileByPath(filePath);
            if (existingFile) {
                console.log(`Skipping creating note - filename conflict at ${filePath}`);
                return null;
            }
            file = await this.app.vault.create(filePath, '---\n---\n\n');
            uriToFileMap.set(spotifyUri, file);
        }
        return file;
    }

    private async ensureDirectoryExists(path: string): Promise<void> {
        const normalizedPath = normalizePath(path);
        const exists = this.app.vault.getAbstractFileByPath(normalizedPath);
        if (!exists) {
            await this.app.vault.createFolder(normalizedPath);
            console.log(`Created directory: ${normalizedPath}`);
        }
    }

    private isSingle(album: SimplifiedAlbum | Album) {
        return album.total_tracks === 1;
    }
}
