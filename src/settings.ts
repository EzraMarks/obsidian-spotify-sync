import { App, PluginSettingTab, Setting } from 'obsidian';
import { AccessToken } from '@spotify/web-api-ts-sdk';
import ObsidianSpotify from './main';

/**
 * Represents the settings for the Obsidian Spotify integration.
 */
export interface ObsidianSpotifySettings {
    /**
     * The client ID for the Spotify API.
     */
    spotify_client_id: string;

    /**
     * The client secret for the Spotify API.
     */
    spotify_client_secret: string;

    /**
     * The access token for authenticating requests to the Spotify API.
     */
    spotify_access_token: AccessToken;

    /**
     * The base path where music catalogs will be stored.
     */
    music_catalog_base_path: string;

    /**
     * The path where artist notes will be stored (relative to base path).
     */
    artists_path: string;

    /**
     * The path where album notes will be stored (relative to base path).
     */
    albums_path: string;

    /**
     * The path where track notes will be stored (relative to base path).
     */
    tracks_path: string;

    /**
     * The base path where local music files are stored.
     */
    local_music_files_path: string;

    /**
     * List of Spotify playlist IDs to sync tracks from (in addition to Liked Songs).
     */
    playlist_ids: string[];

    /**
     * Mapping of playlist IDs to their human-readable names.
     */
    playlist_names: Record<string, string>;

    /**
     * Whether to automatically sync on plugin load.
     */
    auto_sync_on_load: boolean;

    /**
     * Whether to sync recent changes when app comes to foreground (mobile only).
     */
    sync_on_app_foreground: boolean;

    /**
     * Default frontmatter to include when creating new track notes.
     */
    default_track_frontmatter: string;

    /**
     * Default frontmatter to include when creating new album notes.
     */
    default_album_frontmatter: string;

    /**
     * Default frontmatter to include when creating new artist notes.
     */
    default_artist_frontmatter: string;
}

/**
 * Default settings for the Obsidian Spotify integration.
 */
export const DEFAULT_SETTINGS: ObsidianSpotifySettings = {
    spotify_client_id: '',
    spotify_client_secret: '',
    spotify_access_token: {
        access_token: "",
        token_type: "",
        expires_in: 0,
        refresh_token: ""
    },
    music_catalog_base_path: 'Music',
    artists_path: 'Artists',
    albums_path: 'Albums',
    tracks_path: 'Tracks',
    local_music_files_path: '',
    playlist_ids: [],
    playlist_names: {},
    auto_sync_on_load: false,
    sync_on_app_foreground: false,
    default_track_frontmatter: '',
    default_album_frontmatter: '',
    default_artist_frontmatter: '',
}

export class ObsidianSpotifySettingsTab extends PluginSettingTab {
    plugin: ObsidianSpotify;
    private currentTab: 'spotify' | 'sync' | 'frontmatter' = 'spotify';

    constructor(app: App, plugin: ObsidianSpotify) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        this.createTabNavigation(containerEl);

        const tabContentEl = containerEl.createDiv('tab-content');

