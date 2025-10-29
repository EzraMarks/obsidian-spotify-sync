import { TFile } from 'obsidian';
import { MusicIdsFrontmatter, MusicSourcesFrontmatter } from './frontmatterTypes';


export type MusicFile<T extends MusicEntity> = T & {
    file: TFile;
}

export interface Artist extends MusicEntity { }

export interface Album extends MusicEntity {
    artists: SimplifiedArtist[];
    tracks: SimplifiedTrack[];
}

export interface Track extends MusicEntity {
    artists: SimplifiedArtist[];
    album: SimplifiedAlbum | null | undefined;
}

export interface MusicEntity {
    title: string;
    ids: MusicIds;
    sources: MusicSources;
    inLibrary?: boolean; // whether this entity is saved in the streaming library source
    image?: string;
    addedAt?: moment.Moment;
}

export interface SimplifiedArtist {
    title: string;
    ids: MusicIds;
}

export interface SimplifiedAlbum {
    title: string;
    artists: SimplifiedArtist[];
    ids: MusicIds;
}

export interface SimplifiedTrack {
    title: string;
    ids: MusicIds;
}

export type MusicIds = MusicIdsFrontmatter;

export type MusicSources = MusicSourcesFrontmatter;
