import * as Spotify from '@spotify/web-api-ts-sdk';
import { ObsidianSpotifySettings } from '../../../settings';
import { MusicIds } from "src/sync/types";

export class SpotifyUtils {
    constructor(private settings: ObsidianSpotifySettings) { }

    getBestImageUrl(images: { url: string; width: number; height: number }[], targetSize: number = 300): string | undefined {
        if (!images?.length) return undefined;
        return images.reduce((best, current) => {
            const bestDistance = Math.abs(best.width - targetSize);
            const currentDistance = Math.abs(current.width - targetSize);
            return currentDistance < bestDistance ? current : best;
        }).url;
    }

    getSpotifyIds(spotifyItem: Spotify.Album | Spotify.SimplifiedTrack | Spotify.SimplifiedArtist): MusicIds {
        return {
            spotify_id: spotifyItem.id,
            spotify_uri: spotifyItem.uri
        };
    }

    generateAlbumTracksArray(album: Spotify.Album): string[] {
        return album.tracks.items.map(track => track.name);
    }

    getPlaylistDisplayName(playlistId: string): string {
        return this.settings.playlist_names[playlistId] || playlistId;
    }

    isSingle(album: Spotify.SimplifiedAlbum | Spotify.Album): boolean {
        return album.total_tracks === 1;
    }

    // Type guards
    isTrack(item: Spotify.Track | Spotify.Album | Spotify.Artist): item is Spotify.Track {
        return item.type === 'track';
    }

    isAlbum(item: Spotify.Track | Spotify.Album | Spotify.Artist): item is Spotify.Album {
        return item.type === 'album';
    }

    isPlaylistedTrack(item: Spotify.PlaylistedTrack): item is Spotify.PlaylistedTrack<Spotify.Track> {
        return item.track.type === 'track';
    }
}
