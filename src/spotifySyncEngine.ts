import { App, TFile, TFolder, Notice, normalizePath } from 'obsidian';
import { SpotifyApi } from '@spotify/web-api-ts-sdk';
import type { Album, Artist, SimplifiedArtist, Track } from '@spotify/web-api-ts-sdk';
import { ObsidianSpotifySettings } from './settings';

export class SpotifySyncEngine {
    private app: App;
    private spotifyApi: SpotifyApi;
    private settings: ObsidianSpotifySettings;
    private readonly ARTISTS_PATH: string;
    private readonly ALBUMS_PATH: string;

    constructor(app: App, spotifyApi: SpotifyApi, settings: ObsidianSpotifySettings) {
        this.app = app;
        this.spotifyApi = spotifyApi;
        this.settings = settings;
        this.ARTISTS_PATH = `${settings.music_catalog_base_path}/${settings.artists_path}`;
        this.ALBUMS_PATH = `${settings.music_catalog_base_path}/${settings.albums_path}`;
    }

    async syncAll(): Promise<void> {
        try {
            new Notice('Starting Spotify sync...');

            await this.ensureDirectoryExists(this.ARTISTS_PATH);
            await this.ensureDirectoryExists(this.ALBUMS_PATH);

            await this.syncAlbums();
            await this.syncArtists();

            new Notice('Spotify sync completed successfully!');
        } catch (error) {
            console.error('Spotify sync failed:', error);
            new Notice('Spotify sync failed. Check console for details.');
        }
    }

    private async syncAlbums(): Promise<void> {
        console.log('Syncing albums...');

        const savedAlbums = await this.getAllSavedAlbums();
        const albumIds = new Set(savedAlbums.map(album => album.id));

        for (const album of savedAlbums) {
            const fullAlbum = await this.spotifyApi.albums.get(album.id);
            await this.createOrUpdateAlbumNote(fullAlbum, true);
        }

        await this.updateUnsavedAlbums(albumIds);
    }

    private async syncArtists(): Promise<void> {
        console.log('Syncing artists...');

        const followedArtists = await this.getAllFollowedArtists();
        const artistIds = new Set(followedArtists.map(artist => artist.id));

        for (const artist of followedArtists) {
            await this.createOrUpdateArtistNote(artist, true);
        }

        await this.updateUnfollowedArtists(artistIds);
    }

    private async getAllSavedAlbums(): Promise<Album[]> {
        const albums: Album[] = [];
        let offset = 0;
        const limit = 50;

        while (true) {
            const response = await this.spotifyApi.currentUser.albums.savedAlbums(limit, offset);
            albums.push(...response.items.map(item => item.album));

            if (response.items.length < limit) break;
            offset += limit;
        }

        return albums;
    }

    private async getAllFollowedArtists(): Promise<Artist[]> {
        const artists: Artist[] = [];
        let after: string | undefined = undefined;
        const limit = 50;

        while (true) {
            const response = await this.spotifyApi.currentUser.followedArtists(after, limit);
            artists.push(...response.artists.items);

            // Check if we have more items to fetch
            if (response.artists.items.length < limit || !response.artists.next) {
                break;
            }

            // Extract the 'after' cursor from the next URL
            // The next URL contains the after parameter we need
            if (response.artists.next) {
                const nextUrl = new URL(response.artists.next);
                after = nextUrl.searchParams.get('after') || undefined;
            }

            // If we can't get the after parameter, break to avoid infinite loop
            if (!after) break;
        }

        return artists;
    }

    private async createOrUpdateAlbumNote(album: Album, isSaved: boolean): Promise<void> {
        const primaryArtist = album.artists[0]?.name || 'Unknown Artist';
        const fileName = this.sanitizeFileName(`${album.name} - ${primaryArtist}`);
        const filePath = normalizePath(`${this.ALBUMS_PATH}/${fileName}.md`);

        const existingFile = this.app.vault.getAbstractFileByPath(filePath);

        if (existingFile instanceof TFile) {
            await this.updateAlbumNote(existingFile, album, isSaved);
        } else {
            await this.createAlbumNote(filePath, album, isSaved);
        }
    }

    private async createOrUpdateArtistNote(artist: Artist, isFollowed: boolean): Promise<void> {
        const fileName = this.sanitizeFileName(artist.name);
        const filePath = normalizePath(`${this.ARTISTS_PATH}/${fileName}.md`);

        const existingFile = this.app.vault.getAbstractFileByPath(filePath);

        if (existingFile instanceof TFile) {
            await this.updateArtistNote(existingFile, artist, isFollowed);
        } else {
            await this.createArtistNote(filePath, artist, isFollowed);
        }
    }

