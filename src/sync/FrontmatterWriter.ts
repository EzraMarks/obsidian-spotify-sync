import { App, moment, parseYaml } from 'obsidian';
import { ObsidianSpotifySettings } from '../settings';
import { MusicFrontmatter } from './frontmatterTypes';
import { Track, Album, Artist, SimplifiedArtist, SimplifiedAlbum } from "./types";
import { MusicFile } from './types';
import { removeNullish } from 'src/utils';

export class FrontmatterWriter {
    // User-specified frontmatter that is appended when creating new files
    private defaultArtistFrontmatter = this.parseDefaultFrontmatter(this.settings.default_artist_frontmatter);
    private defaultAlbumFrontmatter = this.parseDefaultFrontmatter(this.settings.default_album_frontmatter);
    private defaultTrackFrontmatter = this.parseDefaultFrontmatter(this.settings.default_track_frontmatter);

    constructor(
        private app: App,
        private settings: ObsidianSpotifySettings,
        private generateArtistLink: (artist: SimplifiedArtist) => Promise<string>,
        private generateAlbumLink: (album: SimplifiedAlbum) => Promise<string>
    ) { }

    async updateArtistFrontmatter(artist: MusicFile<Artist>): Promise<void> {
        await this.app.fileManager.processFrontMatter(artist.file, (fmOriginal) => {
            const fm: MusicFrontmatter = Object.assign(new MusicFrontmatter(), fmOriginal);

            this.updateCommonFrontmatter(fm, artist);

            this.finalizeFrontmatter(
                fmOriginal,
                fm,
                artist.addedAt,
                this.defaultArtistFrontmatter
            );
        });
    }

    async updateAlbumFrontmatter(album: MusicFile<Album>): Promise<void> {
        const artistLinks = await Promise.all(
            album.artists.map(artist => this.generateArtistLink(artist))
        );

        await this.app.fileManager.processFrontMatter(album.file, (fmOriginal) => {
            const fm = Object.assign(new MusicFrontmatter(), fmOriginal);

            this.updateCommonFrontmatter(fm, album);

            fm.artists = artistLinks;
            fm.tracks = fm.tracks ?? album.tracks?.map(track => track.title);

            this.finalizeFrontmatter(
                fmOriginal,
                fm,
                album.addedAt,
                this.defaultAlbumFrontmatter
            );
        });
    }

    async updateTrackFrontmatter(track: MusicFile<Track>): Promise<void> {
        const albumLink = track.album && await this.generateAlbumLink(track.album);
        const artistLinks = await Promise.all(
            track.artists.map(artist => this.generateArtistLink(artist))
        );

        await this.app.fileManager.processFrontMatter(track.file, (fmOriginal) => {
            const fm = Object.assign(new MusicFrontmatter(), fmOriginal);

            this.updateCommonFrontmatter(fm, track);

            fm.album = albumLink;
            fm.artists = artistLinks;

            this.finalizeFrontmatter(
                fmOriginal,
                fm,
                track.addedAt,
                this.defaultTrackFrontmatter
            );
        });
    }

    private updateCommonFrontmatter(
        fm: MusicFrontmatter,
        entity: MusicFile<Track | Album | Artist>
    ): void {
        fm.title = fm.title ?? entity.title;
        fm.cover = fm.cover ?? entity.image;
        fm.aliases = fm.aliases ?? [entity.title];

        fm.music_ids = {
            ...fm.music_ids,
            ...removeNullish(entity.ids),
        };

        fm.music_sources = {
            ...fm.music_sources,
            ...removeNullish(entity.sources)
        };
    }

    private finalizeFrontmatter(
        fmOriginal: any,
        fm: MusicFrontmatter,
        addedAt: moment.Moment | undefined,
        defaultFrontmatter: Record<string, any>
    ): void {
        // Set created date
        const newCreatedDate = addedAt
            ? addedAt.format("YYYY-MM-DD")
            : moment().format("YYYY-MM-DD");
        if (!fm.created || moment(newCreatedDate) < moment(fm.created)) {
            fm.created = newCreatedDate;
        }

        const hasChanges = this.hasFrontmatterChanges(fm, fmOriginal);
        if (hasChanges) {
            fm.modified = moment().format("YYYY-MM-DD");
        }

        // Apply default frontmatter only for new files
        const isNew = !fmOriginal.created;
        if (isNew) {
            Object.assign(fm, defaultFrontmatter);
        }

        // Apply to actual frontmatter
        Object.assign(fmOriginal, fm);
    }

    private hasFrontmatterChanges(fm: MusicFrontmatter, fmOriginal: MusicFrontmatter): boolean {
        const { created, modified, ...restFm } = fm;
        const { created: _, modified: __, ...restFmOriginal } = fmOriginal;

        return JSON.stringify(fm) !== JSON.stringify(fmOriginal);
    }

    private parseDefaultFrontmatter(frontmatterText: string): Record<string, any> {
        if (!frontmatterText?.trim()) {
            return {};
        }

        try {
            return parseYaml(frontmatterText) || {};
        } catch (error) {
            console.warn("Failed to parse default frontmatter YAML:", error);
            console.warn("Frontmatter text:", frontmatterText);
            return {};
        }
    }
}
