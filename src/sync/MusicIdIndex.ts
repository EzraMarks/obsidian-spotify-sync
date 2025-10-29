import { MusicIds } from "./types";
import { MusicEntity, MusicFile } from "./types";


export class MusicIdIndex<T> {
    private readonly maps: Record<keyof MusicIds, Map<string, T>>;
    private readonly items: Set<T>;

    private readonly priorityOrder: (keyof MusicIds)[] = [
        "spotify_uri",
        "spotify_id",
        "upc",
        "isrc",
        "mbid"
    ];

    /**
     * @param items - Array of items to index
     * @param getIds - Function to extract MusicIds from each item
     */
    constructor(items: T[], getIds: (item: T) => MusicIds) {
        this.maps = {
            mbid: new Map(),
            upc: new Map(),
            isrc: new Map(),
            spotify_id: new Map(),
            spotify_uri: new Map(),
        };
        this.items = new Set();

        items.forEach(item => {
            const ids = getIds(item);
            this.set(ids, item);
        });
    }

    /**
     * Alternative constructor for items that already have ids property
     */
    static fromItems<T extends MusicFile<MusicEntity>>(items: T[]): MusicIdIndex<T> {
        return new MusicIdIndex(items, item => item.ids);
    }

    set(ids: MusicIds, item: T): void {
        this.items.add(item);
        this.priorityOrder.forEach(key => {
            const id = ids[key];
            id && this.maps[key].set(id, item);
        });
    }

    /**
     * Check if any ID from the provided MusicIds matches an item in the index
     */
    has(ids: MusicIds): boolean {
        return this.priorityOrder.some(key => {
            const id = ids[key];
            return id && this.maps[key].has(id);
        });
    }

    /**
     * Get the item matching any ID from the provided MusicIds
     */
    get(ids: MusicIds): T | undefined {
        for (const key of this.priorityOrder) {
            const id = ids[key];
            if (id) {
                const item = this.maps[key].get(id);
                if (item) return item;
            }
        }
        return undefined;
    }

    /**
     * Get all items in the index
     */
    values(): T[] {
        return Array.from(this.items);
    }
}
