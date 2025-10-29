import { App, TFile, TFolder, normalizePath } from 'obsidian';
import { LocalTrackManager } from './LocalTrackManager';
import { ObsidianSpotifySettings } from '../settings';
import { MusicIdIndex } from './MusicIdIndex';
import { FrontmatterWriter } from './FrontmatterWriter';
import { FrontmatterReader } from './FrontmatterReader';
import { Album, Artist, SimplifiedAlbum, SimplifiedArtist, Track } from "./types";
import { MusicEntity, MusicFile } from './types';

export class FileManager {
    private readonly frontmatterReader: FrontmatterReader;
    private readonly frontmatterWriter: FrontmatterWriter;

    constructor(
        private app: App,
        private settings: ObsidianSpotifySettings
    ) {
        this.frontmatterReader = new FrontmatterReader(this.app);
        this.frontmatterWriter = new FrontmatterWriter(
            this.app,
            this.settings,
            (artist) => this.generateArtistLink(artist),
            (album) => this.generateAlbumLink(album)
        );
    }

    get artistsPath(): string {
        return `${this.settings.music_catalog_base_path}/${this.settings.artists_path}`;
    }

    get albumsPath(): string {
        return `${this.settings.music_catalog_base_path}/${this.settings.albums_path}`;
    }

    get tracksPath(): string {
        return `${this.settings.music_catalog_base_path}/${this.settings.tracks_path}`;
    }

    async ensureDirectoryExists(path: string): Promise<void> {
        const normalizedPath = normalizePath(path);
        const exists = this.app.vault.getAbstractFileByPath(normalizedPath);
        if (!exists) {
            await this.app.vault.createFolder(normalizedPath);
            console.log(`Created directory: ${normalizedPath}`);
        }
    }

    private artistIndex?: MusicIdIndex<MusicFile<Artist>>;
    async getArtistIndex(): Promise<MusicIdIndex<MusicFile<Artist>>> {
        if (!this.artistIndex) {
            this.artistIndex = await this.buildIndex(
                this.artistsPath,
                file => this.frontmatterReader.parseArtistFile(file)
            );
        }
        return this.artistIndex;
    }

    private albumIndex?: MusicIdIndex<MusicFile<Album>>;
    async getAlbumIndex(): Promise<MusicIdIndex<MusicFile<Album>>> {
        if (!this.albumIndex) {
            this.albumIndex = await this.buildIndex(
                this.albumsPath,
                file => this.frontmatterReader.parseAlbumFile(file)
            );
        }
        return this.albumIndex;
    }

    private trackIndex?: MusicIdIndex<MusicFile<Track>>;
    async getTrackIndex(): Promise<MusicIdIndex<MusicFile<Track>>> {
        if (!this.trackIndex) {
            this.trackIndex = await this.buildIndex(
                this.tracksPath,
                file => this.frontmatterReader.parseTrackFile(file)
            );
        }
        return this.trackIndex;
    }

    private async buildIndex<T extends MusicEntity>(
        folderPath: string,
        parseFile: (file: TFile) => MusicFile<T> | undefined
    ): Promise<MusicIdIndex<MusicFile<T>>> {
        const files = this.getFilesInFolder(folderPath);
        const entityFiles: MusicFile<T>[] = files.flatMap(file => {
            const entityFile = parseFile(file);
            return entityFile ? [entityFile] : [];
        });
        return MusicIdIndex.fromItems(entityFiles);
    }

    private getFilesInFolder(folderPath: string): TFile[] {
        const folder = this.app.vault.getFolderByPath(folderPath);

        return (folder?.children ?? [])
            .filter((file): file is TFile => file instanceof TFile && file.extension === "md");
    }

    async updateArtistFile(artist: MusicFile<Artist>): Promise<void> {
        const index = await this.getArtistIndex();
        index.set(artist.ids, artist);

        await this.frontmatterWriter.updateArtistFrontmatter(artist);
    }

    async updateAlbumFile(album: MusicFile<Album>): Promise<void> {
        const index = await this.getAlbumIndex();
        index.set(album.ids, album);

        await this.frontmatterWriter.updateAlbumFrontmatter(album);
    }

    async updateTrackFile(track: MusicFile<Track>): Promise<void> {
        const index = await this.getTrackIndex();
        index.set(track.ids, track);

        await this.frontmatterWriter.updateTrackFrontmatter(track);
    }

    async createArtistFile(artist: Artist): Promise<void> {
        const fileName = this.buildSafeFileName(artist.title);

        const file = await this.createFile(
            fileName,
            this.artistsPath
        );

        this.updateArtistFile({ file, ...artist });
    }

    async createAlbumFile(album: Album): Promise<void> {
        const primaryArtist = album.artists[0]?.title || "Unknown Artist";
        const fileName = this.buildSafeFileName(album.title, primaryArtist);

        const file = await this.createFile(
            fileName,
            this.albumsPath
        );

        this.updateAlbumFile({ file, ...album });
    }

    async createTrackFile(track: Track): Promise<void> {
        const primaryArtist = track.artists[0]?.title || "Unknown Artist";
        const fileName = this.buildSafeFileName(track.title, track.album?.title, primaryArtist);

        const file = await this.createFile(
            fileName,
            this.tracksPath
        );

        this.updateTrackFile({ file, ...track });
    }

    async createFile(
        fileName: string,
        folderPath: string
    ): Promise<TFile> {
        let finalName = fileName;
        let counter = 1;

        // If the name is not unique, append a number
        while (this.app.vault.getAbstractFileByPath(`${folderPath}/${finalName}.md`)) {
            finalName = `${fileName} (${counter})`;
            counter++;
        }

        const filePath = `${folderPath}/${finalName}.md`;
        return await this.app.vault.create(filePath, '---\n---\n\n');
    }

    /**
     * Combines non-empty strings into a safe filename, joined with " - "
     * @example buildSafeFileName("Song Name", "Album", "Artist") => "Song Name - Album - Artist"
     */
    buildSafeFileName(...parts: (string | undefined)[]): string {
        return parts
            .filter((part): part is string => !!part && !!part.trim())
            .map(part => part
                .replace(/[<>:"/\\|?*-]/g, '')
                .replace(/\s+/g, ' ')
                .trim()
            )
            .join(' - ');
    }

    private async generateArtistLink(artist: SimplifiedArtist): Promise<string> {
        const index = await this.getArtistIndex();
        const artistFile = index.get(artist.ids);
        return this.generateEntityLink(artistFile, artist.title);
    }

    private async generateAlbumLink(album: SimplifiedAlbum): Promise<string> {
        const index = await this.getAlbumIndex();
        const albumFile = index.get(album.ids);
        return this.generateEntityLink(albumFile, album.title);
    }

    private generateEntityLink(
        musicFile: MusicFile<MusicEntity> | undefined,
        displayTitle: string
    ): string {
        if (!musicFile) {
            return displayTitle;
        }

        const pathParts = musicFile.file.path.split("/");
        const basePathParts = this.settings.music_catalog_base_path.split("/").filter(s => !!s);

        const relativePath = pathParts
            // Skip base path segments except the leaf (e.g., "root/parent/" → keep "parent" onwards)
            .slice(basePathParts.length - 1)
            .join("/")
            .replace(/\.md$/, "");

        return `[[${relativePath}|${displayTitle}]]`;
    }
}