        if (this.currentTab === 'spotify') {
            this.displaySpotifyTab(tabContentEl);
        } else if (this.currentTab === 'sync') {
            this.displaySyncTab(tabContentEl);
        } else if (this.currentTab === 'frontmatter') {
            this.displayFrontmatterTab(tabContentEl);
        }
    }

    private createTabNavigation(containerEl: HTMLElement): void {
        const tabNavEl = containerEl.createDiv('tab-navigation');
        tabNavEl.style.display = 'flex';
        tabNavEl.style.marginBottom = '20px';
        tabNavEl.style.borderBottom = '1px solid var(--background-modifier-border)';

        // Spotify Connection Tab
        const spotifyTabEl = tabNavEl.createDiv('tab-button');
        spotifyTabEl.textContent = 'Spotify Connection';
        spotifyTabEl.style.padding = '10px 20px';
        spotifyTabEl.style.cursor = 'pointer';
        spotifyTabEl.style.borderBottom = this.currentTab === 'spotify' ? '2px solid var(--interactive-accent)' : 'none';
        spotifyTabEl.style.color = this.currentTab === 'spotify' ? 'var(--interactive-accent)' : 'var(--text-muted)';

        spotifyTabEl.addEventListener('click', () => {
            this.currentTab = 'spotify';
            this.display();
        });

        // Sync Settings Tab
        const syncTabEl = tabNavEl.createDiv('tab-button');
        syncTabEl.textContent = 'Sync Settings';
        syncTabEl.style.padding = '10px 20px';
        syncTabEl.style.cursor = 'pointer';
        syncTabEl.style.borderBottom = this.currentTab === 'sync' ? '2px solid var(--interactive-accent)' : 'none';
        syncTabEl.style.color = this.currentTab === 'sync' ? 'var(--interactive-accent)' : 'var(--text-muted)';

        syncTabEl.addEventListener('click', () => {
            this.currentTab = 'sync';
            this.display();
        });

        // Frontmatter Tab
        const frontmatterTabEl = tabNavEl.createDiv('tab-button');
        frontmatterTabEl.textContent = 'Default Frontmatter';
        frontmatterTabEl.style.padding = '10px 20px';
        frontmatterTabEl.style.cursor = 'pointer';
        frontmatterTabEl.style.borderBottom = this.currentTab === 'frontmatter' ? '2px solid var(--interactive-accent)' : 'none';
        frontmatterTabEl.style.color = this.currentTab === 'frontmatter' ? 'var(--interactive-accent)' : 'var(--text-muted)';

        frontmatterTabEl.addEventListener('click', () => {
            this.currentTab = 'frontmatter';
            this.display();
        });
    }

    private displaySpotifyTab(containerEl: HTMLElement): void {
        const manifest = this.plugin.manifest;

        containerEl.createEl('h2', { text: 'Spotify API Configuration' });

        new Setting(containerEl)
            .setName('Spotify Client ID')
            .setDesc('Find it in your Spotify developer dashboard')
            .addText(text => text
                .setPlaceholder('Enter your client ID')
                .setValue(this.plugin.settings.spotify_client_id)
                .onChange(async (value) => {
                    this.plugin.settings.spotify_client_id = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Spotify Client Secret')
            .setDesc('Find it in your Spotify developer dashboard')
            .addText(text => text
                .setPlaceholder('Enter your client secret')
                .setValue(this.plugin.settings.spotify_client_secret)
                .onChange(async (value) => {
                    this.plugin.settings.spotify_client_secret = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Spotify Authentication')
            .setDesc('Login or logout from Spotify')
            .addButton((btn) => btn
                .setButtonText("Login")
                .setCta()
                .onClick(async () => {
                    this.plugin.spotifystate = this.plugin.spotifyAuth.initiateLogin(this.plugin.settings.spotify_client_id, manifest);
                }))
            .addButton((btn) => btn
                .setButtonText("Logout")
                .setCta()
                .onClick(async () => {
                    await this.plugin.spotifyAuth.logout(manifest);
                    this.plugin.tokenManager.cleanup();
                }));

        const usernameContainer = new Setting(containerEl)
            .setName('Logged in as')
            .setDesc('The current logged in user');

        const usernameWrapContainer = usernameContainer.controlEl.createDiv("spotify-api-refresh-token");
        const usernameText = usernameWrapContainer.createSpan();

        this.plugin.usernametext = usernameText;
        this.plugin.spotifyAuth.updateDisplayedUsername(this.plugin.settings);

        containerEl.createEl('h3', { text: 'Setup Instructions' });
        const instructionsEl = containerEl.createDiv();
        instructionsEl.innerHTML = `
			<p>To get your Spotify API credentials:</p>
			<ol>
				<li>Go to <a href="https://developer.spotify.com/dashboard" target="_blank">Spotify Developer Dashboard</a></li>
				<li>Create a new app or select an existing one</li>
				<li>Copy the Client ID and Client Secret</li>
				<li>Add <code>obsidian://spotify/auth</code> as a redirect URI in your app settings</li>
				<li>Paste the credentials above and click Login</li>
			</ol>
		`;
    }

    private displaySyncTab(containerEl: HTMLElement): void {
        containerEl.createEl('h2', { text: 'Sync Configuration' });

        new Setting(containerEl)
            .setName('Music Catalog Base Path')
            .setDesc('The base folder where all music-related notes will be stored')
            .addText(text => text
                .setPlaceholder('e.g., Catalogs/Music')
                .setValue(this.plugin.settings.music_catalog_base_path)
                .onChange(async (value) => {
                    this.plugin.settings.music_catalog_base_path = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Artists Subfolder')
            .setDesc('Subfolder name for artist notes (relative to base path)')
            .addText(text => text
                .setPlaceholder('e.g., Artists')
                .setValue(this.plugin.settings.artists_path)
                .onChange(async (value) => {
                    this.plugin.settings.artists_path = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Albums Subfolder')
            .setDesc('Subfolder name for album notes (relative to base path)')
            .addText(text => text
                .setPlaceholder('e.g., Albums')
                .setValue(this.plugin.settings.albums_path)
                .onChange(async (value) => {
                    this.plugin.settings.albums_path = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Tracks Subfolder')
            .setDesc('Subfolder name for track notes (relative to base path)')
            .addText(text => text
                .setPlaceholder('e.g., Tracks')
                .setValue(this.plugin.settings.tracks_path)
                .onChange(async (value) => {
                    this.plugin.settings.tracks_path = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Local Music Files Path')
            .setDesc('The base folder where your local music files are stored (for linking to actual audio files)')
            .addText(text => text
                .setPlaceholder('e.g., Music/Library')
                .setValue(this.plugin.settings.local_music_files_path)
                .onChange(async (value) => {
                    this.plugin.settings.local_music_files_path = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Auto-sync on plugin load')
            .setDesc('Automatically sync recent changes when the plugin loads')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.auto_sync_on_load)
                .onChange(async (value) => {
                    this.plugin.settings.auto_sync_on_load = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Sync when app opens (Mobile)')
            .setDesc('Automatically sync recent changes when re-opening Obsidian on mobile')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.sync_on_app_foreground)
                .onChange(async (value) => {
                    this.plugin.settings.sync_on_app_foreground = value;
                    await this.plugin.saveSettings();
                    // Re-setup focus detection with new setting
                    if (value) {
                        this.plugin.setupAppFocusDetection();
                    }
                }));

        // Track Sources Configuration
        containerEl.createEl('h3', { text: 'Track Sources' });

        containerEl.createDiv().innerHTML = `
            <p><strong>Liked Songs</strong> are automatically synced from your Spotify library.</p>
            <p>You can also add additional playlists to sync tracks from:</p>
        `;

        containerEl.createEl('h4', { text: 'Additional Playlists' });
        containerEl.createDiv().innerHTML = `
            <p>Find playlist IDs in Spotify URLs: <code>https://open.spotify.com/playlist/<strong>37i9dQZF1DXcBWIGoYBM5M</strong></code></p>
        `;

        // Display current playlists
        const playlistContainer = containerEl.createDiv();
        this.displayPlaylistSettings(playlistContainer);

        containerEl.createEl('h3', { text: 'Current Paths' });
        const pathsEl = containerEl.createDiv();
        pathsEl.innerHTML = `
			<p><strong>Full Artists Path:</strong> <code>${this.plugin.settings.music_catalog_base_path}/${this.plugin.settings.artists_path}</code></p>
			<p><strong>Full Albums Path:</strong> <code>${this.plugin.settings.music_catalog_base_path}/${this.plugin.settings.albums_path}</code></p>
			<p><strong>Full Tracks Path:</strong> <code>${this.plugin.settings.music_catalog_base_path}/${this.plugin.settings.tracks_path}</code></p>
			${this.plugin.settings.local_music_files_path ? `<p><strong>Local Music Files:</strong> <code>${this.plugin.settings.local_music_files_path}</code></p>` : ''}
		`;

        new Setting(containerEl)
            .setName('Manual Sync')
            .setDesc('Manually trigger a full sync of your Spotify library')
            .addButton(button => button
                .setButtonText('Full Sync')
                .setCta()
                .onClick(async () => {
                    await this.plugin.syncAll();
                }))
            .addButton(button => button
                .setButtonText('Recent Sync')
                .onClick(async () => {
                    await this.plugin.syncRecent();
                }));
    }

    private displayFrontmatterTab(containerEl: HTMLElement): void {
        containerEl.createEl('h2', { text: 'Default Frontmatter' });

        const descriptionEl = containerEl.createDiv();
        descriptionEl.innerHTML = `
            <p>Define additional frontmatter properties to include when creating new notes. These will be added alongside the automatically generated Spotify metadata.</p>
            <p>Format each property as <code>property: value</code> on separate lines, just like regular frontmatter.</p>
            <p><strong>Example:</strong></p>
            <pre><code>tags:
  - music/track
rating: 
notes: 
mood:</code></pre>
        `;

        new Setting(containerEl)
            .setName('Default Track Frontmatter')
            .setDesc('Additional frontmatter to include when creating track notes')
            .addTextArea(text => text
                .setPlaceholder('tags:\n  - music/track\nrating: \nnotes:')
                .setValue(this.plugin.settings.default_track_frontmatter)
                .onChange(async (value) => {
                    this.plugin.settings.default_track_frontmatter = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Default Album Frontmatter')
            .setDesc('Additional frontmatter to include when creating album notes')
            .addTextArea(text => text
                .setPlaceholder('tags:\n  - music/album\nrating:')
                .setValue(this.plugin.settings.default_album_frontmatter)
                .onChange(async (value) => {
                    this.plugin.settings.default_album_frontmatter = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Default Artist Frontmatter')
            .setDesc('Additional frontmatter to include when creating artist notes')
            .addTextArea(text => text
                .setPlaceholder('tags:\n  - music/artist\ngenres:')
                .setValue(this.plugin.settings.default_artist_frontmatter)
                .onChange(async (value) => {
                    this.plugin.settings.default_artist_frontmatter = value;
                    await this.plugin.saveSettings();
                }));

        const noteEl = containerEl.createDiv();
        noteEl.style.marginTop = '20px';
        noteEl.style.padding = '10px';
        noteEl.style.backgroundColor = 'var(--background-secondary)';
        noteEl.style.borderRadius = '5px';
        noteEl.innerHTML = `
            <p><strong>Note:</strong> Default frontmatter is only applied when creating new notes. Existing notes will not be modified. The plugin will automatically add its own metadata (title, spotify_id, spotify_url, etc.) alongside your custom frontmatter.</p>
        `;
    }

    private displayPlaylistSettings(container: HTMLElement): void {
        container.empty();

        const playlistList = container.createDiv('playlist-list');

        this.plugin.settings.playlist_ids.forEach((playlistId, index) => {
            const playlistName = this.plugin.settings.playlist_names[playlistId] || playlistId;
            const displayName = playlistName === playlistId ? 'Unknown Playlist' : playlistName;

            const playlistSetting = new Setting(playlistList)
                .setName(`${displayName}`)
                .setDesc(`ID: ${playlistId}`)
                .addText(text => text
                    .setPlaceholder('Playlist ID (e.g., 37i9dQZF1DXcBWIGoYBM5M)')
                    .setValue(playlistId)
                    .onChange(async (value) => {
                        const oldId = this.plugin.settings.playlist_ids[index];
                        const newId = value.trim();

                        // Update the ID
                        this.plugin.settings.playlist_ids[index] = newId;

                        // Remove old mapping and try to fetch new one
                        if (oldId && oldId !== newId) {
                            delete this.plugin.settings.playlist_names[oldId];
                        }

                        if (newId && newId !== oldId) {
                            await this.fetchAndStorePlaylistName(newId);
                        }

                        await this.plugin.saveSettings();
                        this.displayPlaylistSettings(container);
                    }))
                .addButton(button => button
                    .setButtonText('Refresh Name')
                    .onClick(async () => {
                        if (playlistId.trim()) {
                            await this.fetchAndStorePlaylistName(playlistId);
                            await this.plugin.saveSettings();
                            this.displayPlaylistSettings(container);
                        }
                    }))
                .addButton(button => button
                    .setButtonText('Remove')
                    .setWarning()
                    .onClick(async () => {
                        const removedId = this.plugin.settings.playlist_ids[index];
                        this.plugin.settings.playlist_ids.splice(index, 1);

                        // Clean up the name mapping
                        if (removedId) {
                            delete this.plugin.settings.playlist_names[removedId];
                        }

                        await this.plugin.saveSettings();
                        this.displayPlaylistSettings(container);
                    }));
        });

        // Add new playlist button
        new Setting(container)
            .setName('Add Playlist')
            .setDesc('Add a new playlist to sync tracks from (in addition to Liked Songs)')
            .addButton(button => button
                .setButtonText('Add Playlist')
                .setCta()
                .onClick(async () => {
                    this.plugin.settings.playlist_ids.push('');
                    await this.plugin.saveSettings();
                    this.displayPlaylistSettings(container);
                }));
    }

    private async fetchAndStorePlaylistName(playlistId: string): Promise<void> {
        if (!playlistId.trim() || !this.plugin.spotifyApi) {
            return;
        }

        try {
            const playlist = await this.plugin.spotifyApi.playlists.getPlaylist(playlistId, 'US', 'name');
            this.plugin.settings.playlist_names[playlistId] = playlist.name;
            console.log(`Fetched playlist name: ${playlist.name} for ID: ${playlistId}`);
        } catch (error) {
            console.error(`Failed to fetch playlist name for ID ${playlistId}:`, error);
            // Keep the ID as fallback
            this.plugin.settings.playlist_names[playlistId] = playlistId;
        }
    }
}