    private async createAlbumNote(filePath: string, album: Album, isSaved: boolean): Promise<void> {
        const frontmatter = this.generateAlbumFrontmatter(album, isSaved);
        const content = this.generateAlbumContent(album);
        const fullContent = `${frontmatter}\n\n${content}`;

        await this.app.vault.create(filePath, fullContent);
        console.log(`Created album note: ${album.name}`);
    }

    private async createArtistNote(filePath: string, artist: Artist, isFollowed: boolean): Promise<void> {
        const frontmatter = this.generateArtistFrontmatter(artist, isFollowed);
        const content = this.generateArtistContent(artist);
        const fullContent = `${frontmatter}\n\n${content}`;

        await this.app.vault.create(filePath, fullContent);
        console.log(`Created artist note: ${artist.name}`);
    }

    private async updateAlbumNote(file: TFile, album: Album, isSaved: boolean): Promise<void> {
        const content = await this.app.vault.read(file);
        const updatedContent = this.updateAlbumFrontmatter(content, album, isSaved);

        if (updatedContent !== content) {
            await this.app.vault.modify(file, updatedContent);
            console.log(`Updated album note: ${album.name}`);
        }
    }

    private async updateArtistNote(file: TFile, artist: Artist, isFollowed: boolean): Promise<void> {
        const content = await this.app.vault.read(file);
        const updatedContent = this.updateArtistFrontmatter(content, artist, isFollowed);

        if (updatedContent !== content) {
            await this.app.vault.modify(file, updatedContent);
            console.log(`Updated artist note: ${artist.name}`);
        }
    }

    private async updateUnsavedAlbums(savedAlbumIds: Set<string>): Promise<void> {
        const albumsFolder = this.app.vault.getAbstractFileByPath(this.ALBUMS_PATH);
        if (!(albumsFolder instanceof TFolder)) return;

        for (const file of albumsFolder.children) {
            if (file instanceof TFile && file.extension === 'md') {
                const content = await this.app.vault.read(file);
                const spotifyId = this.extractSpotifyId(content);

                if (spotifyId && !savedAlbumIds.has(spotifyId)) {
                    const updatedContent = this.updateSavedStatus(content, false);
                    if (updatedContent !== content) {
                        await this.app.vault.modify(file, updatedContent);
                        console.log(`Updated unsaved album: ${file.basename}`);
                    }
                }
            }
        }
    }

    private async updateUnfollowedArtists(followedArtistIds: Set<string>): Promise<void> {
        const artistsFolder = this.app.vault.getAbstractFileByPath(this.ARTISTS_PATH);
        if (!(artistsFolder instanceof TFolder)) return;

        for (const file of artistsFolder.children) {
            if (file instanceof TFile && file.extension === 'md') {
                const content = await this.app.vault.read(file);
                const spotifyId = this.extractSpotifyId(content);

                if (spotifyId && !followedArtistIds.has(spotifyId)) {
                    const updatedContent = this.updateFollowedStatus(content, false);
                    if (updatedContent !== content) {
                        await this.app.vault.modify(file, updatedContent);
                        console.log(`Updated unfollowed artist: ${file.basename}`);
                    }
                }
            }
        }
    }

    private generateAlbumFrontmatter(album: Album, isSaved: boolean): string {
        const artists = album.artists.map(artist => artist.name).join(', ');
        const primaryArtist = album.artists[0]?.name || 'Unknown Artist';
        const artistLink = `"[[${this.ARTISTS_PATH}/${this.sanitizeFileName(primaryArtist)}]]"`;
        const genres = album.genres?.join(', ') || '';

        return `---
name: "${album.name}"
type: album
spotify_id: "${album.id}"
spotify_uri: "${album.uri}"
spotify_url: "${album.external_urls.spotify}"
artists: "${artists}"
primary_artist: ${artistLink}
release_date: "${album.release_date}"
total_tracks: ${album.total_tracks}
genres: "${genres}"
popularity: ${album.popularity || 0}
is_saved: ${isSaved}
last_synced: "${new Date().toISOString()}"
---`;
    }

    private generateArtistFrontmatter(artist: Artist, isFollowed: boolean): string {
        const genres = artist.genres.join(', ');

        return `---
name: "${artist.name}"
type: artist
spotify_id: "${artist.id}"
spotify_uri: "${artist.uri}"
spotify_url: "${artist.external_urls.spotify}"
genres: "${genres}"
popularity: ${artist.popularity}
followers: ${artist.followers.total}
is_followed: ${isFollowed}
last_synced: "${new Date().toISOString()}"
---`;
    }

