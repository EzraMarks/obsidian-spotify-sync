import { App, Notice } from 'obsidian';
import { ObsidianSpotifySettings } from '../settings';
import { FileManager } from './FileManager';
import { MusicFile, MusicEntity, Artist, Album, Track } from './types';
import { MusicLibrarySource } from './music-sources/MusicLibrarySource';
import { MusicIdIndex } from './MusicIdIndex';
import { MusicMetadataEnricher } from './MusicMetadataEnricher';
import { MusicFrontmatter } from './frontmatterTypes';

export class SyncEngine {
    private readonly fileManager: FileManager;
    private readonly metadataEnricher: MusicMetadataEnricher;

    constructor(
        private app: App,
        private settings: ObsidianSpotifySettings,
        private musicLibrarySource: MusicLibrarySource
    ) {

        this.fileManager = new FileManager(this.app, this.settings);
        this.metadataEnricher = new MusicMetadataEnricher(
            this.app,
            this.settings,
            this.musicLibrarySource
        );
    }

    async fullSync(): Promise<void> {
        try {
            new Notice('Starting full sync...');

            await this.fileManager.ensureDirectoryExists(this.fileManager.artistsPath);
            await this.fileManager.ensureDirectoryExists(this.fileManager.albumsPath);
            await this.fileManager.ensureDirectoryExists(this.fileManager.tracksPath);

            // Freshen existing files
            const artistFiles = await this.freshenArtists();
            const albumFiles = await this.freshenAlbums();
            const trackFiles = await this.freshenTracks();

            // Fetch all library entities (music saved in streaming service or local library)
            const savedArtists = await this.musicLibrarySource.getSavedArtists({});
            const savedAlbums = await this.musicLibrarySource.getSavedAlbums({});
            const savedTracks = await this.musicLibrarySource.getSavedTracks({});

            // Ingest new entities
            await this.ingestNewArtists(savedArtists);
            await this.ingestNewAlbums(savedAlbums);
            await this.ingestNewTracks(savedTracks);

            // Update the library status of all files
            await this.updateLibraryStatus(savedArtists, artistFiles);
            await this.updateLibraryStatus(savedAlbums, albumFiles);
            await this.updateLibraryStatus(savedTracks, trackFiles);

            new Notice('Full sync completed successfully!');
        } catch (error) {
            console.error('Full sync failed:', error);
            new Notice('Full sync failed. Check console for details.');
        }
    }

    async incrementalSync(silent?: boolean): Promise<void> {
        try {
            new Notice('Starting incremental sync...');

            await this.fileManager.ensureDirectoryExists(this.fileManager.artistsPath);
            await this.fileManager.ensureDirectoryExists(this.fileManager.albumsPath);
            await this.fileManager.ensureDirectoryExists(this.fileManager.tracksPath);

            // For efficiency of the incremental sync, we skip any freshening of existing files

            // Fetch all recently-saved library entities
            const savedArtists = await this.musicLibrarySource.getSavedArtists({ recentOnly: true });
            const savedAlbums = await this.musicLibrarySource.getSavedAlbums({ recentOnly: true });
            const savedTracks = await this.musicLibrarySource.getSavedTracks({ recentOnly: true });

            // Only ingest new entities
            await this.ingestNewArtists(savedArtists);
            await this.ingestNewAlbums(savedAlbums);
            await this.ingestNewTracks(savedTracks);

            new Notice('Incremental sync completed successfully!');
        } catch (error) {
            if (!silent) {
                console.error('Incremental sync failed:', error);
                new Notice('Incremental sync failed. Check console for details.');
            }
        }
    }

    private async freshenArtists(): Promise<MusicFile<Artist>[]> {
        const index = await this.fileManager.getArtistIndex();
        return await this.freshenFiles(
            index.values(),
            entities => this.metadataEnricher.enrichArtists(entities),
            updatedFile => this.fileManager.updateArtistFile(updatedFile),
            "artist"
        );
    }

    private async freshenAlbums(): Promise<MusicFile<Album>[]> {
        const index = await this.fileManager.getAlbumIndex();
        return await this.freshenFiles(
            index.values(),
            entities => this.metadataEnricher.enrichAlbums(entities),
            updatedFile => this.fileManager.updateAlbumFile(updatedFile),
            "album"
        );
    }

