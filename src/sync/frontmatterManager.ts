import { App, TFile, moment, parseYaml } from 'obsidian';
import type { Track, Album, Artist } from '@spotify/web-api-ts-sdk';
import { ObsidianSpotifySettings } from '../settings';
import { SpotifyDataHelpers } from './spotifyDataHelpers';
import { FileManager } from './fileManager';

class MusicFrontmatter {
    created?: string = undefined;
    modified?: string = undefined;
    title?: string = undefined;
    album?: string = undefined;
    artists?: string[] = undefined;
    cover?: string = undefined;
    tracks?: string[] = undefined;
    spotify_library?: boolean = undefined;
    spotify_playlists?: string[] = undefined;
    music_ids: MusicIdsFrontmatter = new MusicIdsFrontmatter();
    music_sources: MusicSourcesFrontmatter = new MusicSourcesFrontmatter();
    aliases?: string[] = undefined;
}

class MusicIdsFrontmatter {
    spotify_id?: string = undefined;
    spotify_uri?: string = undefined;
    mbid?: string = undefined;
}

class MusicSourcesFrontmatter {
    spotify?: string = undefined;
    local?: string = undefined;
    online?: string[] = undefined;
}

export class FrontmatterManager {
    constructor(
        private app: App,
        private settings: ObsidianSpotifySettings,
        private dataHelpers: SpotifyDataHelpers,
        private fileManager: FileManager,
        private artistsPath: string,
        private albumsPath: string
    ) { }

    async updateItemFrontmatter(
        file: TFile,
        spotifyEntity: Track | Album | Artist,
        isInSpotifyLibrary: boolean,
        addedAt?: string,
        sources?: string[]
    ): Promise<void> {
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
            const isNew = !frontmatter.created;
            const musicFrontmatter = Object.assign(new MusicFrontmatter(), frontmatter);
            const before = this.createSnapshot(musicFrontmatter);

            // Update all fields
            this.updateCommonFrontmatter(musicFrontmatter, spotifyEntity, isInSpotifyLibrary);
            this.updateEntitySpecificFrontmatter(musicFrontmatter, spotifyEntity, sources);

            // Only update if there are changes or it's a new file
            const hasChanges = before !== this.createSnapshot(musicFrontmatter);
            if (hasChanges || isNew) {
                this.finalizeFrontmatter(frontmatter, musicFrontmatter, addedAt, isNew, spotifyEntity);
            }
        });
    }

    private createSnapshot(musicFrontmatter: MusicFrontmatter): string {
        const { created, modified, ...rest } = musicFrontmatter;
        return JSON.stringify(rest);
    }

    private updateCommonFrontmatter(
        fm: MusicFrontmatter,
        entity: Track | Album | Artist,
        isInSpotifyLibrary: boolean
    ): void {
        fm.title = fm.title ?? entity.name;
        fm.cover = fm.cover ?? this.dataHelpers.getBestImageUrl(
            this.dataHelpers.isTrack(entity) ? entity.album.images : entity.images
        );
        fm.spotify_library = isInSpotifyLibrary;
        fm.music_ids = {
            ...fm.music_ids,
            spotify_id: entity.id,
            spotify_uri: entity.uri,
        };
        fm.music_sources = {
            ...fm.music_sources,
            spotify: entity.external_urls.spotify,
        };

        fm.aliases = fm.aliases ?? [entity.name];
    }

    private updateEntitySpecificFrontmatter(
        fm: MusicFrontmatter,
        entity: Track | Album | Artist,
        sources?: string[]
    ): void {
        if (this.dataHelpers.isTrack(entity)) {
            this.addTrackFields(fm, entity, sources);
        } else if (this.dataHelpers.isAlbum(entity)) {
            this.addAlbumFields(fm, entity);
        }
    }

    private addTrackFields(fm: MusicFrontmatter, track: Track, sources?: string[]): void {
        // Album (only if not a single)
        if (!this.dataHelpers.isSingle(track.album)) {
            const albumFile = this.fileManager.getAlbumUriToFile().get(track.album.uri);
            fm.album = albumFile
                ? this.generateMarkdownLink(
                    this.settings.music_catalog_base_path
                    + "/" + this.settings.albums_path
                    + "/" + albumFile.basename,
                    track.album.name
                )
                : track.album.name;
        }

        fm.artists = this.getArtistLinks(track.artists);

        if (sources) {
            fm.spotify_playlists = sources;
        }
    }

    private addAlbumFields(fm: MusicFrontmatter, album: Album): void {
        fm.artists = this.getArtistLinks(album.artists);
        fm.tracks = fm.tracks ?? this.dataHelpers.generateAlbumTracksArray(album);
    }

    private getArtistLinks(artists: any[]): string[] {
        return artists.map(artist => {
            const artistFile = this.fileManager.getArtistUriToFile().get(artist.uri);
            return artistFile
                ? this.generateMarkdownLink(
                    this.settings.music_catalog_base_path
                    + "/" + this.settings.artists_path
                    + "/" + artistFile.basename,
                    artist.name
                )
                : artist.name;
        });
    }

    private generateMarkdownLink(
        filePath: string,
        alias: string
    ) {
        return `[[${filePath}|${alias}]]`;
    }

    private finalizeFrontmatter(
        frontmatter: any,
        fm: MusicFrontmatter,
        addedAt: string | undefined,
        isNew: boolean,
        entity: Track | Album | Artist
    ): void {
        // Set created date
        const newCreatedDate = addedAt
            ? moment(addedAt).format('YYYY-MM-DD')
            : moment().format('YYYY-MM-DD');
        if (!fm.created || newCreatedDate < fm.created) {
            fm.created = newCreatedDate;
        }

        // Update modified date
        fm.modified = moment().format('YYYY-MM-DD');

        // Apply default frontmatter only for new files
        if (isNew) {
            const defaults = this.getDefaultFrontmatter(entity);
            Object.assign(fm, defaults, fm);
        }

        // Apply to actual frontmatter
        Object.assign(frontmatter, fm);
    }

    private getDefaultFrontmatter(entity: Track | Album | Artist): Record<string, any> {
        if (this.dataHelpers.isTrack(entity)) {
            return this.parseDefaultFrontmatter(this.settings.default_track_frontmatter);
        } else if (this.dataHelpers.isAlbum(entity)) {
            return this.parseDefaultFrontmatter(this.settings.default_album_frontmatter);
        } else {
            return this.parseDefaultFrontmatter(this.settings.default_artist_frontmatter);
        }
    }

    private parseDefaultFrontmatter(frontmatterText: string): Record<string, any> {
        if (!frontmatterText?.trim()) {
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
}
