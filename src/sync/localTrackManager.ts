import * as jsmediatags from 'jsmediatags';
import { App, normalizePath, TFile } from 'obsidian';
import { ObsidianSpotifySettings } from 'src/settings';


interface TrackMetadata {
    artist: string;
    album: string;
    track: string;
}

export class LocalTrackManager {
    // Map from lookup key (e.g. "Artist | Album | Track" to file)
    private trackCache: Map<string, TFile> | undefined = undefined;
    private scanInProgress: Promise<void> | undefined;

    constructor(
        private app: App,
        private settings: ObsidianSpotifySettings
    ) { }

    private get musicFolderPath() {
        return this.settings.local_music_files_path;
    }

    async findTrackFile(spotifyUri: string): Promise<TFile | undefined> {
        const lookupKey = this.parseSpotifyLocalUriToLookupKey(spotifyUri);

        if (!lookupKey) {
            return;
        }

        const cache = await this.getTrackCache();
        return cache.get(lookupKey);
    }

    private async getTrackCache(): Promise<Map<string, TFile>> {
        if (this.trackCache == null) {
            await this.scanLibrary();
        }
        return this.trackCache!;
    }

    private async scanLibrary(): Promise<void> {
        if (this.scanInProgress) {
            return this.scanInProgress;
        }

        if (!this.musicFolderPath?.trim()) {
            console.log('No music folder path configured');
            return;
        }

        this.trackCache = new Map();

        const normalizedPath = normalizePath(this.musicFolderPath);
        this.scanInProgress = this.scanFolder(normalizedPath);

        try {
            await this.scanInProgress;
        } finally {
            this.scanInProgress = undefined;
        }
    }

    private async scanFolder(folderPath: string): Promise<void> {
        const contents = await this.app.vault.adapter.list(folderPath);

        // Cache audio files in this folder
        await Promise.all(contents.files.map(filePath => {
            return this.isAudioFile(filePath) && this.cacheTrack(filePath)
        }));

        // Recursively scan subfolders
        await Promise.all(contents.folders.map(dir => this.scanFolder(dir)));
    }

    private isAudioFile(path: string): boolean {
        const audioExtensions = ['.mp3', '.flac', '.m4a', '.wav', '.ogg', '.opus', '.aac', '.wma'];
        return audioExtensions.some(ext => path.toLowerCase().endsWith(ext));
    }

    private async extractMetadata(filePath: string): Promise<TrackMetadata | undefined> {
        const arrayBuffer = await this.app.vault.adapter.readBinary(filePath);

        return new Promise((resolve) => {
            jsmediatags.read(new Blob([arrayBuffer]), {
                onSuccess: (tag) => {
                    resolve({
                        artist: tag.tags.artist || '',
                        album: tag.tags.album || '',
                        track: tag.tags.title || ''
                    });
                },
                onError: (error) => {
                    console.warn(`Failed to extract metadata from ${filePath}:`, error);
                    resolve(undefined);
                }
            });
        });
    }

    private async cacheTrack(filePath: string): Promise<void> {
        const fileName = filePath.split('/').at(-1);
        if (!fileName || !this.trackCache) return;

        const metadata = await this.extractMetadata(filePath);

        if (!metadata) {
            return;
        }

        const lookupKey = this.buildLookupKey(metadata.artist, metadata.album, metadata.track);
        const file = this.app.vault.getFileByPath(filePath);

        if (file) {
            this.trackCache.set(lookupKey, file);
        }
    }

    private parseSpotifyLocalUriToLookupKey(spotifyLocalUri: string): string | undefined {
        if (!spotifyLocalUri.startsWith('spotify:local:')) {
            return undefined;
        }

        // Parse: spotify:local:artist:album:track:duration
        const parts = spotifyLocalUri.replace('spotify:local:', '').split(':');
        if (parts.length < 4) return undefined;

        const [artist, album, track] = parts;

        // Replace + with spaces, then decode URI components
        const decodeSpotifyField = (str: string) => {
            return decodeURIComponent(str.replace(/\+/g, ' '));
        };

        return this.buildLookupKey(
            decodeSpotifyField(artist),
            decodeSpotifyField(album),
            decodeSpotifyField(track)
        );
    }

    private buildLookupKey(artist: string, album: string, track: string): string {
        const normalize = (str: string) =>
            str.toLowerCase()
                .replace(/[^\w\s]/g, '')
                .replace(/\s+/g, ' ')
                .trim();

        return `${normalize(artist)}|${normalize(album)}|${normalize(track)}`;
    }
}
