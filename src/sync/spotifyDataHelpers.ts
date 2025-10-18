import type { Album, Artist, Track, SimplifiedAlbum, PlaylistedTrack } from '@spotify/web-api-ts-sdk';
import { ObsidianSpotifySettings } from '../settings';

export class SpotifyDataHelpers {
    constructor(private settings: ObsidianSpotifySettings) { }

    getBestImageUrl(images: { url: string; width: number; height: number }[], targetSize: number = 300): string {
        if (!images?.length) return '';
        return images.reduce((best, current) => {
            const bestDistance = Math.abs(best.width - targetSize);
            const currentDistance = Math.abs(current.width - targetSize);
            return currentDistance < bestDistance ? current : best;
        }).url;
    }

    generateAlbumTracksArray(album: Album): string[] {
        return album.tracks.items.map(track => track.name);
    }

    generateTrackFileName(track: Track): string {
        const primaryArtist = track.artists[0]?.name || 'Unknown Artist';
        const isSingle = this.isSingle(track.album);
        return isSingle
            ? this.sanitizeFileName(`${track.name} - ${primaryArtist}`)
            : this.sanitizeFileName(`${track.name} - ${track.album.name} - ${primaryArtist}`);
    }

    sanitizeFileName(name: string): string {
        return name
            .replace(/[<>:"/\\|?*]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    getPlaylistDisplayName(playlistId: string): string {
        return this.settings.playlist_names[playlistId] || playlistId;
    }

    isSingle(album: SimplifiedAlbum | Album): boolean {
        return album.total_tracks === 1;
    }

    // Type guards
    isTrack(item: Track | Album | Artist): item is Track {
        return item.type === 'track';
    }

    isAlbum(item: Track | Album | Artist): item is Album {
        return item.type === 'album';
    }

    isPlaylistedTrack(item: PlaylistedTrack): item is PlaylistedTrack<Track> {
        return item.track.type === 'track';
    }
}