    private generateAlbumContent(album: Album): string {
        const primaryArtist = album.artists[0]?.name || 'Unknown Artist';
        const artists = album.artists.map(artist => `[[${this.sanitizeFileName(artist.name)}]]`).join(', ');

        let tracksSection = '## Tracks\n\n';
        if (album.tracks && album.tracks.items) {
            album.tracks.items.forEach((track, index) => {
                tracksSection += `### ${index + 1}. ${track.name}\n\n`;
            });
        } else {
            tracksSection += '<!-- Track list will be populated when available -->\n\n';
        }

        return `# ${album.name} - ${primaryArtist}

**Artists:** ${artists}
**Release Date:** ${album.release_date}
**Total Tracks:** ${album.total_tracks}

${tracksSection}## Notes
<!-- Your notes about this album -->`;
    }

    private generateArtistContent(artist: Artist): string {
        return `# ${artist.name}

**Genres:** ${artist.genres.join(', ')}
**Popularity:** ${artist.popularity}/100
**Followers:** ${artist.followers.total.toLocaleString()}

## Biography
<!-- Artist biography and information -->

## Albums
<!-- Links to artist's albums will appear here -->

## Notes
<!-- Your notes about this artist -->`;
    }

    private updateAlbumFrontmatter(content: string, album: Album, isSaved: boolean): string {
        // Update specific frontmatter fields while preserving user content
        let updatedContent = content;

        updatedContent = this.updateFrontmatterField(updatedContent, 'spotify_url', album.external_urls.spotify);
        updatedContent = this.updateFrontmatterField(updatedContent, 'popularity', album.popularity?.toString() || '0');
        updatedContent = this.updateFrontmatterField(updatedContent, 'is_saved', isSaved.toString());
        updatedContent = this.updateFrontmatterField(updatedContent, 'last_synced', new Date().toISOString());

        const primaryArtist = album.artists[0]?.name || 'Unknown Artist';
        const artistLink = `[[${this.sanitizeFileName(primaryArtist)}]]`;
        updatedContent = this.updateFrontmatterField(updatedContent, 'primary_artist', artistLink);

        return updatedContent;
    }

    private updateArtistFrontmatter(content: string, artist: Artist, isFollowed: boolean): string {
        let updatedContent = content;

        updatedContent = this.updateFrontmatterField(updatedContent, 'spotify_url', artist.external_urls.spotify);
        updatedContent = this.updateFrontmatterField(updatedContent, 'popularity', artist.popularity.toString());
        updatedContent = this.updateFrontmatterField(updatedContent, 'followers', artist.followers.total.toString());
        updatedContent = this.updateFrontmatterField(updatedContent, 'is_followed', isFollowed.toString());
        updatedContent = this.updateFrontmatterField(updatedContent, 'last_synced', new Date().toISOString());

        return updatedContent;
    }

    private updateFrontmatterField(content: string, field: string, value: string): string {
        const regex = new RegExp(`^${field}:.*$`, 'm');
        const replacement = field === 'primary_artist' ? `${field}: ${value}` : `${field}: "${value}"`;

        if (regex.test(content)) {
            return content.replace(regex, replacement);
        } else {
            // Add field if it doesn't exist
            const frontmatterEndIndex = content.indexOf('---', 3);
            if (frontmatterEndIndex !== -1) {
                const beforeEnd = content.substring(0, frontmatterEndIndex);
                const afterEnd = content.substring(frontmatterEndIndex);
                return `${beforeEnd}${replacement}\n${afterEnd}`;
            }
        }

        return content;
    }

    private updateSavedStatus(content: string, isSaved: boolean): string {
        return this.updateFrontmatterField(content, 'is_saved', isSaved.toString());
    }

    private updateFollowedStatus(content: string, isFollowed: boolean): string {
        return this.updateFrontmatterField(content, 'is_followed', isFollowed.toString());
    }

    private extractSpotifyId(content: string): string | null {
        const match = content.match(/^spotify_id:\s*"([^"]+)"$/m);
        return match ? match[1] : null;
    }

    private sanitizeFileName(name: string): string {
        // Remove or replace characters that aren't allowed in file names
        return name
            .replace(/[<>:"/\\|?*]/g, '') // Remove invalid characters
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
    }

    private async ensureDirectoryExists(path: string): Promise<void> {
        const normalizedPath = normalizePath(path);
        const exists = this.app.vault.getAbstractFileByPath(normalizedPath);

        if (!exists) {
            await this.app.vault.createFolder(normalizedPath);
            console.log(`Created directory: ${normalizedPath}`);
        }
    }
}