    private async freshenTracks(): Promise<MusicFile<Track>[]> {
        const index = await this.fileManager.getTrackIndex();
        return await this.freshenFiles(
            index.values(),
            entities => this.metadataEnricher.enrichTracks(entities),
            updatedFile => this.fileManager.updateTrackFile(updatedFile),
            "track"
        );
    }

    private async freshenFiles<T extends MusicEntity>(
        files: MusicFile<T>[],
        enrichEntities: (unenriched: T[]) => Promise<T[]>,
        updateFile: (enrichedFile: MusicFile<T>) => Promise<void>,
        entityName: string,
    ): Promise<MusicFile<T>[]> {
        console.log(`Freshening ${files.length} ${entityName} files...`);

        const musicEntities = files.map(item => {
            const { file, ...rest } = item;
            return rest as unknown as T;
        });

        const enrichedEntities = await enrichEntities(musicEntities);

        return await Promise.all(
            files.map(async (file, index) => {
                const original = musicEntities[index];
                const enriched = enrichedEntities[index];

                // Only update if metadata changed
                if (this.entitiesAreEqual(original, enriched)) {
                    return file;
                }

                const enrichedFile: MusicFile<T> = { ...file, ...enriched };
                await updateFile(enrichedFile);
                return enrichedFile;
            })
        );
    }

    private async ingestNewArtists(savedEntities: Artist[]): Promise<void> {
        await this.ingestNewEntities(
            savedEntities,
            () => this.fileManager.getArtistIndex(),
            entities => this.metadataEnricher.enrichArtists(entities),
            entity => this.fileManager.createArtistFile(entity),
            "artist"
        );
    }

    private async ingestNewAlbums(savedEntities: Album[]): Promise<void> {
        await this.ingestNewEntities(
            savedEntities,
            () => this.fileManager.getAlbumIndex(),
            entities => this.metadataEnricher.enrichAlbums(entities),
            entity => this.fileManager.createAlbumFile(entity),
            "album"
        );
    }

    private async ingestNewTracks(savedEntities: Track[]): Promise<void> {
        await this.ingestNewEntities(
            savedEntities,
            () => this.fileManager.getTrackIndex(),
            entities => this.metadataEnricher.enrichTracks(entities),
            entity => this.fileManager.createTrackFile(entity),
            "track"
        );
    }

    private async ingestNewEntities<T extends MusicEntity>(
        savedEntities: T[],
        getExistingIndex: () => Promise<MusicIdIndex<MusicFile<MusicEntity>>>,
        enrichEntities: (entities: T[]) => Promise<T[]>,
        createFile: (entity: T) => Promise<void>,
        entityName: string
    ): Promise<void> {
        console.log(`Fetching new ${entityName}s from streaming service...`);

        const existingFileIndex = await getExistingIndex();

        const newEntities = savedEntities.filter(
            entity => !existingFileIndex.has(entity.ids)
        );

        console.log(`Found ${newEntities.length} new ${entityName}s`);

        const enrichedEntities = await enrichEntities(newEntities);

        await Promise.all(enrichedEntities.map(entity => {
            entity.sources.in_library = true;
            createFile(entity);
        }));
    }

    /**
     * Compares two music entities for equality, excluding the 'file' property
     * that causes circular references
     */
    private entitiesAreEqual<T extends MusicEntity>(entity1: T, entity2: T): boolean {
        const clean = (obj: any): any => {
            if (!obj || typeof obj !== 'object') return obj;
            if (Array.isArray(obj)) return obj.map(clean);
            if (obj._isAMomentObject) return obj.toISOString();

            const { file, ...rest } = obj;
            return Object.fromEntries(
                Object.entries(rest).map(([k, v]) => [k, clean(v)])
            );
        };

        try {
            return JSON.stringify(clean(entity1)) === JSON.stringify(clean(entity2));
        } catch {
            return false;
        }
    }

    /**
     * Updates the status of every file to reflect whether that entity is saved (favorited) in the library source.
     */
    private async updateLibraryStatus<T extends MusicEntity>(
        savedEntities: T[],
        files: MusicFile<T>[]
    ) {
        const savedEntitiesIndex = new MusicIdIndex(savedEntities, entity => entity.ids);

        Promise.all(
            files.map(file => {
                file.sources.in_library = savedEntitiesIndex.has(file.ids);
                this.app.fileManager.processFrontMatter(
                    file.file,
                    (fm: MusicFrontmatter) => {
                        fm.music_sources.in_library = file.sources.in_library
                    }
                )
            })
        );
    }
}
