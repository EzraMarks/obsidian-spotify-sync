export class MusicFrontmatter {
    created?: string = undefined;
    modified?: string = undefined;
    title?: string = undefined;
    album?: string | null = undefined;
    artists?: string[] = undefined;
    cover?: string = undefined;
    tracks?: string[] = undefined;
    in_library?: boolean = undefined;
    music_ids: MusicIdsFrontmatter = new MusicIdsFrontmatter();
    music_sources: MusicSourcesFrontmatter = new MusicSourcesFrontmatter();
    aliases?: string[] = undefined;
}

export class MusicIdsFrontmatter {
    spotify_id?: string = undefined;
    spotify_uri?: string = undefined;
    mbid?: string = undefined;
    upc?: string = undefined;
    isrc?: string = undefined;
}

export class MusicSourcesFrontmatter {
    spotify?: string = undefined;
    local?: string = undefined;
    online?: string[] = undefined;
}
