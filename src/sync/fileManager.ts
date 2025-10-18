import { App, TFile, TFolder, normalizePath } from 'obsidian';

export class FileManager {
    private trackUriToFile = new Map<string, TFile>();
    private albumUriToFile = new Map<string, TFile>();
    private artistUriToFile = new Map<string, TFile>();

    constructor(
        private app: App,
        private artistsPath: string,
        private albumsPath: string,
        private tracksPath: string
    ) { }

    getTrackUriToFile(): Map<string, TFile> {
        return this.trackUriToFile;
    }

    getAlbumUriToFile(): Map<string, TFile> {
        return this.albumUriToFile;
    }

    getArtistUriToFile(): Map<string, TFile> {
        return this.artistUriToFile;
    }

    async buildUriMappings(): Promise<void> {
        console.log('Building Spotify URI to file mappings...');

        await this.buildMappingForFolder(this.tracksPath, this.trackUriToFile);
        await this.buildMappingForFolder(this.albumsPath, this.albumUriToFile);
        await this.buildMappingForFolder(this.artistsPath, this.artistUriToFile);

        console.log(`Built mappings: ${this.trackUriToFile.size} tracks, ${this.albumUriToFile.size} albums, ${this.artistUriToFile.size} artists`);
    }

    async buildMappingForFolder(folderPath: string, mapping: Map<string, TFile>): Promise<void> {
        mapping.clear();
        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!(folder instanceof TFolder)) return;

        for (const file of folder.children) {
            if (file instanceof TFile && file.extension === 'md') {
                const spotifyUri = this.extractSpotifyUriFromFile(file);
                if (spotifyUri) {
                    mapping.set(spotifyUri, file);
                }
            }
        }
    }

    extractSpotifyUriFromFile(file: TFile): string | null {
        try {
            const metadata = this.app.metadataCache.getFileCache(file);
            return metadata?.frontmatter?.music_ids?.spotify_uri || null;
        } catch (error) {
            console.warn(`Failed to read metadata from file ${file.path}:`, error);
            return null;
        }
    }

    extractSpotifyIdFromFile(file: TFile): string | null {
        try {
            const metadata = this.app.metadataCache.getFileCache(file);
            return metadata?.frontmatter?.music_ids?.spotify_id || null;
        } catch (error) {
            console.warn(`Failed to read metadata from file ${file.path}:`, error);
            return null;
        }
    }

    async getOrCreateNote(
        spotifyUri: string,
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

    async ensureDirectoryExists(path: string): Promise<void> {
        const normalizedPath = normalizePath(path);
        const exists = this.app.vault.getAbstractFileByPath(normalizedPath);
        if (!exists) {
            await this.app.vault.createFolder(normalizedPath);
            console.log(`Created directory: ${normalizedPath}`);
        }
    }
}
