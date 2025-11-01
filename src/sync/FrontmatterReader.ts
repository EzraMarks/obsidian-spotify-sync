import { App, TFile } from 'obsidian';
import { MusicIds, SimplifiedArtist, SimplifiedAlbum, Artist, Album, Track, MusicSources } from "./types";
import { MusicFrontmatter } from './frontmatterTypes';
import { MusicFile } from './types';

export class FrontmatterReader {
    constructor(private app: App) { }

    parseArtistFile(file: TFile): MusicFile<Artist> | undefined {
        const frontmatter = this.extractFrontmatter(file);
        if (!frontmatter) {
            return undefined;
        }

        return {
            title: frontmatter.title ?? "",
            ids: this.extractMusicIds(frontmatter),
            sources: this.extractMusicSources(frontmatter),
            file: file,
        };
    }

    parseAlbumFile(file: TFile): MusicFile<Album> | undefined {
        const frontmatter = this.extractFrontmatter(file);
        if (!frontmatter) {
            return undefined;
        }

        return {
            title: frontmatter.title ?? "",
            ids: this.extractMusicIds(frontmatter),
            sources: this.extractMusicSources(frontmatter),
            artists: this.parseArtistLinks(frontmatter.artists ?? []),
            tracks: frontmatter.tracks?.map(title => ({ title, ids: {} })) ?? [],
            file: file
        };
    }

    parseTrackFile(file: TFile): MusicFile<Track> | undefined {
        const frontmatter = this.extractFrontmatter(file);
        if (!frontmatter) {
            return undefined;
        }

        return {
            title: frontmatter.title ?? "",
            ids: this.extractMusicIds(frontmatter),
            sources: this.extractMusicSources(frontmatter),
            artists: this.parseArtistLinks(frontmatter.artists ?? []),
            album: frontmatter.album ? this.parseAlbumLink(frontmatter.album) : undefined,
            file: file
        };
    }

    private extractFrontmatter(file: TFile): MusicFrontmatter | undefined {
        const metadata = this.app.metadataCache.getFileCache(file);
        if (!metadata?.frontmatter) {
            throw new Error("Metadata cache not yet initialized.");
        }

        return Object.assign(new MusicFrontmatter(), metadata.frontmatter);
    }

    private extractMusicIds(frontmatter: MusicFrontmatter): MusicIds {
        return frontmatter.music_ids;
    }

    private extractMusicSources(frontmatter: MusicFrontmatter): MusicSources {
        return frontmatter.music_sources;
    }

    /**
     * Parse artist links (strings or markdown links) into SimplifiedArtist objects
     * This will attempt to resolve the links and extract IDs from the linked files
     */
    private parseArtistLinks(artistStrings: string[]): SimplifiedArtist[] {
        return artistStrings.map(artistStr => {
            const title = this.extractDisplayText(artistStr);
            const linkedFile = this.resolveMarkdownLink(artistStr);
            const artistFile = linkedFile && this.parseArtistFile(linkedFile);

            if (artistFile) {
                return artistFile;
            }

            return {
                title,
                ids: {}
            }
        });
    }

    /**
     * Parse album link into SimplifiedAlbum object
     * This will attempt to resolve the link and extract IDs from the linked file
     */
    private parseAlbumLink(albumStr: string | undefined): SimplifiedAlbum | undefined {
        if (!albumStr) {
            return undefined;
        }

        const title = this.extractDisplayText(albumStr);
        const linkedFile = this.resolveMarkdownLink(albumStr);
        const albumFile = linkedFile && this.parseAlbumFile(linkedFile);

        if (albumFile) {
            return albumFile
        }

        return {
            title,
            ids: {},
            artists: []
        };
    }

    /**
     * Extract display text from a markdown link or plain text
     * [[path|Display Text]] -> "Display Text"
     * [[path]] -> "path" (filename)
     * Plain text -> "Plain text"
     */
    private extractDisplayText(text: string): string {
        // Match [[path|alias]] format
        const aliasMatch = text.match(/\[\[.*?\|(.+?)\]\]/);
        if (aliasMatch) {
            return aliasMatch[1];
        }

        // Match [[path]] format
        const pathMatch = text.match(/\[\[(.+?)\]\]/);
        if (pathMatch) {
            const path = pathMatch[1];
            // Return the filename without extension
            return path.split('/').pop()?.replace(/\.md$/, '') ?? path;
        }

        // Plain text
        return text;
    }

    /**
     * Resolve a markdown link to an actual TFile
     * [[path]] or [[path|alias]] -> TFile
     */
    private resolveMarkdownLink(text: string): TFile | undefined {
        // Extract the path from markdown link syntax
        const linkMatch = text.match(/\[\[(.+?)(?:\|.+?)?\]\]/);
        if (!linkMatch) {
            return undefined;
        }

        const linkPath = linkMatch[1];

        // Try to resolve using Obsidian's link resolution
        const file = this.app.metadataCache.getFirstLinkpathDest(linkPath, '');

        return file instanceof TFile ? file : undefined;
    }
}
